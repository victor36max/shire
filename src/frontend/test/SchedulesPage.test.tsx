import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import SchedulesPage from "../components/SchedulesPage";
import type { ScheduledTask } from "../components/types";
import { renderWithProviders } from "./test-utils";
import * as actualHooks from "../lib/hooks";

const createMutate = mock(() => {});
const updateMutate = mock(() => {});
const deleteMutate = mock(() => {});
const toggleMutate = mock(() => {});
const runNowMutate = mock(() => {});

let mockTasks: ScheduledTask[] = [];
let mockSchedulesError: {
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof mock>;
} = { isError: false, error: null, refetch: mock(() => {}) };
let mockAgents: { id: string; name: string }[] = [
  { id: "a1", name: "Alice" },
  { id: "a2", name: "Bob" },
];

mock.module("../lib/hooks", () => ({
  ...actualHooks,
  useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
  useAgents: () => ({ data: mockAgents, isLoading: false }),
  useSchedules: () => ({ data: mockTasks, isLoading: false, ...mockSchedulesError }),
  useCreateSchedule: () => ({ mutate: createMutate, isPending: false }),
  useUpdateSchedule: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteSchedule: () => ({ mutate: deleteMutate, isPending: false }),
  useToggleSchedule: () => ({ mutate: toggleMutate, isPending: false }),
  useRunScheduleNow: () => ({ mutate: runNowMutate, isPending: false }),
}));

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const sampleTasks: ScheduledTask[] = [
  {
    id: "t1",
    label: "Daily standup",
    agentId: "a1",
    agentName: "Alice",
    message: "Give me a standup summary",
    scheduleType: "recurring",
    cronExpression: "0 9 * * *",
    scheduledAt: null,
    enabled: true,
    lastRunAt: null,
  },
  {
    id: "t2",
    label: "Weekly report",
    agentId: "a2",
    agentName: "Bob",
    message: "Generate weekly report",
    scheduleType: "recurring",
    cronExpression: "0 17 * * FRI",
    scheduledAt: null,
    enabled: false,
    lastRunAt: "2026-03-20T17:00:00Z",
  },
];

beforeEach(() => {
  mockTasks = [];
  mockAgents = [
    { id: "a1", name: "Alice" },
    { id: "a2", name: "Bob" },
  ];
  mockSchedulesError = { isError: false, error: null, refetch: mock(() => {}) };
  createMutate.mockClear();
  updateMutate.mockClear();
  deleteMutate.mockClear();
  toggleMutate.mockClear();
  runNowMutate.mockClear();
});

describe("SchedulesPage", () => {
  it("renders empty state when no tasks", () => {
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByText("No scheduled tasks yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Create a schedule to automatically send messages to agents."),
    ).toBeInTheDocument();
  });

  it("renders heading", () => {
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByRole("heading", { name: "Scheduled Tasks" })).toBeInTheDocument();
  });

  it("renders task list when tasks exist", () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByText("Daily standup")).toBeInTheDocument();
    expect(screen.getByText("Weekly report")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows schedule description for recurring tasks", () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);
    // Cron "0 9 * * *" is 9:00 UTC, displayed in local timezone
    expect(screen.getByText(/^Daily at \d+:\d+ [AP]M$/) as HTMLElement).toBeInTheDocument();
  });

  it("shows enabled/disabled toggle state", () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows last run info", () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("opens create dialog on New Schedule click", async () => {
    renderWithProviders(<SchedulesPage />);
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("heading", { name: "New Schedule" })).toBeInTheDocument();
  });

  it("can fill in form fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SchedulesPage />);
    await user.click(screen.getByText("New Schedule"));

    const labelInput = screen.getByLabelText("Label");
    await user.type(labelInput, "My new schedule");
    expect(labelInput).toHaveValue("My new schedule");

    const messageInput = screen.getByLabelText("Message");
    await user.type(messageInput, "Do the thing");
    expect(messageInput).toHaveValue("Do the thing");
  });

  it("has Create Schedule button disabled when form is incomplete", async () => {
    renderWithProviders(<SchedulesPage />);
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("button", { name: "Create Schedule" })).toBeDisabled();
  });

  it("calls updateSchedule.mutate when editing and submitting", async () => {
    const user = userEvent.setup();
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    const labelInput = screen.getByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Updated standup");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        label: "Updated standup",
        agentId: "a1",
        message: "Give me a standup summary",
        scheduleType: "recurring",
      }),
    );
  });

  it("opens delete confirmation dialog", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[0]);

    expect(screen.getByText("Delete Schedule")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Are you sure you want to delete this schedule? This action cannot be undone.",
      ),
    ).toBeInTheDocument();
  });

  it("calls deleteSchedule.mutate on delete confirm", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[0]);

    const alertDialog = screen.getByRole("alertdialog");
    const confirmButton = within(alertDialog).getByRole("button", {
      name: "Delete",
    });
    await userEvent.click(confirmButton);

    expect(deleteMutate).toHaveBeenCalledWith("t1");
  });

  it("cancels delete confirmation dialog", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[0]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const alertDialog = screen.getByRole("alertdialog");
    const cancelButton = within(alertDialog).getByRole("button", {
      name: "Cancel",
    });
    await userEvent.click(cancelButton);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("calls toggleSchedule.mutate when toggling", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    await userEvent.click(screen.getByText("On"));
    expect(toggleMutate).toHaveBeenCalledWith({ id: "t1", enabled: false });
  });

  it("calls runNow.mutate when clicking run", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    const runButtons = screen.getAllByRole("button", { name: "Run now" });
    await userEvent.click(runButtons[0]);
    expect(runNowMutate).toHaveBeenCalledWith("t1");
  });

  it("opens edit dialog with pre-filled form", async () => {
    mockTasks = sampleTasks;
    renderWithProviders(<SchedulesPage />);

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await userEvent.click(editButtons[0]);

    expect(screen.getByRole("heading", { name: "Edit Schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Daily standup");
    expect(screen.getByLabelText("Message")).toHaveValue("Give me a standup summary");
  });

  it("shows error state with retry when schedules query fails", () => {
    mockSchedulesError = {
      isError: true,
      error: new Error("Failed to fetch"),
      refetch: mock(() => {}),
    };
    renderWithProviders(<SchedulesPage />);
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
