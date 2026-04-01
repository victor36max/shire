import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import SchedulesPage from "../components/SchedulesPage";
import type { ScheduledTask } from "../components/types";
import { renderWithProviders } from "./test-utils";

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

const routeOpts = {
  route: "/projects/test-project/schedules",
  routePath: "/projects/:projectName/schedules",
};

function setSchedules(tasks: ScheduledTask[]) {
  server.use(http.get("*/api/projects/:id/schedules", () => HttpResponse.json(tasks)));
}

function setAgents(
  agents: Array<{ id: string; name: string }> = [
    { id: "a1", name: "Alice" },
    { id: "a2", name: "Bob" },
  ],
) {
  server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agents)));
}

describe("SchedulesPage", () => {
  it("renders empty state when no tasks", async () => {
    setAgents();
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("No scheduled tasks yet.")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Create a schedule to automatically send messages to agents."),
    ).toBeInTheDocument();
  });

  it("renders heading", async () => {
    setAgents();
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Scheduled Tasks" })).toBeInTheDocument();
    });
  });

  it("renders task list when tasks exist", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });
    expect(screen.getByText("Weekly report")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows schedule description for recurring tasks", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      // Cron "0 9 * * *" is 9:00 UTC, displayed in local timezone
      expect(screen.getByText(/^Daily at \d+:\d+ [AP]M$/) as HTMLElement).toBeInTheDocument();
    });
  });

  it("shows enabled/disabled toggle state", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("On")).toBeInTheDocument();
    });
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows last run info", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });

  it("opens create dialog on New Schedule click", async () => {
    setAgents();
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("New Schedule")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("heading", { name: "New Schedule" })).toBeInTheDocument();
  });

  it("can fill in form fields", async () => {
    setAgents();
    const user = userEvent.setup();
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("New Schedule")).toBeInTheDocument();
    });
    await user.click(screen.getByText("New Schedule"));

    const labelInput = screen.getByLabelText("Label");
    await user.type(labelInput, "My new schedule");
    expect(labelInput).toHaveValue("My new schedule");

    const messageInput = screen.getByLabelText("Message");
    await user.type(messageInput, "Do the thing");
    expect(messageInput).toHaveValue("Do the thing");
  });

  it("has Create Schedule button disabled when form is incomplete", async () => {
    setAgents();
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("New Schedule")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Schedule"));
    expect(screen.getByRole("button", { name: "Create Schedule" })).toBeDisabled();
  });

  it("sends update request when editing and submitting", async () => {
    let updatedBody: Record<string, unknown> | undefined;
    server.use(
      http.patch("*/api/projects/:id/schedules/:sid", async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        updatedBody = { id: params.sid, ...body };
        return HttpResponse.json({ ok: true });
      }),
    );
    setAgents();
    setSchedules(sampleTasks);
    const user = userEvent.setup();
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    const labelInput = screen.getByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Updated standup");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updatedBody).toBeDefined();
      expect(updatedBody!.id).toBe("t1");
      expect(updatedBody!.label).toBe("Updated standup");
    });
  });

  it("opens delete confirmation dialog", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[0]);

    expect(screen.getByText("Delete Schedule")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Are you sure you want to delete this schedule? This action cannot be undone.",
      ),
    ).toBeInTheDocument();
  });

  it("sends delete request on delete confirm", async () => {
    let deletedSid: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/schedules/:sid", ({ params }) => {
        deletedSid = params.sid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[0]);

    const alertDialog = screen.getByRole("alertdialog");
    const confirmButton = within(alertDialog).getByRole("button", {
      name: "Delete",
    });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(deletedSid).toBe("t1"));
  });

  it("cancels delete confirmation dialog", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });

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

  it("sends toggle request when toggling", async () => {
    let toggleBody: Record<string, unknown> | undefined;
    let toggleSid: string | undefined;
    server.use(
      http.post("*/api/projects/:id/schedules/:sid/toggle", async ({ request, params }) => {
        toggleSid = params.sid as string;
        toggleBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("On")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("On"));
    await waitFor(() => {
      expect(toggleSid).toBe("t1");
      expect(toggleBody).toEqual({ enabled: false });
    });
  });

  it("sends run request when clicking run", async () => {
    let runSid: string | undefined;
    server.use(
      http.post("*/api/projects/:id/schedules/:sid/run", ({ params }) => {
        runSid = params.sid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });

    const runButtons = screen.getAllByRole("button", { name: "Run now" });
    await userEvent.click(runButtons[0]);
    await waitFor(() => expect(runSid).toBe("t1"));
  });

  it("opens edit dialog with pre-filled form", async () => {
    setAgents();
    setSchedules(sampleTasks);
    renderWithProviders(<SchedulesPage />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Daily standup")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await userEvent.click(editButtons[0]);

    expect(screen.getByRole("heading", { name: "Edit Schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Daily standup");
    expect(screen.getByLabelText("Message")).toHaveValue("Give me a standup summary");
  });

  it("shows error state with retry when schedules query fails", async () => {
    setAgents();
    server.use(
      http.get("*/api/projects/:id/schedules", () =>
        HttpResponse.json({ error: "Failed to fetch" }, { status: 500 }),
      ),
    );
    renderWithProviders(<SchedulesPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });
});
