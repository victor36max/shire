import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppLayout from "./AppLayout";
import { Button, buttonVariants } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ChevronLeft, Plus, Play, Pencil, Trash2 } from "lucide-react";
import { Spinner, PageLoader } from "./ui/spinner";
import { ErrorState } from "./ui/error-state";
import { navigate } from "../lib/navigate";
import { type ScheduledTask } from "./types";
import {
  useProjectId,
  useAgents,
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useToggleSchedule,
  useRunScheduleNow,
} from "../lib/hooks";
import { useSubscription } from "../lib/ws";

type Frequency = "every_n_minutes" | "hourly" | "daily" | "weekly" | "monthly";

interface ScheduleFormState {
  label: string;
  agentId: string;
  message: string;
  scheduleType: "once" | "recurring";
  frequency: Frequency;
  minute: string;
  hour: string;
  daysOfWeek: number[];
  dayOfMonth: string;
  intervalMinutes: string;
  date: string;
  time: string;
}

const DEFAULT_FORM: ScheduleFormState = {
  label: "",
  agentId: "",
  message: "",
  scheduleType: "recurring",
  frequency: "daily",
  minute: "0",
  hour: "9",
  daysOfWeek: [],
  dayOfMonth: "1",
  intervalMinutes: "30",
  date: "",
  time: "09:00",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Get the local timezone offset in hours (e.g., UTC-5 returns -5)
const TZ_OFFSET_HOURS = new Date().getTimezoneOffset() / -60;

/** Convert local hour to UTC hour */
function localHourToUtc(hour: number): number {
  return (((hour - TZ_OFFSET_HOURS) % 24) + 24) % 24;
}

/** Convert UTC hour to local hour */
function utcHourToLocal(hour: number): number {
  return (((hour + TZ_OFFSET_HOURS) % 24) + 24) % 24;
}

/** Convert a local date + time string to a UTC ISO string */
function localToUtcIso(date: string, time: string): string {
  // Construct a Date using local values, then get its UTC ISO string
  const local = new Date(`${date}T${time}:00`);
  return local.toISOString();
}

/** Convert a UTC ISO string to local date and time strings */
function utcIsoToLocal(isoString: string): { date: string; time: string } {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

// Props interface removed — component now owns its data fetching

function buildCronExpression(form: ScheduleFormState): string {
  // Convert local hour/minute to UTC for the cron expression stored on the server
  const localMin = parseInt(form.minute || "0");
  const localHr = parseInt(form.hour || "9");
  const utcHr = localHourToUtc(localHr);
  const min = String(localMin);
  const hr = String(utcHr);

  switch (form.frequency) {
    case "every_n_minutes":
      return `*/${form.intervalMinutes || "30"} * * * *`;
    case "hourly":
      return `${min} * * * *`;
    case "daily":
      return `${min} ${hr} * * *`;
    case "weekly": {
      if (form.daysOfWeek.length === 0) return `${min} ${hr} * * *`;
      const dayNames = form.daysOfWeek
        .sort((a, b) => a - b)
        .map((d) => DAY_LABELS[d - 1]?.toUpperCase().slice(0, 3))
        .join(",");
      return `${min} ${hr} * * ${dayNames}`;
    }
    case "monthly":
      return `${min} ${hr} ${form.dayOfMonth || "1"} * *`;
    default:
      return `${min} ${hr} * * *`;
  }
}

function describeCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hr, dom, , dow] = parts;

  if (min?.startsWith("*/")) {
    return `Every ${min.slice(2)} minutes`;
  }
  if (hr === "*" && dom === "*") {
    return `Hourly at :${min?.padStart(2, "0")}`;
  }

  // Convert UTC cron hour to local for display
  const utcHour = parseInt(hr || "0");
  const localHour = utcHourToLocal(utcHour);
  const timeStr = formatTime(localHour, parseInt(min || "0"));

  if (dow && dow !== "*") {
    const dayStr = dow
      .split(",")
      .map((d) => d.slice(0, 3))
      .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
      .join(", ");
    return `${dayStr} at ${timeStr}`;
  }
  if (dom && dom !== "*") {
    return `Monthly on day ${dom} at ${timeStr}`;
  }
  return `Daily at ${timeStr}`;
}

function formatTime(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:${minute.toString().padStart(2, "0")} ${ampm}`;
}

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parseCronToForm(cron: string): Partial<ScheduleFormState> {
  const parts = cron.split(" ");
  if (parts.length !== 5) return {};
  const [min, hr, dom, , dow] = parts;

  if (min?.startsWith("*/")) {
    return {
      frequency: "every_n_minutes",
      intervalMinutes: min.slice(2),
    };
  }
  if (hr === "*") {
    return { frequency: "hourly", minute: min || "0" };
  }

  // Convert UTC hour from cron to local for the form
  const localHour = String(utcHourToLocal(parseInt(hr || "9")));

  if (dow && dow !== "*") {
    const days = dow.split(",").map((d) => {
      const idx = DAY_LABELS.findIndex(
        (l) => l.toUpperCase().slice(0, 3) === d.toUpperCase().slice(0, 3),
      );
      return idx + 1;
    });
    return {
      frequency: "weekly",
      hour: localHour,
      minute: min || "0",
      daysOfWeek: days,
    };
  }
  if (dom && dom !== "*") {
    return {
      frequency: "monthly",
      hour: localHour,
      minute: min || "0",
      dayOfMonth: dom,
    };
  }
  return { frequency: "daily", hour: localHour, minute: min || "0" };
}

export default function SchedulesPage() {
  const queryClient = useQueryClient();
  const { projectId, projectName } = useProjectId();

  const {
    data: tasks = [],
    isLoading: schedulesLoading,
    isError: schedulesError,
    error: schedulesErrorObj,
    refetch: refetchSchedules,
  } = useSchedules(projectId);
  const { data: agentList = [] } = useAgents(projectId);
  const createScheduleMut = useCreateSchedule(projectId ?? "");
  const updateScheduleMut = useUpdateSchedule(projectId ?? "");
  const deleteScheduleMut = useDeleteSchedule(projectId ?? "");
  const toggleScheduleMut = useToggleSchedule(projectId ?? "");
  const runNowMut = useRunScheduleNow(projectId ?? "");

  useSubscription(projectId ? `project:${projectId}:schedules` : null, () => {
    queryClient.invalidateQueries({ queryKey: ["schedules", projectId] });
  });

  const agents = agentList;
  const typedTasks = tasks;
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<ScheduleFormState>(DEFAULT_FORM);

  const openCreate = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setFormOpen(true);
  };

  const openEdit = (task: ScheduledTask) => {
    setEditingId(task.id);
    const cronParts = task.cronExpression ? parseCronToForm(task.cronExpression) : {};
    setForm({
      ...DEFAULT_FORM,
      label: task.label,
      agentId: task.agentId,
      message: task.message,
      scheduleType: task.scheduleType,
      ...cronParts,
      date: task.scheduledAt ? utcIsoToLocal(task.scheduledAt).date : "",
      time: task.scheduledAt ? utcIsoToLocal(task.scheduledAt).time : "09:00",
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    const base = {
      label: form.label,
      agentId: form.agentId,
      message: form.message,
      scheduleType: form.scheduleType,
    };

    const payload =
      form.scheduleType === "recurring"
        ? { ...base, cronExpression: buildCronExpression(form) }
        : { ...base, scheduledAt: localToUtcIso(form.date, form.time) };

    if (editingId) {
      updateScheduleMut.mutate({ id: editingId, ...payload });
    } else {
      createScheduleMut.mutate(payload);
    }

    setFormOpen(false);
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteScheduleMut.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleToggle = (task: ScheduledTask) => {
    toggleScheduleMut.mutate({ id: task.id, enabled: !task.enabled });
  };

  const handleRunNow = (task: ScheduledTask) => {
    runNowMut.mutate(task.id);
  };

  if (!projectId) {
    return <PageLoader />;
  }

  const updateForm = (field: keyof ScheduleFormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day],
    }));
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => navigate(`/projects/${projectName}`)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex-1">Scheduled Tasks</h1>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            New Schedule
          </Button>
        </div>

        {schedulesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        ) : schedulesError ? (
          <ErrorState
            message={schedulesErrorObj?.message || "Failed to load schedules"}
            onRetry={() => refetchSchedules()}
          />
        ) : typedTasks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No scheduled tasks yet.</p>
            <p className="text-sm mt-1">
              Create a schedule to automatically send messages to agents.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border tabular-nums">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {typedTasks.map((task) => (
                  <TableRow key={task.id} className={!task.enabled ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{task.label}</TableCell>
                    <TableCell>{task.agentName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.scheduleType === "recurring" && task.cronExpression
                        ? describeCron(task.cronExpression)
                        : task.scheduledAt
                          ? new Date(task.scheduledAt).toLocaleString()
                          : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.lastRunAt ? timeAgo(task.lastRunAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant={task.enabled ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleToggle(task)}
                      >
                        {task.enabled ? "On" : "Off"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRunNow(task)}
                          aria-label="Run now"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(task)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(task.id)}
                          aria-label="Delete"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Schedule" : "New Schedule"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Modify the schedule settings below."
                : "Configure a scheduled message to be sent to an agent automatically."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                value={form.label}
                onChange={(e) => updateForm("label", e.target.value)}
                placeholder="Daily standup reminder"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent">Agent</Label>
              <Select value={form.agentId} onValueChange={(v) => updateForm("agentId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => updateForm("message", e.target.value)}
                placeholder="Give me a standup summary"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={form.scheduleType === "recurring" ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateForm("scheduleType", "recurring")}
                >
                  Recurring
                </Button>
                <Button
                  type="button"
                  variant={form.scheduleType === "once" ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateForm("scheduleType", "once")}
                >
                  Once
                </Button>
              </div>
            </div>

            {form.scheduleType === "recurring" && (
              <div className="space-y-4 rounded-md border p-4">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select
                    value={form.frequency}
                    onValueChange={(v) => updateForm("frequency", v as Frequency)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="every_n_minutes">Every N minutes</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.frequency === "every_n_minutes" && (
                  <div className="space-y-2">
                    <Label>Every</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        max="59"
                        value={form.intervalMinutes}
                        onChange={(e) => updateForm("intervalMinutes", e.target.value)}
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">minutes</span>
                    </div>
                  </div>
                )}

                {form.frequency === "hourly" && (
                  <div className="space-y-2">
                    <Label>At minute</Label>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      value={form.minute}
                      onChange={(e) => updateForm("minute", e.target.value)}
                      className="w-20"
                    />
                  </div>
                )}

                {(form.frequency === "daily" ||
                  form.frequency === "weekly" ||
                  form.frequency === "monthly") && (
                  <div className="space-y-2">
                    <Label>At time</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="23"
                        value={form.hour}
                        onChange={(e) => updateForm("hour", e.target.value)}
                        className="w-16"
                        placeholder="Hour"
                      />
                      <span>:</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={form.minute}
                        onChange={(e) => updateForm("minute", e.target.value)}
                        className="w-16"
                        placeholder="Min"
                      />
                    </div>
                  </div>
                )}

                {form.frequency === "weekly" && (
                  <div className="space-y-2">
                    <Label>On days</Label>
                    <div className="flex gap-1">
                      {DAY_LABELS.map((label, i) => (
                        <Button
                          key={label}
                          type="button"
                          variant={form.daysOfWeek.includes(i + 1) ? "default" : "outline"}
                          size="sm"
                          className="h-10 w-11 text-xs"
                          onClick={() => toggleDay(i + 1)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {form.frequency === "monthly" && (
                  <div className="space-y-2">
                    <Label>Day of month</Label>
                    <Input
                      type="number"
                      min="1"
                      max="28"
                      value={form.dayOfMonth}
                      onChange={(e) => updateForm("dayOfMonth", e.target.value)}
                      className="w-20"
                    />
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Preview: {buildCronExpression(form)} → {describeCron(buildCronExpression(form))}
                </div>
              </div>
            )}

            {form.scheduleType === "once" && (
              <div className="space-y-4 rounded-md border p-4">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(e) => updateForm("date", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Time</Label>
                  <Input
                    type="time"
                    value={form.time}
                    onChange={(e) => updateForm("time", e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !form.label ||
                !form.agentId ||
                !form.message ||
                createScheduleMut.isPending ||
                updateScheduleMut.isPending
              }
            >
              {createScheduleMut.isPending || updateScheduleMut.isPending
                ? "Saving..."
                : editingId
                  ? "Save Changes"
                  : "Create Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleDelete}
              disabled={deleteScheduleMut.isPending}
            >
              {deleteScheduleMut.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
