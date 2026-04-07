import {
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  $applyNodeReplacement,
} from "lexical";
import { ImageComponent } from "./ImageComponent";

export type SerializedImageNode = Spread<
  {
    url: string | null;
    altText: string | null;
    width: number | null;
    height: number | null;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __url: string | null = null;
  __altText: string | null = null;
  __width: number | null = null;
  __height: number | null = null;

  static getType() {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__url, node.__altText, node.__width, node.__height, node.__key);
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const { url, altText, width, height } = serializedNode;
    return new ImageNode(url, altText, width, height).updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: (domNode): DOMConversionOutput => {
          const img = domNode as HTMLImageElement;
          const { src, alt, width, height } = img;
          return {
            node: new ImageNode(src, alt, width, height),
          };
        },
        priority: 0,
      }),
    };
  }

  constructor(
    url: string | null,
    altText: string | null,
    width: number | null,
    height: number | null,
    key?: NodeKey,
  ) {
    super(key);
    this.__url = url;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
  }

  getUrl(): string | null {
    return this.__url;
  }

  getAltText(): string | null {
    return this.__altText;
  }

  getWidth(): number | null {
    return this.__width;
  }

  getHeight(): number | null {
    return this.__height;
  }

  setUrl(url: string): void {
    const writable = this.getWritable();
    writable.__url = url;
  }

  setAltText(altText: string | null): void {
    const writable = this.getWritable();
    writable.__altText = altText;
  }

  setWidth(width: number | null): void {
    const writable = this.getWritable();
    writable.__width = width;
  }

  setHeight(height: number | null): void {
    const writable = this.getWritable();
    writable.__height = height;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      url: this.__url,
      altText: this.__altText,
      height: this.__height,
      width: this.__width,
    };
  }

  exportDOM(): DOMExportOutput {
    if (!this.__url) {
      return { element: null };
    }

    const element = document.createElement("img");
    element.setAttribute("src", this.__url);

    if (this.__altText) {
      element.setAttribute("alt", this.__altText);
    }

    if (this.__width) {
      element.setAttribute("width", this.__width.toString());
    }

    if (this.__height) {
      element.setAttribute("height", this.__height.toString());
    }

    return { element };
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  updateDOM() {
    return false;
  }

  decorate(): React.JSX.Element {
    if (!this.__url) {
      return <></>;
    }
    return (
      <ImageComponent
        key={this.__url}
        nodeKey={this.getKey()}
        src={this.__url}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
      />
    );
  }
}

export const $createImageNode = (
  url: string,
  altText: string | null = null,
  width: number | null = null,
  height: number | null = null,
): ImageNode => {
  return $applyNodeReplacement(new ImageNode(url, altText, width, height));
};

export const $isImageNode = (node: unknown): node is ImageNode => {
  return node instanceof ImageNode;
};
