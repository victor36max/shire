import { findAndReplace } from "mdast-util-find-and-replace";
import { visit, CONTINUE } from "unist-util-visit";
import type { Root, PhrasingContent, Parent } from "mdast";

function stripTrailingPunctuation(path: string): string {
  return path.replace(/[.,;:]+$/, "");
}

const sharedPathOnly = /^\/shared\/\S+$/;

export default function remarkSharedLinks() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        /\/shared\/[^\s)}\]"'`,;!]+/g,
        (match: string): PhrasingContent => {
          const cleanPath = stripTrailingPunctuation(match);
          return {
            type: "link",
            url: cleanPath,
            children: [{ type: "text", value: cleanPath }],
          };
        },
      ],
    ]);

    // Also handle backtick-wrapped paths like `/shared/file.txt`
    visit(tree, "inlineCode", (node, index, parent) => {
      if (index === undefined || !parent) return;
      const value = node.value.trim();
      if (!sharedPathOnly.test(value)) return;
      const cleanPath = stripTrailingPunctuation(value);
      (parent as Parent).children.splice(index, 1, {
        type: "link",
        url: cleanPath,
        children: [{ type: "text", value: cleanPath }],
      });
      return [CONTINUE, index + 1] as const;
    });
  };
}
