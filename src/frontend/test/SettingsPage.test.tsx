import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SettingsPage from "../components/SettingsPage";
import { renderWithProviders } from "./test-utils";

const saveEnvMutate = vi.fn();
const saveScriptMutate = vi.fn();
const deleteScriptMutate = vi.fn();
const runScriptMutate = vi.fn();

let mockEnvContent = "";
let mockScripts: { name: string; content: string }[] = [];
let mockMessages: never[] = [];
let mockHasMore = false;

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useEnv: () => ({ data: { content: mockEnvContent }, isLoading: false }),
    useScripts: () => ({ data: mockScripts, isLoading: false }),
    useActivity: () => ({
      data: { messages: mockMessages, hasMore: mockHasMore },
      isLoading: false,
    }),
    useSaveEnv: () => ({ mutate: saveEnvMutate, isPending: false }),
    useSaveScript: () => ({ mutate: saveScriptMutate, isPending: false }),
    useDeleteScript: () => ({ mutate: deleteScriptMutate, isPending: false }),
    useRunScript: () => ({ mutate: runScriptMutate, isPending: false }),
  };
});

vi.mock("../lib/ws", () => ({
  useSubscription: vi.fn(),
}));

const activityMessages = [
  { id: 1, fromAgent: "Alice", toAgent: "Bob", text: "Hello!", ts: "2026-03-17T10:00:00Z" },
] as never[];

beforeEach(() => {
  mockEnvContent = "";
  mockScripts = [];
  mockMessages = [];
  mockHasMore = false;
  saveEnvMutate.mockClear();
  saveScriptMutate.mockClear();
  deleteScriptMutate.mockClear();
  runScriptMutate.mockClear();

  localStorage.clear();
  document.documentElement.classList.remove("dark");

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("SettingsPage", () => {
  it("renders with Settings heading", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("has Back button", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows Environment tab by default with key-value inputs", () => {
    mockEnvContent = "FOO=bar";
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FOO")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bar")).toBeInTheDocument();
  });

  it("shows Save Environment button disabled when env is unchanged", () => {
    mockEnvContent = "FOO=bar";
    renderWithProviders(<SettingsPage />);
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeDisabled();
  });

  it("enables Save Environment button after editing a value", async () => {
    mockEnvContent = "FOO=bar";
    renderWithProviders(<SettingsPage />);
    const valueInput = screen.getByDisplayValue("bar");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "baz");
    const saveBtn = screen.getByRole("button", { name: "Save Environment" });
    expect(saveBtn).toBeEnabled();
  });

  it("can add a new variable row", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Add Variable/ }));
    expect(screen.getByLabelText("Variable 1 key")).toBeInTheDocument();
    expect(screen.getByLabelText("Variable 1 value")).toBeInTheDocument();
  });

  it("can remove a variable row", async () => {
    mockEnvContent = "FOO=bar";
    renderWithProviders(<SettingsPage />);
    expect(screen.getByDisplayValue("FOO")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove variable 1" }));
    expect(screen.queryByDisplayValue("FOO")).not.toBeInTheDocument();
  });

  it("shows Scripts tab with empty state", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByText(/No global scripts/)).toBeInTheDocument();
  });

  it("shows script list with name inputs and textareas on Scripts tab", async () => {
    mockScripts = [
      { name: "setup.sh", content: "#!/bin/bash\necho setup" },
      { name: "install-deps.sh", content: "#!/bin/bash\nbun install" },
    ];
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Scripts"));
    expect(screen.getByDisplayValue("setup.sh")).toBeInTheDocument();
    expect(screen.getByDisplayValue("install-deps.sh")).toBeInTheDocument();
    expect(screen.getByLabelText("Script 1 content")).toHaveValue("#!/bin/bash\necho setup");
    expect(screen.getByLabelText("Script 2 content")).toHaveValue("#!/bin/bash\nbun install");
  });

  it("enables Save button after editing script content", async () => {
    mockScripts = [{ name: "setup.sh", content: "#!/bin/bash" }];
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Scripts"));
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const scriptSave = saveButtons.find((btn) => btn.closest("[class*='border rounded-lg']"));
    expect(scriptSave).toBeDisabled();
    const textarea = screen.getByLabelText("Script 1 content");
    await userEvent.type(textarea, "\necho hello");
    expect(scriptSave).toBeEnabled();
  });

  it("calls saveScript.mutate on script save", async () => {
    mockScripts = [{ name: "setup.sh", content: "#!/bin/bash" }];
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Scripts"));
    const textarea = screen.getByLabelText("Script 1 content");
    await userEvent.type(textarea, "\necho hi");
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const scriptSave = saveButtons.find((btn) => btn.closest("[class*='border rounded-lg']"));
    await userEvent.click(scriptSave!);
    expect(saveScriptMutate).toHaveBeenCalledWith({
      name: "setup.sh",
      content: "#!/bin/bash\necho hi",
    });
  });

  it("shows Activity Log tab with messages", async () => {
    mockMessages = activityMessages;
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Activity Log"));
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows empty state on Activity Log tab when no messages", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Activity Log"));
    expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
  });

  it("calls saveEnv.mutate on save", async () => {
    mockEnvContent = "OLD=val";
    renderWithProviders(<SettingsPage />);
    const valueInput = screen.getByDisplayValue("val");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "new");
    await userEvent.click(screen.getByRole("button", { name: "Save Environment" }));
    expect(saveEnvMutate).toHaveBeenCalledWith("OLD=new");
  });

  it("shows Appearance tab with theme options", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Appearance"));
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("defaults to System theme active in Appearance tab", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Appearance"));
    const systemButton = screen.getByRole("button", { name: /System/ });
    expect(systemButton.getAttribute("data-active")).toBe("true");
  });

  it("highlights current theme in Appearance tab", async () => {
    localStorage.setItem("theme", "dark");
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Appearance"));
    const darkButton = screen.getByRole("button", { name: /Dark/ });
    expect(darkButton.getAttribute("data-active")).toBe("true");
  });

  it("switches theme when clicking a theme option", async () => {
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Appearance"));
    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes .dark class when switching to Light", async () => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    renderWithProviders(<SettingsPage />);
    await userEvent.click(screen.getByText("Appearance"));
    await userEvent.click(screen.getByRole("button", { name: /Light/ }));
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
