import { DEFAULT_TRANSFORMERS } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import type { MultilineElementTransformer, TextMatchTransformer } from "@lexical/markdown";
import { $createParagraphNode, $createTextNode } from "lexical";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createImageNode, $isImageNode, ImageNode } from "./nodes/ImageNode";

const TABLE_ROW_REG_EXP = /^\|(.+)\|\s*$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-+:? ?)+\|\s*$/;

function parseCells(row: string): string[] {
  return row
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) {
      return null;
    }
    const rows = node.getChildren();
    if (rows.length === 0) {
      return null;
    }
    const lines: string[] = [];
    let colCount = 0;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!$isTableRowNode(row)) continue;
      const cells = row.getChildren();
      const cellTexts: string[] = [];
      for (const cell of cells) {
        if (!$isTableCellNode(cell)) continue;
        cellTexts.push(cell.getTextContent());
      }
      if (rowIndex === 0) {
        colCount = cellTexts.length;
      }
      lines.push(`| ${cellTexts.join(" | ")} |`);
      if (rowIndex === 0) {
        lines.push(`| ${cellTexts.map(() => "---").join(" | ")} |`);
      }
    }

    return colCount > 0 ? lines.join("\n") : null;
  },
  regExpStart: TABLE_ROW_REG_EXP,
  regExpEnd: {
    optional: true,
    regExp: TABLE_ROW_REG_EXP,
  },
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    const tableLines: string[] = [];
    let endIndex = startLineIndex;

    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i];
      if (TABLE_ROW_REG_EXP.test(line) || TABLE_ROW_DIVIDER_REG_EXP.test(line)) {
        tableLines.push(line);
        endIndex = i;
      } else {
        break;
      }
    }

    if (tableLines.length < 2) {
      return null;
    }

    const dataRows = tableLines.filter((line) => !TABLE_ROW_DIVIDER_REG_EXP.test(line));
    if (dataRows.length === 0) {
      return null;
    }

    const tableNode = $createTableNode();

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
      const cells = parseCells(dataRows[rowIndex]);
      const rowNode = $createTableRowNode();
      const isHeader = rowIndex === 0;

      for (const cellText of cells) {
        const cellNode = $createTableCellNode(
          isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
        );
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(cellText));
        cellNode.append(paragraph);
        rowNode.append(cellNode);
      }

      tableNode.append(rowNode);
    }

    rootNode.append(tableNode);
    return [true, endIndex];
  },
  replace: () => {
    // handled by handleImportAfterStartMatch
    return false;
  },
  type: "multiline-element",
};

const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) {
      return null;
    }
    const url = node.getUrl();
    if (!url) {
      return null;
    }
    const altText = node.getAltText() ?? "";
    return `![${altText}](${url})`;
  },
  importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  regExp: /!\[([^\]]*)\]\(([^)]+)\)$/,
  replace: (textNode, match) => {
    const [, altText, url] = match;
    if (!url) {
      return;
    }
    const imageNode = $createImageNode(url, altText || null);
    textNode.replace(imageNode);
  },
  trigger: ")",
  type: "text-match",
};

export const MARKDOWN_TRANSFORMERS = [TABLE, IMAGE, ...DEFAULT_TRANSFORMERS];
