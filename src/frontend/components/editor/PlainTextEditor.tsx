import { useCallback, useRef, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useSaveFileContent } from "../../hooks/shared-drive";

type SaveStatus = "saved" | "saving" | "unsaved";

interface PlainTextEditorProps {
  initialContent: string;
  projectId: string;
  filePath: string;
}

export default function PlainTextEditor({
  initialContent,
  projectId,
  filePath,
}: PlainTextEditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const { mutate: saveFile } = useSaveFileContent(projectId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const doSave = useCallback(() => {
    const content = textareaRef.current?.value ?? "";
    setSaveStatus("saving");
    saveFile(
      { path: filePath, content },
      {
        onSuccess: () => setSaveStatus("saved"),
        onError: () => {
          setSaveStatus("unsaved");
          toast.error("Failed to save file");
        },
      },
    );
  }, [saveFile, filePath]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        doSave();
        return;
      }
      // Insert 2 spaces on Tab instead of losing focus
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + "  " + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        setSaveStatus("unsaved");
      }
    },
    [doSave],
  );

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-end gap-2 px-2 py-1 border-b border-border">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "unsaved" && "Unsaved changes"}
        </span>
        <button
          type="button"
          disabled={saveStatus === "saved" || saveStatus === "saving"}
          onClick={doSave}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
        >
          <Save className="w-3 h-3" />
          Save
        </button>
      </div>
      <textarea
        ref={textareaRef}
        defaultValue={initialContent}
        onChange={() => {
          if (saveStatus === "saved") setSaveStatus("unsaved");
        }}
        className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none"
        spellCheck={false}
      />
    </div>
  );
}
