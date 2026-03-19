import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SettingsPage from "../react-components/SettingsPage";

vi.mock("../react-components/Terminal", () => ({
  default: () => <div data-testid="terminal-mock">Terminal Component</div>,
}));

const defaultProps = {
  project: "test-project",
  env_content: "",
  scripts: [] as { name: string; content: string }[],
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

  it("shows Environment tab by default with key-value inputs", () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FOO")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bar")).toBeInTheDocument();
  });

  it("shows Save Environment button disabled when env is unchanged", () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeDisabled();
  });

  it("enables Save Environment button after editing a value", async () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    const valueInput = screen.getByDisplayValue("bar");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "baz");
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeEnabled();
  });

  it("can add a new variable row", async () => {
    render(<SettingsPage {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Add Variable/ }));
    expect(screen.getByLabelText("Variable 1 key")).toBeInTheDocument();
    expect(screen.getByLabelText("Variable 1 value")).toBeInTheDocument();
  });

  it("can remove a variable row", async () => {
    render(<SettingsPage {...defaultProps} env_content="FOO=bar" />);
    expect(screen.getByDisplayValue("FOO")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove variable 1" }));
    expect(screen.queryByDisplayValue("FOO")).not.toBeInTheDocument();
  });

  it("shows Scripts tab with empty state", async () => {
    render(<SettingsPage {...defaultProps} />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByText(/No global scripts/)).toBeInTheDocument();
  });

  it("shows script list with name inputs and textareas on Scripts tab", async () => {
    const scripts = [
      { name: "setup.sh", content: "#!/bin/bash\necho setup" },
      { name: "install-deps.sh", content: "#!/bin/bash\nbun install" },
    ];
    render(<SettingsPage {...defaultProps} scripts={scripts} />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByDisplayValue("setup.sh")).toBeInTheDocument();
    expect(screen.getByDisplayValue("install-deps.sh")).toBeInTheDocument();
    expect(screen.getByLabelText("Script 1 content")).toHaveValue("#!/bin/bash\necho setup");
    expect(screen.getByLabelText("Script 2 content")).toHaveValue("#!/bin/bash\nbun install");
  });

  it("enables Save button after editing script content", async () => {
    const scripts = [{ name: "setup.sh", content: "#!/bin/bash" }];
    render(<SettingsPage {...defaultProps} scripts={scripts} />);
    await userEvent.click(screen.getByText("Scripts"));
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const scriptSave = saveButtons.find((btn) => btn.closest("[class*='border rounded-lg']"));
    expect(scriptSave).toBeDisabled();
    const textarea = screen.getByLabelText("Script 1 content");
    await userEvent.type(textarea, "\necho hello");
    expect(scriptSave).toBeEnabled();
  });

  it("calls pushEvent with save-script on script save", async () => {
    const pushEvent = vi.fn();
    const scripts = [{ name: "setup.sh", content: "#!/bin/bash" }];
    render(<SettingsPage {...defaultProps} scripts={scripts} pushEvent={pushEvent} />);
    await userEvent.click(screen.getByText("Scripts"));
    const textarea = screen.getByLabelText("Script 1 content");
    await userEvent.type(textarea, "\necho hi");
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const scriptSave = saveButtons.find((btn) => btn.closest("[class*='border rounded-lg']"));
    await userEvent.click(scriptSave!);
    expect(pushEvent).toHaveBeenCalledWith("save-script", {
      name: "setup.sh",
      content: "#!/bin/bash\necho hi",
    });
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
    const valueInput = screen.getByDisplayValue("val");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "new");
    await userEvent.click(screen.getByRole("button", { name: "Save Environment" }));
    expect(pushEvent).toHaveBeenCalledWith("save-env", { content: "OLD=new" });
  });
});
