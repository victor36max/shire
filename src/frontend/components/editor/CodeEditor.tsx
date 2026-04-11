import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { useSaveFileContent } from "../../hooks/shared-drive";
import { getLanguageExtension } from "../../lib/codemirror-languages";

type SaveStatus = "saved" | "saving" | "unsaved";

interface CodeEditorProps {
  initialContent: string;
  projectId: string;
  filePath: string;
}

function subscribeToDarkMode(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getIsDark() {
  return document.documentElement.classList.contains("dark");
}

function useDarkMode(): boolean {
  return useSyncExternalStore(subscribeToDarkMode, getIsDark, () => false);
}

export default function CodeEditor({ initialContent, projectId, filePath }: CodeEditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const { mutate: saveFile } = useSaveFileContent(projectId);
  const contentRef = useRef(initialContent);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const dark = useDarkMode();

  const doSave = useCallback(() => {
    const content = contentRef.current;
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

  // Register Cmd+S shortcut at the DOM level (avoids ref-in-memo issues with CodeMirror keymap)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        // Only handle if the editor is focused
        const editorDom = editorRef.current?.editor;
        if (editorDom?.contains(document.activeElement)) {
          e.preventDefault();
          doSave();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [doSave]);

  const extensions = useMemo(() => {
    const exts = [];
    const lang = getLanguageExtension(filePath);
    if (lang) exts.push(lang);
    return exts;
  }, [filePath]);

  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const handleChange = useCallback((value: string) => {
    contentRef.current = value;
    if (saveStatusRef.current === "saved") setSaveStatus("unsaved");
  }, []);

  return (
    <div className="flex flex-col h-full">
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
      <CodeMirror
        ref={editorRef}
        value={initialContent}
        onChange={handleChange}
        theme={dark ? githubDark : githubLight}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          tabSize: 2,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
        className="flex-1 min-h-0 overflow-auto"
        height="100%"
      />
    </div>
  );
}
