import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SettingsPage from "../react-components/SettingsPage";

vi.mock("../react-components/Terminal", () => ({
  default: () => <div data-testid="terminal-mock">Terminal Component</div>,
}));

const defaultProps = {
  env_content: "",
  scripts: [] as string[],
  messages: [] as { id: number; from_agent: string; to_agent: string; text: string; ts: string }[],
  has_more_messages: false,
  pushEvent: vi.fn(),
};

const messages = [{ id: 1, from_agent: "Alice", to_agent: "Bob", text: "Hello!", ts: "2026-03-17T10:00:00Z" }];

describe("SettingsPage", () => {
  it("renders with Settings heading", () => {
    render(<SettingsPage {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("has Back button", () => {
    render(<SettingsPage {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows Environment tab by default with env textarea", () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FOO=bar")).toBeInTheDocument();
  });

  it("shows Save Environment button disabled when env is unchanged", () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeDisabled();
  });

  it("enables Save Environment button after editing", async () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    const textarea = screen.getByDisplayValue("FOO=bar");
    await userEvent.type(textarea, "\nBAZ=qux");
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeEnabled();
  });

  it("shows Scripts tab with empty state", async () => {
    render(<SettingsPage {...defaultProps} />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByText(/No global scripts/)).toBeInTheDocument();
  });

  it("shows script list on Scripts tab", async () => {
    render(<SettingsPage {...defaultProps} scripts={["setup.sh", "install-deps.sh"]} />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByText("setup.sh")).toBeInTheDocument();
    expect(screen.getByText("install-deps.sh")).toBeInTheDocument();
  });

  it("shows Activity Log tab with messages", async () => {
    render(<SettingsPage {...defaultProps} messages={messages} />);
    await userEvent.click(screen.getByText("Activity Log"));
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows empty state on Activity Log tab when no messages", async () => {
    render(<SettingsPage {...defaultProps} />);
    await userEvent.click(screen.getByText("Activity Log"));
    expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
  });

  it("shows Terminal tab", async () => {
    render(<SettingsPage {...defaultProps} />);
    const terminalTab = screen.getByText("Terminal");
    expect(terminalTab).toBeInTheDocument();
    await userEvent.click(terminalTab);
    expect(screen.getByTestId("terminal-mock")).toBeInTheDocument();
  });

  it("calls pushEvent with save-env on save", async () => {
    const pushEvent = vi.fn();
    render(<SettingsPage {...defaultProps} env_content="OLD=val" pushEvent={pushEvent} />);
    const textarea = screen.getByDisplayValue("OLD=val");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "NEW=val");
    await userEvent.click(screen.getByRole("button", { name: "Save Environment" }));
    expect(pushEvent).toHaveBeenCalledWith("save-env", { content: "NEW=val" });
  });
});
