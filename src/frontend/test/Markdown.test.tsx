import { render } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import Markdown from "../components/Markdown";

describe("Markdown", () => {
  it("renders code blocks with muted background", () => {
    const { container } = render(<Markdown>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.className).toContain("bg-muted");
    expect(pre?.className).toContain("text-foreground");
  });

  it("renders block code element with transparent background", () => {
    const { container } = render(<Markdown>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const code = container.querySelector("pre code");
    expect(code).toBeInTheDocument();
    expect(code?.className).toContain("bg-transparent");
  });

  it("renders inline code with muted background", () => {
    const { container } = render(<Markdown>{"Use `myVar` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.className).toContain("bg-muted");
    expect(code?.className).toContain("text-foreground");
  });

  it("renders links with target=_blank and rel=noopener", () => {
    const { container } = render(<Markdown>{"[Click here](https://example.com)"}</Markdown>);
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.className).toContain("text-primary");
  });

  it("applies custom className", () => {
    const { container } = render(<Markdown className="my-custom-class">{"Hello"}</Markdown>);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("my-custom-class");
  });

  it("renders without className when not provided", () => {
    const { container } = render(<Markdown>{"Hello"}</Markdown>);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("prose");
  });

  it("renders GFM tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).toBeInTheDocument();
  });

  it("renders inline code with font-mono class", () => {
    const { container } = render(<Markdown>{"Use `code` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).toContain("font-mono");
  });
});
