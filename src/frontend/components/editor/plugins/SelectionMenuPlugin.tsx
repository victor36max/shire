import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { cn, isValidUrl } from "../../lib/utils";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  getDOMSelection,
  TextFormatType,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Check, Code, Italic, Link, Pencil, Underline, X } from "lucide-react";
import { $isLinkNode, $toggleLink } from "@lexical/link";
import { $isCodeHighlightNode, $isCodeNode } from "@lexical/code";

interface SelectionMenuPluginProps {
  anchorElement: HTMLDivElement | null;
}

const DEFAULT_PREFILLED_URL = "https://";

export const SelectionMenuPlugin = ({
  anchorElement,
}: SelectionMenuPluginProps): React.JSX.Element | null => {
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [prefilledUrl, setPrefilledUrl] = useState<string>(DEFAULT_PREFILLED_URL);
  const [linkUrlError, setLinkUrlError] = useState<string | null>(null);
  const [isCode, setIsCode] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [isEditingLink, setIsEditingLink] = useState(false);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setIsCreatingLink(false);
    setIsEditingLink(false);
    setLinkUrl(null);
    setLinkUrlError(null);
  }, []);

  const handleFormat = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const handleToggleLink = useCallback(() => {
    if (linkUrl) {
      editor.update(() => {
        $toggleLink(null);
      });
    } else {
      editor.read(() => {
        const selection = $getSelection();
        if (!selection || !$isRangeSelection(selection)) {
          return;
        }
        const selectionText = selection.getTextContent();
        if (isValidUrl(selectionText)) {
          setPrefilledUrl(selectionText);
        } else {
          setPrefilledUrl(DEFAULT_PREFILLED_URL);
        }

        setIsCreatingLink(true);
      });
    }
  }, [editor, linkUrl]);

  const handleLinkSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.target as HTMLFormElement);
      const link = formData.get("link") as string;

      if (!link || !isValidUrl(link)) {
        setLinkUrlError("Invalid URL");
        return;
      }

      editor.update(() => {
        $toggleLink(link, {
          target: "_blank",
          rel: "noreferrer",
        });
        $setSelection(null);
      });
    },
    [editor],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        editor.read(() => {
          const selection = $getSelection();
          if (!selection || !$isRangeSelection(selection) || !anchorElement) {
            closeMenu();
            return;
          }

          if (
            $isCodeNode(selection.anchor.getNode()) ||
            $isCodeHighlightNode(selection.anchor.getNode())
          ) {
            closeMenu();
            return;
          }

          if (
            selection.anchor.key === selection.focus.key &&
            selection.anchor.offset === selection.focus.offset
          ) {
            closeMenu();
            return;
          }

          const nativeSelection = getDOMSelection(editor._window);

          if (!nativeSelection) {
            closeMenu();
            return;
          }

          if (nativeSelection.rangeCount === 0) {
            closeMenu();
            return;
          }

          const nativeRange = nativeSelection.getRangeAt(0);

          const selectionRect = nativeRange.getBoundingClientRect();
          const anchorRect = anchorElement.getBoundingClientRect();

          setIsBold(selection.hasFormat("bold"));
          setIsItalic(selection.hasFormat("italic"));
          setIsUnderline(selection.hasFormat("underline"));
          setIsCode(selection.hasFormat("code"));

          const linkNode = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);

          setLinkUrl(linkNode?.getURL() || null);

          setPosition({
            top: selectionRect.y + selectionRect.height - anchorRect.y,
            left: Math.min(
              selectionRect.x - anchorRect.x,
              anchorRect.width - (selectionMenuRef.current?.clientWidth || 0),
            ),
          });

          setIsOpen(true);
        });
      }),
    );
  }, [anchorElement, editor, closeMenu]);

  if (!anchorElement) {
    return null;
  }

  const renderFormattingMenu = () => {
    return (
      <div className="flex flex-row border border-border rounded-lg">
        <FormatButton
          active={isBold}
          onClick={() => handleFormat("bold")}
          icon={<Bold className="w-4 h-4" strokeWidth={2} />}
          isFirst
        />
        <FormatButton
          active={isItalic}
          onClick={() => handleFormat("italic")}
          icon={<Italic className="w-4 h-4" strokeWidth={2} />}
        />
        <FormatButton
          active={isUnderline}
          onClick={() => handleFormat("underline")}
          icon={<Underline className="w-4 h-4" strokeWidth={2} />}
        />
        <FormatButton
          active={!!linkUrl}
          onClick={handleToggleLink}
          icon={<Link className="w-4 h-4" strokeWidth={2} />}
        />
        <FormatButton
          active={isCode}
          onClick={() => handleFormat("code")}
          icon={<Code className="w-4 h-4" strokeWidth={2} />}
          isLast
        />
      </div>
    );
  };

  return createPortal(
    <div
      style={{ position: "absolute", top: position?.top, left: position?.left }}
      className={cn(!isOpen && "invisible pointer-events-none")}
      ref={selectionMenuRef}
    >
      <div className="mt-2 font-sans flex flex-col gap-2">
        {linkUrl && !isEditingLink && (
          <div className="flex flex-row gap-2 items-center bg-background border border-border rounded-lg px-4 py-3">
            <a
              href={linkUrl}
              target="_blank"
              rel="noreferrer"
              className="underline text-primary flex-1 text-sm"
            >
              {linkUrl}
            </a>
            <button
              type="button"
              onClick={() => setIsEditingLink(true)}
              className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-accent"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
        {(isCreatingLink || isEditingLink) && (
          <form
            className="flex flex-row gap-2 items-center bg-background border border-border rounded-lg p-2"
            onSubmit={handleLinkSubmit}
          >
            <div className="flex flex-col gap-1">
              <input
                type="text"
                name="link"
                placeholder="Enter link"
                autoFocus={isCreatingLink}
                defaultValue={linkUrl || prefilledUrl}
                onChange={() => {
                  setLinkUrlError(null);
                }}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm",
                  linkUrlError && "border-destructive",
                )}
              />
              {linkUrlError && <i className="text-xs text-destructive">{linkUrlError}</i>}
            </div>
            <button
              type="button"
              onClick={() => {
                setIsEditingLink(false);
                setIsCreatingLink(false);
                setLinkUrlError(null);
              }}
              className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-accent"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-accent"
            >
              <Check className="w-4 h-4" />
            </button>
          </form>
        )}
        {!isCreatingLink && !isEditingLink && renderFormattingMenu()}
      </div>
    </div>,
    anchorElement,
  );
};

function FormatButton({
  active,
  onClick,
  icon,
  isFirst,
  isLast,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center h-8 w-8",
        !isFirst && "border-l border-border",
        !isLast && "",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
        isFirst && "rounded-l-lg",
        isLast && "rounded-r-lg",
      )}
    >
      {icon}
    </button>
  );
}
