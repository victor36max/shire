import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import Markdown from "../components/Markdown";

describe("Markdown", () => {
  it("renders code blocks", () => {
    const { container } = render(<Markdown>{"```js\nconsole.log('hello');\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    const code = container.querySelector("pre code");
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toContain("console.log");
  });

  it("renders inline code", () => {
    const { container } = render(<Markdown>{"Use `myVar` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toBe("myVar");
  });

  it("renders plain text", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("applies prose classes to container", () => {
    const { container } = render(<Markdown>{"Test"}</Markdown>);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("prose");
    expect(wrapper?.className).toContain("dark:prose-invert");
  });

  it("renders links", () => {
    render(<Markdown>{"[link](https://example.com)"}</Markdown>);
    expect(screen.getByText("link")).toBeInTheDocument();
  });
});
