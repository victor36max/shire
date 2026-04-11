import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Save,
  Download,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Filter,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebouncedCallback } from "use-debounce";
import { useSaveFileContent } from "../../hooks/shared-drive";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type SaveStatus = "saved" | "saving" | "unsaved";
type SortDirection = "asc" | "desc";
interface SortConfig {
  columnIndex: number;
  direction: SortDirection;
}

interface CsvEditorProps {
  initialContent: string;
  projectId: string;
  filePath: string;
}

const ROW_HEIGHT = 32;

function handlePaste(e: React.ClipboardEvent) {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusCell(cell: HTMLElement) {
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function isCaretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  return (
    range.collapsed &&
    range.startOffset === 0 &&
    (range.startContainer === el.firstChild || range.startContainer === el)
  );
}

function isCaretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const text = el.textContent ?? "";
  if (range.startContainer === el) return range.startOffset >= el.childNodes.length;
  return range.startOffset >= text.length;
}

function compareValues(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return a.localeCompare(b);
}

function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const csv = Papa.unparse([headers, ...rows]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export default function CsvEditor({ initialContent, projectId, filePath }: CsvEditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const { mutate: saveFile } = useSaveFileContent(projectId);

  const parsed = useMemo(() => {
    const result = Papa.parse<string[]>(initialContent, {
      header: false,
      skipEmptyLines: true,
    });
    const allRows = result.data;
    if (allRows.length === 0) return { headers: [] as string[], rows: [] as string[][] };
    return { headers: allRows[0], rows: allRows.slice(1) };
  }, [initialContent]);

  const [headers, setHeaders] = useState(parsed.headers);
  const [rows, setRows] = useState(parsed.rows);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [filterInputs, setFilterInputs] = useState<Map<number, string>>(new Map());
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerSpanRefs = useRef<(HTMLElement | null)[]>([]);

  const markUnsaved = useCallback(() => {
    setSaveStatus((prev) => (prev === "saved" ? "unsaved" : prev));
  }, []);

  const updateRows = useCallback(
    (newRows: string[][]) => {
      setRows(newRows);
      markUnsaved();
    },
    [markUnsaved],
  );

  const updateHeaders = useCallback(
    (newHeaders: string[]) => {
      setHeaders(newHeaders);
      markUnsaved();
    },
    [markUnsaved],
  );

  // Debounced filter update
  const debouncedSetFilter = useDebouncedCallback((colIndex: number, value: string) => {
    setFilterInputs((prev) => {
      const next = new Map(prev);
      if (value === "") {
        next.delete(colIndex);
      } else {
        next.set(colIndex, value);
      }
      return next;
    });
  }, 300);

  // Filtered rows with original indices
  const filteredRowsWithIndices = useMemo(() => {
    const indexed = rows.map((row, i) => ({ row, originalIndex: i }));
    if (filterInputs.size === 0) return indexed;
    return indexed.filter(({ row }) => {
      for (const [colIndex, filterValue] of filterInputs) {
        const cellValue = (row[colIndex] ?? "").toLowerCase();
        if (!cellValue.includes(filterValue.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filterInputs]);

  // Sorted filtered rows
  const sortedRows = useMemo(() => {
    if (!sortConfig) return filteredRowsWithIndices;
    const { columnIndex, direction } = sortConfig;
    return [...filteredRowsWithIndices].sort((a, b) => {
      const cmp = compareValues(a.row[columnIndex] ?? "", b.row[columnIndex] ?? "");
      return direction === "asc" ? cmp : -cmp;
    });
  }, [filteredRowsWithIndices, sortConfig]);

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Commit pending contentEditable on scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable && el.contains(active)) {
        active.blur();
      }
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const commitCellEdit = useCallback(
    (originalRowIndex: number, colIndex: number, newText: string) => {
      const currentVal = rows[originalRowIndex][colIndex] ?? "";
      if (newText === currentVal) return;
      const newRows = rows.map((row, i) => {
        if (i !== originalRowIndex) return row;
        const newRow = [...row];
        newRow[colIndex] = newText;
        return newRow;
      });
      updateRows(newRows);
    },
    [rows, updateRows],
  );

  const commitHeaderEdit = useCallback(
    (colIndex: number, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === headers[colIndex]) return;
      const newHeaders = [...headers];
      newHeaders[colIndex] = trimmed;
      updateHeaders(newHeaders);
    },
    [headers, updateHeaders],
  );

  const addRow = useCallback(() => {
    updateRows([...rows, new Array(headers.length).fill("")]);
  }, [rows, headers.length, updateRows]);

  const deleteRow = useCallback(
    (originalIndex: number) => {
      updateRows(rows.filter((_, i) => i !== originalIndex));
    },
    [rows, updateRows],
  );

  const addColumn = useCallback(() => {
    let i = 1;
    while (headers.includes(`column_${i}`)) i++;
    updateHeaders([...headers, `column_${i}`]);
    updateRows(rows.map((row) => [...row, ""]));
  }, [headers, rows, updateHeaders, updateRows]);

  const deleteColumn = useCallback(
    (colIndex: number) => {
      updateHeaders(headers.filter((_, i) => i !== colIndex));
      updateRows(rows.map((row) => row.filter((_, i) => i !== colIndex)));
    },
    [headers, rows, updateHeaders, updateRows],
  );

  const handleSort = useCallback((colIndex: number) => {
    setSortConfig((prev) => {
      if (!prev || prev.columnIndex !== colIndex)
        return { columnIndex: colIndex, direction: "asc" };
      if (prev.direction === "asc") return { columnIndex: colIndex, direction: "desc" };
      return null;
    });
  }, []);

  const doSave = useCallback(() => {
    const csv = Papa.unparse([headers, ...rows]);
    setSaveStatus("saving");
    saveFile(
      { path: filePath, content: csv },
      {
        onSuccess: () => setSaveStatus("saved"),
        onError: () => {
          setSaveStatus("unsaved");
          toast.error("Failed to save file");
        },
      },
    );
  }, [saveFile, filePath, headers, rows]);

  // Cmd+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        doSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [doSave]);

  const fileName = filePath.split("/").pop() ?? "data.csv";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {rows.length} rows, {headers.length} columns
          {filterInputs.size > 0 && ` (${sortedRows.length} shown)`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowFilters((prev) => !prev)}
            title="Toggle filters"
            className={showFilters ? "bg-accent" : ""}
          >
            <Filter className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={addRow} title="Add row">
            <Plus className="h-3.5 w-3.5" />
            Row
          </Button>
          <Button variant="ghost" size="xs" onClick={addColumn} title="Add column">
            <Plus className="h-3.5 w-3.5" />
            Col
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => downloadCSV(headers, rows, fileName)}
            title="Download CSV"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground ml-1" aria-live="polite">
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "unsaved" && "Unsaved changes"}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={saveStatus === "saved" || saveStatus === "saving"}
            onClick={doSave}
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="flex-1 overflow-auto min-h-0 text-xs">
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <thead className="sticky top-0 z-10" style={{ display: "block" }}>
            {/* Header row */}
            <tr
              style={{
                display: "grid",
                gridTemplateColumns: `40px repeat(${headers.length}, minmax(120px, 1fr))`,
              }}
            >
              <th className="px-1 py-2 font-medium text-center bg-muted text-muted-foreground border-b">
                #
              </th>
              {headers.map((col, colIndex) => (
                <th
                  key={`${colIndex}-${col}`}
                  className="group px-1 py-2 font-medium text-left whitespace-nowrap bg-muted border-b"
                >
                  <div className="flex items-center gap-0.5">
                    <span
                      ref={(el) => {
                        headerSpanRefs.current[colIndex] = el;
                      }}
                      className="truncate flex-1 px-1 outline-none focus:ring-2 focus:ring-primary focus:bg-primary/10 rounded-sm"
                      contentEditable
                      suppressContentEditableWarning
                      onPaste={handlePaste}
                      onBlur={(e) => commitHeaderEdit(colIndex, e.currentTarget.textContent ?? "")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          e.currentTarget.textContent = col;
                          e.currentTarget.blur();
                        }
                      }}
                    >
                      {col}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 p-0.5 rounded hover:bg-accent"
                      onClick={() => handleSort(colIndex)}
                      title="Sort column"
                    >
                      {sortConfig?.columnIndex === colIndex ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-primary" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-primary" />
                        )
                      ) : (
                        <ArrowUp className="h-3 w-3 text-muted-foreground/40" />
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 shrink-0"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="text-xs">
                        <DropdownMenuItem
                          onClick={() => {
                            const span = headerSpanRefs.current[colIndex];
                            if (span) focusCell(span);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteColumn(colIndex)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3 w-3 mr-1.5" />
                          Delete column
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </th>
              ))}
            </tr>
            {/* Filter row */}
            {showFilters && (
              <tr
                style={{
                  display: "grid",
                  gridTemplateColumns: `40px repeat(${headers.length}, minmax(120px, 1fr))`,
                }}
              >
                <th className="bg-muted border-b" />
                {headers.map((_, colIndex) => (
                  <th key={colIndex} className="px-1 py-1 bg-muted border-b">
                    <input
                      type="text"
                      placeholder="Filter..."
                      className="w-full px-1.5 py-0.5 text-xs font-normal rounded border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
                      onChange={(e) => debouncedSetFilter(colIndex, e.target.value)}
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody
            style={{
              display: "block",
              position: "relative",
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const { row, originalIndex } = sortedRows[virtualRow.index];
              return (
                <tr
                  key={originalIndex}
                  className="group/row hover:bg-muted/30"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `40px repeat(${headers.length}, minmax(120px, 1fr))`,
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <td className="px-1 py-2 text-center text-muted-foreground relative">
                    <span className="group-hover/row:opacity-0">{originalIndex + 1}</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="absolute inset-0 h-full w-full p-0 opacity-0 group-hover/row:opacity-100 text-destructive hover:text-destructive"
                      onClick={() => deleteRow(originalIndex)}
                      title="Delete row"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                  {headers.map((_, colIndex) => (
                    <td
                      key={colIndex}
                      data-row={originalIndex}
                      data-col={colIndex}
                      className="px-2 py-2 whitespace-nowrap truncate outline-none focus:ring-2 focus:ring-primary focus:ring-inset focus:bg-primary/10 rounded-sm"
                      contentEditable
                      suppressContentEditableWarning
                      onPaste={handlePaste}
                      onBlur={(e) =>
                        commitCellEdit(originalIndex, colIndex, e.currentTarget.textContent ?? "")
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          e.currentTarget.textContent = row[colIndex] ?? "";
                          e.currentTarget.blur();
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          e.currentTarget.blur();
                          const nextCol = e.shiftKey
                            ? colIndex > 0
                              ? colIndex - 1
                              : colIndex
                            : colIndex < headers.length - 1
                              ? colIndex + 1
                              : colIndex;
                          if (nextCol !== colIndex) {
                            const tr = e.currentTarget.parentElement;
                            const nextTd = tr?.children[nextCol + 1];
                            if (nextTd instanceof HTMLElement) focusCell(nextTd);
                          }
                        }
                        if (
                          e.key === "ArrowLeft" &&
                          isCaretAtStart(e.currentTarget) &&
                          colIndex > 0
                        ) {
                          e.preventDefault();
                          const tr = e.currentTarget.parentElement;
                          const prevTd = tr?.children[colIndex];
                          if (prevTd instanceof HTMLElement) focusCell(prevTd);
                        }
                        if (
                          e.key === "ArrowRight" &&
                          isCaretAtEnd(e.currentTarget) &&
                          colIndex < headers.length - 1
                        ) {
                          e.preventDefault();
                          const tr = e.currentTarget.parentElement;
                          const nextTd = tr?.children[colIndex + 2];
                          if (nextTd instanceof HTMLElement) focusCell(nextTd);
                        }
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                          const container = scrollRef.current;
                          if (!container) return;
                          const targetVirtualIdx =
                            e.key === "ArrowUp" ? virtualRow.index - 1 : virtualRow.index + 1;
                          if (targetVirtualIdx < 0 || targetVirtualIdx >= sortedRows.length) return;
                          const targetOrigIdx = sortedRows[targetVirtualIdx].originalIndex;
                          e.preventDefault();
                          e.currentTarget.blur();
                          const target = container.querySelector<HTMLElement>(
                            `td[data-row="${targetOrigIdx}"][data-col="${colIndex}"]`,
                          );
                          if (target) {
                            focusCell(target);
                          } else {
                            virtualizer.scrollToIndex(targetVirtualIdx, { align: "auto" });
                            requestAnimationFrame(() => {
                              const el = container.querySelector<HTMLElement>(
                                `td[data-row="${targetOrigIdx}"][data-col="${colIndex}"]`,
                              );
                              if (el) focusCell(el);
                            });
                          }
                        }
                      }}
                    >
                      {row[colIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
