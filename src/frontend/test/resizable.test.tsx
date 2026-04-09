import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../components/ui/resizable";

describe("Resizable components", () => {
  it("renders a horizontal panel group with panels", () => {
    render(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={50}>
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>
          <div>Right</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
  });

  it("renders handle with grip icon when withHandle is true", () => {
    const { container } = render(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={50}>
          <div>A</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}>
          <div>B</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(container.querySelector(".lucide-grip-vertical")).toBeInTheDocument();
  });

  it("applies custom className to panel group", () => {
    const { container } = render(
      <ResizablePanelGroup orientation="horizontal" className="custom-class">
        <ResizablePanel defaultSize={100}>
          <div>Content</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(container.firstElementChild?.className).toContain("custom-class");
  });
});
