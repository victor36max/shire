import { describe, it, expect, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SharedDriveLink } from "../components/chat/SharedDriveLink";
import { ProjectLayoutProvider } from "../providers/ProjectLayoutProvider";

const layoutValue = {
  projectId: "p1",
  projectName: "my-project",
  sidebarOpen: false,
  setSidebarOpen: () => {},
  onNewAgent: () => {},
  onBrowseCatalog: () => {},
  panelFilePath: null,
  setPanelFilePath: mock(() => {}),
};

function renderLink(href: string, text: string, projectName = "my-project") {
  return render(
    <MemoryRouter>
      <ProjectLayoutProvider value={{ ...layoutValue, projectName }}>
        <SharedDriveLink href={href} projectName={projectName}>
          {text}
        </SharedDriveLink>
      </ProjectLayoutProvider>
    </MemoryRouter>,
  );
}

describe("SharedDriveLink", () => {
  it("renders shared drive paths as internal links", () => {
    renderLink("/shared/docs/report.md", "/shared/docs/report.md");
    const link = screen.getByText("/shared/docs/report.md");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/projects/my-project/shared?file=%2Fdocs%2Freport.md");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("renders external links with target=_blank", () => {
    renderLink("https://example.com", "Example");
    const link = screen.getByText("Example");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("encodes the file path in the URL", () => {
    renderLink("/shared/my folder/file name.md", "test");
    const link = screen.getByText("test");
    expect(link.getAttribute("href")).toBe(
      "/projects/my-project/shared?file=%2Fmy%20folder%2Ffile%20name.md",
    );
  });

  it("calls setPanelFilePath on click instead of navigating", async () => {
    const setPanelFilePath = mock(() => {});
    render(
      <MemoryRouter>
        <ProjectLayoutProvider value={{ ...layoutValue, setPanelFilePath }}>
          <SharedDriveLink href="/shared/hello.md" projectName="my-project">
            /shared/hello.md
          </SharedDriveLink>
        </ProjectLayoutProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("/shared/hello.md"));
    expect(setPanelFilePath).toHaveBeenCalledWith("/hello.md");
  });
});
