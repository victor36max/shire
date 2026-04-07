import { DEFAULT_TRANSFORMERS } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TextMatchTransformer } from "@lexical/markdown";
import { $createImageNode, $isImageNode, ImageNode } from "./nodes/ImageNode";

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

export const MARKDOWN_TRANSFORMERS = [IMAGE, ...DEFAULT_TRANSFORMERS];
