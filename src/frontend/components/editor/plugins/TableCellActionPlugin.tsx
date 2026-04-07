import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { $isTableCellNode, TableCellNode } from "@lexical/table";
import { useEffect } from "react";
import { $getNodeByKey } from "lexical";
import { $createTableCellActionNode, $isTableCellActionNode } from "../nodes/TableCellActionNode";

export const TableCellActionPlugin = (): null => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const ensureCellHasOneActionNode = (cellNode: TableCellNode) => {
      const actionNodes = cellNode.getChildren().filter($isTableCellActionNode);

      if (actionNodes.length === 0) {
        const actionNode = $createTableCellActionNode();
        const firstChild = cellNode.getFirstChild();
        if (firstChild) {
          firstChild.insertBefore(actionNode);
        } else {
          cellNode.append(actionNode);
        }
        return;
      }

      for (let i = 1; i < actionNodes.length; i++) {
        actionNodes[i].remove();
      }
    };

    return mergeRegister(
      editor.registerMutationListener(
        TableCellNode,
        (mutations) => {
          editor.update(() => {
            for (const [nodeKey, mutation] of mutations) {
              if (mutation === "destroyed") continue;
              const node = $getNodeByKey(nodeKey);
              if (!node || !$isTableCellNode(node)) continue;
              ensureCellHasOneActionNode(node);
            }
          });
        },
        { skipInitialization: false },
      ),
    );
  }, [editor]);

  return null;
};
