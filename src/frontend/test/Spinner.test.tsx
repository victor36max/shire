import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Spinner, PageLoader } from "../components/ui/spinner";

describe("Spinner", () => {
  it("renders with default size", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("animate-spin", "h-5", "w-5");
  });

  it("renders small size", () => {
    const { container } = render(<Spinner size="sm" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("h-4", "w-4");
  });

  it("renders large size", () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("h-6", "w-6");
  });

  it("accepts custom className", () => {
    const { container } = render(<Spinner className="text-muted-foreground" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-muted-foreground");
  });
});

describe("PageLoader", () => {
  it("renders a centered spinner", () => {
    const { container } = render(<PageLoader />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
