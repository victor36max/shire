import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { toast } from "sonner";
import { Save } from "lucide-react";
import type { EditorState, LexicalEditor } from "lexical";

import { SlashMenuPlugin } from "./plugins/SlashMenuPlugin";
import { SelectionMenuPlugin } from "./plugins/SelectionMenuPlugin";
import { InsertTableMenuPlugin } from "./plugins/InsertTableMenuPlugin";
import { InsertImagePlugin } from "./plugins/InsertImagePlugin";
import { TableActionMenuPlugin } from "./plugins/TableActionMenuPlugin";
import { TableCellActionPlugin } from "./plugins/TableCellActionPlugin";
import CodeHighlightPrismPlugin from "./plugins/CodeHighlightPrismPlugin";
import { MARKDOWN_TRANSFORMERS } from "./markdownTransformers";
import { ImageNode } from "./nodes/ImageNode";
import { TableCellActionNode } from "./nodes/TableCellActionNode";
import { useSaveFileContent } from "../../hooks/shared-drive";

type SaveStatus = "saved" | "saving" | "unsaved";

interface SharedDriveEditorProps {
  initialMarkdown: string;
  projectId: string;
  filePath: string;
}

const editorTheme = {
  list: {
    listitemChecked: "shire-checklist-item shire-checked",
    listitemUnchecked: "shire-checklist-item",
  },
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
  },
  codeHighlight: {
    atrule: "shire-keyword",
    attr: "shire-attr",
    "attr-name": "shire-property",
    "attr-value": "shire-attr",
    boolean: "shire-property",
    builtin: "shire-attr",
    cdata: "shire-comment",
    char: "shire-attr",
    class: "shire-function",
    "class-name": "shire-function",
    comment: "shire-comment",
    constant: "shire-property",
    deleted: "shire-property",
    doctype: "shire-comment",
    entity: "shire-operator",
    function: "shire-function",
    important: "shire-variable",
    inserted: "shire-attr",
    keyword: "shire-keyword",
    namespace: "shire-variable",
    number: "shire-property",
    operator: "shire-operator",
    prolog: "shire-comment",
    property: "shire-property",
    punctuation: "shire-punctuation",
    regex: "shire-variable",
    selector: "shire-selector",
    string: "shire-attr",
    symbol: "shire-property",
    tag: "shire-selector",
    url: "shire-operator",
    variable: "shire-variable",
    def: "shire-property",
  },
};

function EditorRefCapture({
  editorRef,
}: {
  editorRef: React.MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

export default function SharedDriveEditor({
  initialMarkdown,
  projectId,
  filePath,
}: SharedDriveEditorProps) {
  const [anchorElement, setAnchorElement] = useState<HTMLDivElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const { mutate: saveFile } = useSaveFileContent(projectId);
  const editorRef = useRef<LexicalEditor | null>(null);

  const doSave = useCallback(
    (editorState: EditorState) => {
      setSaveStatus("saving");
      let markdown = "";
      editorState.read(() => {
        markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
      });
      saveFile(
        { path: filePath, content: markdown },
        {
          onSuccess: () => setSaveStatus("saved"),
          onError: () => {
            setSaveStatus("unsaved");
            toast.error("Failed to save file");
          },
        },
      );
    },
    [saveFile, filePath],
  );

  const debouncedSave = useDebouncedCallback((editorState: EditorState) => {
    doSave(editorState);
  }, 1000);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      setSaveStatus("unsaved");
      debouncedSave(editorState);
    },
    [debouncedSave],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        debouncedSave.cancel();
        if (editorRef.current) {
          doSave(editorRef.current.getEditorState());
        }
      }
    },
    [debouncedSave, doSave],
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
          onClick={() => {
            debouncedSave.cancel();
            if (editorRef.current) {
              doSave(editorRef.current.getEditorState());
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
        >
          <Save className="w-3 h-3" />
          Save
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <LexicalComposer
          initialConfig={{
            namespace: "shire-editor",
            nodes: [
              LinkNode,
              AutoLinkNode,
              ListNode,
              ListItemNode,
              TableNode,
              TableCellNode,
              TableRowNode,
              TableCellActionNode,
              HorizontalRuleNode,
              CodeNode,
              HeadingNode,
              QuoteNode,
              CodeHighlightNode,
              ImageNode,
            ],
            theme: editorTheme,
            editorState: () => {
              $convertFromMarkdownString(initialMarkdown, MARKDOWN_TRANSFORMERS);
            },
            onError: (error) => {
              console.error(error);
            },
          }}
        >
          <EditorRefCapture editorRef={editorRef} />
          <RichTextPlugin
            contentEditable={
              <div className="prose prose-sm max-w-none relative p-4" ref={setAnchorElement}>
                <ContentEditable
                  aria-placeholder="Start writing..."
                  className="shire-content-root outline-none"
                  placeholder={() => (
                    <p className="text-muted-foreground absolute top-4 left-4 pointer-events-none -z-10">
                      Start writing, or press &quot;/&quot; for formatting options.
                    </p>
                  )}
                />
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <OnChangePlugin onChange={handleChange} />
          <HistoryPlugin />
          <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
          <ListPlugin hasStrictIndent />
          <CheckListPlugin />
          <TablePlugin />
          <TabIndentationPlugin />
          <SlashMenuPlugin />
          <SelectionMenuPlugin anchorElement={anchorElement} />
          <InsertTableMenuPlugin anchorElement={anchorElement} />
          <InsertImagePlugin />
          <TableCellActionPlugin />
          <TableActionMenuPlugin anchorElement={anchorElement} />
          <LinkPlugin />
          <CodeHighlightPrismPlugin anchorElement={anchorElement} />
          <HorizontalRulePlugin />
          <ClickableLinkPlugin />
        </LexicalComposer>
      </div>
    </div>
  );
}
