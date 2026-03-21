import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import SchedulesPage from "../react-components/SchedulesPage";
import type { ScheduledTask } from "../react-components/types";

const defaultProps = {
  project: { id: "p1", name: "test-project" },
  agents: [
    { id: "a1", name: "Alice" },
    { id: "a2", name: "Bob" },
  ],
  tasks: [] as ScheduledTask[],
  pushEvent: vi.fn(),
};

const sampleTasks: ScheduledTask[] = [
  {
    id: "t1",
    label: "Daily standup",
    agent_id: "a1",
    agent_name: "Alice",
    message: "Give me a standup summary",
    schedule_type: "recurring",
    cron_expression: "0 9 * * *",
    scheduled_at: null,
    enabled: true,
    last_run_at: null,
  },
  {
    id: "t2",
    label: "Weekly report",
    agent_id: "a2",
    agent_name: "Bob",
    message: "Generate weekly report",
    schedule_type: "recurring",
    cron_expression: "0 17 * * FRI",
    scheduled_at: null,
    enabled: false,
    last_run_at: "2026-03-20T17:00:00Z",
  },
];

describe("SchedulesPage", () => {
  it("renders empty state when no tasks", () => {
    render(<SchedulesPage {...defaultProps} />);
    expect(screen.getByText("No scheduled tasks yet.")).toBeInTheDocument();
    expect(screen.getByText("Create a schedule to automatically send messages to agents.")).toBeInTheDocument();
  });

  it("renders heading", () => {
    render(<SchedulesPage {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Scheduled Tasks" })).toBeInTheDocument();
  });

  it("renders task list when tasks exist", () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);
    expect(screen.getByText("Daily standup")).toBeInTheDocument();
    expect(screen.getByText("Weekly report")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows schedule description for recurring tasks", () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);
    // Cron "0 9 * * *" is 9:00 UTC, displayed in local timezone
    expect(screen.getByText(/^Daily at \d+:\d+ [AP]M$/) as HTMLElement).toBeInTheDocument();
  });

  it("shows enabled/disabled toggle state", () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows last run info", () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("opens create dialog on New Schedule click", async () => {
    render(<SchedulesPage {...defaultProps} />);
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("heading", { name: "New Schedule" })).toBeInTheDocument();
  });

  it("can fill in form fields", async () => {
    const user = userEvent.setup();
    render(<SchedulesPage {...defaultProps} />);
    await user.click(screen.getByText("New Schedule"));

    const labelInput = screen.getByLabelText("Label");
    await user.type(labelInput, "My new schedule");
    expect(labelInput).toHaveValue("My new schedule");

    const messageInput = screen.getByLabelText("Message");
    await user.type(messageInput, "Do the thing");
    expect(messageInput).toHaveValue("Do the thing");
  });

  it("has Create Schedule button disabled when form is incomplete", async () => {
    render(<SchedulesPage {...defaultProps} />);
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("button", { name: "Create Schedule" })).toBeDisabled();
  });

  it("calls pushEvent with update-schedule when editing and submitting", async () => {
    const user = userEvent.setup();
    const pushEvent = vi.fn();
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} pushEvent={pushEvent} />);

    // Edit pre-fills the form including agent_id (avoids Radix Select jsdom limitation)
    const editButtons = screen.getAllByTitle("Edit");
    await user.click(editButtons[0]);

    // Modify the label
    const labelInput = screen.getByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Updated standup");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(pushEvent).toHaveBeenCalledWith("update-schedule", {
      id: "t1",
      label: "Updated standup",
      agent_id: "a1",
      message: "Give me a standup summary",
      schedule_type: "recurring",
      cron_expression: "0 9 * * *",
    });
  });

  it("opens delete confirmation dialog", async () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);
    const deleteButtons = screen.getAllByTitle("Delete");
    await userEvent.click(deleteButtons[0]);

    expect(screen.getByText("Delete Schedule")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to delete this schedule? This action cannot be undone."),
    ).toBeInTheDocument();
  });

  it("calls pushEvent with delete-schedule on delete confirm", async () => {
    const pushEvent = vi.fn();
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} pushEvent={pushEvent} />);

    const deleteButtons = screen.getAllByTitle("Delete");
    await userEvent.click(deleteButtons[0]);

    const alertDialog = screen.getByRole("alertdialog");
    const confirmButton = within(alertDialog).getByRole("button", {
      name: "Delete",
    });
    await userEvent.click(confirmButton);

    expect(pushEvent).toHaveBeenCalledWith("delete-schedule", { id: "t1" });
  });

  it("cancels delete confirmation dialog", async () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);

    const deleteButtons = screen.getAllByTitle("Delete");
    await userEvent.click(deleteButtons[0]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const alertDialog = screen.getByRole("alertdialog");
    const cancelButton = within(alertDialog).getByRole("button", {
      name: "Cancel",
    });
    await userEvent.click(cancelButton);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("calls pushEvent with toggle-schedule when toggling", async () => {
    const pushEvent = vi.fn();
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("On"));
    expect(pushEvent).toHaveBeenCalledWith("toggle-schedule", {
      id: "t1",
      enabled: false,
    });
  });

  it("calls pushEvent with run-now when clicking run", async () => {
    const pushEvent = vi.fn();
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} pushEvent={pushEvent} />);

    const runButtons = screen.getAllByTitle("Run now");
    await userEvent.click(runButtons[0]);
    expect(pushEvent).toHaveBeenCalledWith("run-now", { id: "t1" });
  });

  it("opens edit dialog with pre-filled form", async () => {
    render(<SchedulesPage {...defaultProps} tasks={sampleTasks} />);

    const editButtons = screen.getAllByTitle("Edit");
    await userEvent.click(editButtons[0]);

    expect(screen.getByRole("heading", { name: "Edit Schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Daily standup");
    expect(screen.getByLabelText("Message")).toHaveValue("Give me a standup summary");
  });
});
