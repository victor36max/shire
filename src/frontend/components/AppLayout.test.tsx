import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import AppLayout from "../components/AppLayout";

describe("AppLayout", () => {
  it("renders children", () => {
    render(<AppLayout>Hello World</AppLayout>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("applies safe area insets", () => {
    const { container } = render(<AppLayout>content</AppLayout>);
    const main = container.querySelector("main") as HTMLElement;
    expect(main.className).toContain("safe-area-inset-top");
    expect(main.className).toContain("safe-area-inset-bottom");
  });

  it("uses max-w-5xl by default", () => {
    const { container } = render(<AppLayout>content</AppLayout>);
    const inner = container.querySelector("main > div") as HTMLElement;
    expect(inner.className).toContain("max-w-5xl");
    expect(inner.className).not.toContain("max-w-7xl");
  });

  it("uses max-w-7xl when maxWidth is wide", () => {
    const { container } = render(<AppLayout maxWidth="wide">content</AppLayout>);
    const inner = container.querySelector("main > div") as HTMLElement;
    expect(inner.className).toContain("max-w-7xl");
    expect(inner.className).not.toContain("max-w-5xl");
  });
});
