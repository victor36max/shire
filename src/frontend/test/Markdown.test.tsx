import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import { MemoryRouter } from "react-router-dom";
import { ProjectLayoutProvider } from "../providers/ProjectLayoutProvider";
import Markdown from "../components/Markdown";

const layoutValue = {
  projectId: "p1",
  projectName: "test-project",
  sidebarOpen: false,
  setSidebarOpen: () => {},
  onNewAgent: () => {},
  onBrowseCatalog: () => {},
  panelFilePath: null,
  setPanelFilePath: () => {},
};

function renderMarkdown(children: string) {
  return render(
    <MemoryRouter>
      <ProjectLayoutProvider value={layoutValue}>
        <Markdown>{children}</Markdown>
      </ProjectLayoutProvider>
    </MemoryRouter>,
  );
}

describe("Markdown", () => {
  it("renders code blocks", () => {
    const { container } = renderMarkdown("```js\nconsole.log('hello');\n```");
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    const code = container.querySelector("pre code");
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toContain("console.log");
  });

  it("renders inline code", () => {
    const { container } = renderMarkdown("Use `myVar` here");
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toBe("myVar");
  });

  it("renders plain text", () => {
    renderMarkdown("Hello world");
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("applies prose classes to container", () => {
    const { container } = renderMarkdown("Test");
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("prose");
    expect(wrapper?.className).toContain("dark:prose-invert");
  });

  it("renders links", () => {
    renderMarkdown("[link](https://example.com)");
    expect(screen.getByText("link")).toBeInTheDocument();
  });

  it("renders shared drive paths as clickable links", () => {
    renderMarkdown("See /shared/docs/report.md for details");
    const link = screen.getByText("/shared/docs/report.md");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/projects/test-project/shared?file=%2Fdocs%2Freport.md",
    );
  });
});
