import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SettingsPage from "../react-components/SettingsPage";

const secrets = [{ id: 1, key: "ANTHROPIC_API_KEY" }];
const messages = [{ id: 1, from_agent: "Alice", to_agent: "Bob", text: "Hello!", ts: "2026-03-17T10:00:00Z" }];

describe("SettingsPage", () => {
  it("renders with Settings heading", () => {
    render(<SettingsPage secrets={[]} messages={[]} has_more_messages={false} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders Global Secrets and Activity Log tabs", () => {
    render(<SettingsPage secrets={[]} messages={[]} has_more_messages={false} pushEvent={vi.fn()} />);
    expect(screen.getByText("Global Secrets")).toBeInTheDocument();
    expect(screen.getByText("Activity Log")).toBeInTheDocument();
  });

  it("shows secrets table by default", () => {
    render(<SettingsPage secrets={secrets} messages={[]} has_more_messages={false} pushEvent={vi.fn()} />);
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
  });

  it("switches to Activity Log tab", async () => {
    render(<SettingsPage secrets={secrets} messages={messages} has_more_messages={false} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("Activity Log"));
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("has Back button with chevron icon", () => {
    render(<SettingsPage secrets={[]} messages={[]} has_more_messages={false} pushEvent={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
