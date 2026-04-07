import {
  DecoratorNode,
  type DOMExportOutput,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { TableCellActionButton } from "../TableCellActionButton";

export type SerializedTableCellActionNode = Spread<
  {
    type: "table-cell-action";
    version: 1;
  },
  SerializedLexicalNode
>;

export class TableCellActionNode extends DecoratorNode<React.JSX.Element> {
  static getType(): string {
    return "table-cell-action";
  }

  static clone(node: TableCellActionNode): TableCellActionNode {
    return new TableCellActionNode(node.__key);
  }

  static importJSON(_serializedNode: SerializedTableCellActionNode): TableCellActionNode {
    return new TableCellActionNode();
  }

  exportJSON(): SerializedTableCellActionNode {
    return {
      type: "table-cell-action",
      version: 1,
    };
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "fw-table-cell-action";
    dom.setAttribute("contenteditable", "false");
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    return { element };
  }

  decorate(editor: LexicalEditor): React.JSX.Element {
    return <TableCellActionButton editor={editor} nodeKey={this.getKey()} />;
  }
}

export const $createTableCellActionNode = () => new TableCellActionNode();

export const $isTableCellActionNode = (node: unknown): node is TableCellActionNode =>
  node instanceof TableCellActionNode;
