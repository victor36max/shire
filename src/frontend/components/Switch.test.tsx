import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "bun:test";
import { Switch } from "../components/ui/switch";

describe("Switch", () => {
  it("renders a switch element", () => {
    render(<Switch aria-label="Toggle" />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("renders unchecked by default", () => {
    render(<Switch aria-label="Toggle" />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked");
  });

  it("renders checked when defaultChecked", () => {
    render(<Switch aria-label="Toggle" defaultChecked />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "checked");
  });
});
