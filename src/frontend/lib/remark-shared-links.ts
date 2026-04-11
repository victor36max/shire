import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root, PhrasingContent } from "mdast";

function stripTrailingPunctuation(path: string): string {
  return path.replace(/[.,;:]+$/, "");
}

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
  };
}
