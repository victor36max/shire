import { LexicalEditor, $getNodeByKey } from "lexical";
import { $isTableCellNode } from "@lexical/table";
import { OPEN_TABLE_ACTION_MENU_COMMAND } from "./plugins/table-commands";
import { ChevronDown } from "lucide-react";

export const TableCellActionButton = ({
  editor,
  nodeKey,
}: {
  editor: LexicalEditor;
  nodeKey: string;
}): React.JSX.Element => {
  const dispatch = () => {
    let cellKey: string | null = null;
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if (!node) return;

      let parent = node.getParent();
      while (parent && !$isTableCellNode(parent)) {
        parent = parent.getParent();
      }
      if (!parent) return;

      cellKey = parent.getKey();
    });
    if (cellKey) {
      editor.dispatchCommand(OPEN_TABLE_ACTION_MENU_COMMAND, { cellKey });
    }
  };

  return (
    <button
      type="button"
      className="shire-table-cell-action-button"
      contentEditable={false}
      tabIndex={-1}
      aria-label="Table actions"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch();
      }}
    >
      <ChevronDown className="w-4 h-4" />
    </button>
  );
};
