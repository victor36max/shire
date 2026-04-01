import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import SettingsPage from "../components/SettingsPage";
import { renderWithProviders } from "./test-utils";
import type { InterAgentMessage } from "../components/types";
import * as actualHooks from "../hooks";

let mockMessages: InterAgentMessage[] = [];
let mockHasMore = false;

mock.module("../hooks", () => ({
  ...actualHooks,
  useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
  useActivity: () => ({
    data: {
      pages: [{ messages: mockMessages, hasMore: mockHasMore }],
      pageParams: [undefined],
    },
    fetchNextPage: mock(() => {}),
    hasNextPage: mockHasMore,
    isFetchingNextPage: false,
  }),
}));

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const activityMessages: InterAgentMessage[] = [
  { id: 1, fromAgent: "Alice", toAgent: "Bob", text: "Hello!", ts: "2026-03-17T10:00:00Z" },
];

beforeEach(() => {
  mockMessages = [];
  mockHasMore = false;

  localStorage.clear();
  document.documentElement.classList.remove("dark");

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: mock((query: string) => ({
      matches: false,
      media: query,
      addEventListener: mock(() => {}),
      removeEventListener: mock(() => {}),
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

  it("shows Activity Log tab by default with messages", () => {
    mockMessages = activityMessages;
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows empty state on Activity Log tab when no messages", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/No inter-agent messages yet/)).toBeInTheDocument();
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
