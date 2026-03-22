import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Markdown from "../react-components/components/Markdown";

describe("Markdown", () => {
  it("renders code blocks with inverted background", () => {
    const { container } = render(<Markdown>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.className).toContain("bg-foreground");
    expect(pre?.className).toContain("text-background");
  });

  it("renders block code element with transparent background", () => {
    const { container } = render(<Markdown>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const code = container.querySelector("pre code");
    expect(code).toBeInTheDocument();
    expect(code?.className).toContain("bg-transparent");
  });

  it("renders inline code with inverted background", () => {
    const { container } = render(<Markdown>{"Use `myVar` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.className).toContain("bg-foreground");
    expect(code?.className).toContain("text-background");
  });

  it("renders code blocks with subtle background when inverted", () => {
    const { container } = render(<Markdown inverted>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.className).toContain("bg-background/20");
    expect(pre?.className).not.toContain("bg-foreground");
  });

  it("renders inline code with subtle background when inverted", () => {
    const { container } = render(<Markdown inverted>{"Use `myVar` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.className).toContain("bg-background/20");
    expect(code?.className).not.toContain("bg-foreground");
  });
});
