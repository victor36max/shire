import { $isCodeNode, $isCodeHighlightNode } from "@lexical/code";
import {
  registerCodeHighlighting,
  getCodeLanguages,
  normalizeCodeLanguage,
  getLanguageFriendlyName,
} from "@lexical/code-prism";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { $getNodeByKey, $getSelection, $isRangeSelection, LexicalNode } from "lexical";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const getNearestCodeNode = (selectionNode: LexicalNode) => {
  let current: LexicalNode | null = selectionNode;
  while (current) {
    if ($isCodeNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
};

interface CodeHighlightPrismPluginProps {
  anchorElement: HTMLDivElement | null;
}

export default function CodeHighlightPrismPlugin({ anchorElement }: CodeHighlightPrismPluginProps) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<string | null>(null);
  const [editor] = useLexicalComposerContext();
  const codeNodeKeyRef = useRef<string | null>(null);

  const codeLanguageOptions = useMemo(() => {
    if (!isOpen) return [];
    return Array.from(new Set(getCodeLanguages().map(normalizeCodeLanguage))).map((language) => ({
      label: getLanguageFriendlyName(language),
      value: language,
    }));
  }, [isOpen]);

  useEffect(() => {
    return mergeRegister(
      registerCodeHighlighting(editor),
      editor.registerUpdateListener(() => {
        editor.read(() => {
          const selection = $getSelection();
          if (!selection || !$isRangeSelection(selection)) {
            setIsOpen(false);
            return;
          }
          const selectionNode = selection.anchor.getNode();
          if (!$isCodeNode(selectionNode) && !$isCodeHighlightNode(selectionNode)) {
            setIsOpen(false);
            return;
          }
          const codeNode = getNearestCodeNode(selectionNode);
          if (!codeNode) {
            setIsOpen(false);
            return;
          }
          codeNodeKeyRef.current = codeNode.getKey();
          const currentLanguage = codeNode.getLanguage();
          setCodeLanguage(currentLanguage ? normalizeCodeLanguage(currentLanguage) : null);
          const codeElement = editor.getElementByKey(codeNode.getKey());
          if (!codeElement || !anchorElement) {
            setIsOpen(false);
            return;
          }
          const codeElementRect = codeElement.getBoundingClientRect();
          const anchorRect = anchorElement.getBoundingClientRect();
          setPosition({
            top: codeElementRect.y + codeElementRect.height - anchorRect.y,
            left: codeElementRect.x - anchorRect.x,
            width: codeElementRect.width,
          });
          setIsOpen(true);
        });
      }),
    );
  }, [anchorElement, editor]);

  if (!isOpen || !anchorElement) {
    return null;
  }

  return createPortal(
    <div
      className="h-0 mt-2 font-sans flex flex-row justify-center overflow-visible"
      style={{
        position: "absolute",
        top: position?.top,
        left: position?.left,
        width: position?.width,
      }}
    >
      <select
        className="min-w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
        value={codeLanguage || ""}
        onChange={(e) => {
          const key = e.target.value;
          if (!key) return;
          setCodeLanguage(key);
          if (codeNodeKeyRef.current) {
            editor.update(() => {
              const node = $getNodeByKey(codeNodeKeyRef.current!);
              if ($isCodeNode(node)) {
                node.setLanguage(key);
              }
            });
          }
        }}
        aria-label="Code Language"
      >
        <option value="">Select language</option>
        {codeLanguageOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>,
    anchorElement,
  );
}
