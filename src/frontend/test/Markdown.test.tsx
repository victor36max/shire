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
});
