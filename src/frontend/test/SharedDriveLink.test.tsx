import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SharedDriveLink } from "../components/chat/SharedDriveLink";
import { ProjectLayoutProvider } from "../providers/ProjectLayoutProvider";

/** Renders the current router location so tests can assert navigation. */
function LocationDisplay() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

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

function renderLink(
  href: string,
  text: string,
  projectName = "my-project",
  opts?: { setPanelFilePath?: ReturnType<typeof mock> },
) {
  return render(
    <MemoryRouter>
      <ProjectLayoutProvider
        value={{
          ...layoutValue,
          projectName,
          ...(opts?.setPanelFilePath && { setPanelFilePath: opts.setPanelFilePath }),
        }}
      >
        <SharedDriveLink href={href} projectName={projectName}>
          {text}
        </SharedDriveLink>
      </ProjectLayoutProvider>
    </MemoryRouter>,
  );
}

function setDesktop(isDesktop: boolean) {
  window.matchMedia = mock((query: string) => ({
    matches: isDesktop && query === "(min-width: 768px)",
    media: query,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // Reset to default (mobile) after each test
  setDesktop(false);
});

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

  it("opens side panel on click on desktop", async () => {
    setDesktop(true);
    const setPanelFilePath = mock(() => {});
    renderLink("/shared/hello.md", "/shared/hello.md", "my-project", { setPanelFilePath });
    await userEvent.click(screen.getByText("/shared/hello.md"));
    expect(setPanelFilePath).toHaveBeenCalledWith("/hello.md");
  });

  it("navigates to shared drive route on click on mobile", async () => {
    setDesktop(false);
    const setPanelFilePath = mock(() => {});
    render(
      <MemoryRouter>
        <ProjectLayoutProvider value={{ ...layoutValue, setPanelFilePath }}>
          <SharedDriveLink href="/shared/hello.md" projectName="my-project">
            /shared/hello.md
          </SharedDriveLink>
          <LocationDisplay />
        </ProjectLayoutProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("/shared/hello.md"));
    expect(setPanelFilePath).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/my-project/shared?file=%2Fhello.md",
    );
  });
});
