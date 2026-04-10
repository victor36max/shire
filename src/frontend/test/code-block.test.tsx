import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import {
  CodeBlock,
  CodeBlockContainer,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "../components/ai-elements/code-block";

describe("CodeBlock", () => {
  it("renders code content", () => {
    render(<CodeBlock code='console.log("hello")' language="javascript" />);
    expect(screen.getByText(/console\.log/)).toBeInTheDocument();
  });

  it("renders as pre/code elements", () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(container.querySelector("code")).toBeInTheDocument();
  });

  it("sets data-language attribute", () => {
    const { container } = render(<CodeBlock code="x = 1" language="python" />);
    const wrapper = container.querySelector("[data-language]");
    expect(wrapper?.getAttribute("data-language")).toBe("python");
  });

  it("applies custom className", () => {
    const { container } = render(
      <CodeBlock code="test" language="markdown" className="custom-class" />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("custom-class");
  });
});

describe("CodeBlockContainer", () => {
  it("renders with language and children", () => {
    const { container } = render(
      <CodeBlockContainer language="json">
        <span>inner</span>
      </CodeBlockContainer>,
    );
    expect(container.querySelector("[data-language='json']")).toBeInTheDocument();
    expect(screen.getByText("inner")).toBeInTheDocument();
  });
});

describe("CodeBlockHeader", () => {
  it("renders header with children", () => {
    render(
      <CodeBlockHeader>
        <CodeBlockTitle>file.ts</CodeBlockTitle>
        <CodeBlockActions>
          <button type="button">action</button>
        </CodeBlockActions>
      </CodeBlockHeader>,
    );
    expect(screen.getByText("file.ts")).toBeInTheDocument();
    expect(screen.getByText("action")).toBeInTheDocument();
  });
});

describe("CodeBlockContent", () => {
  it("renders code with raw tokens initially", () => {
    const { container } = render(<CodeBlockContent code="hello world" language="markdown" />);
    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders multiline code", () => {
    const code = "line1\nline2\nline3";
    render(<CodeBlockContent code={code} language="markdown" />);
    expect(screen.getByText("line1")).toBeInTheDocument();
    expect(screen.getByText("line2")).toBeInTheDocument();
    expect(screen.getByText("line3")).toBeInTheDocument();
  });
});

describe("CodeBlockCopyButton", () => {
  it("renders copy button inside CodeBlock", () => {
    render(
      <CodeBlock code="copy me" language="markdown">
        <CodeBlockHeader>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });
});
