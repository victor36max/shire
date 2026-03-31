export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Frequency = "every_n_minutes" | "hourly" | "daily" | "weekly" | "monthly";

export interface CronFormFields {
  frequency: Frequency;
  minute: string;
  hour: string;
  daysOfWeek: number[];
  dayOfMonth: string;
  intervalMinutes: string;
}

/** Get the local timezone offset in hours (e.g., UTC+8 returns 8, UTC-5 returns -5) */
export function getTzOffsetHours(): number {
  return new Date().getTimezoneOffset() / -60;
}

/** Convert local hour to UTC hour */
export function localHourToUtc(hour: number, tzOffset = getTzOffsetHours()): number {
  return (((hour - tzOffset) % 24) + 24) % 24;
}

/** Convert UTC hour to local hour */
export function utcHourToLocal(hour: number, tzOffset = getTzOffsetHours()): number {
  return (((hour + tzOffset) % 24) + 24) % 24;
}

/**
 * Compute day-of-week shift when converting local hour to UTC.
 * Returns -1 if UTC is previous day, +1 if next day, 0 if same day.
 */
export function getDayShift(localHour: number, tzOffset = getTzOffsetHours()): number {
  return Math.floor((localHour - tzOffset) / 24);
}

/**
 * Compute reverse day-of-week shift when converting UTC hour to local.
 * Returns -1, 0, or +1.
 */
export function getReverseDayShift(utcHour: number, tzOffset = getTzOffsetHours()): number {
  return Math.floor((utcHour + tzOffset) / 24);
}

/** Shift a 1-based day (1=Mon..7=Sun) by dayShift, wrapping around the week. */
function shiftDay(day: number, dayShift: number): number {
  return ((((day - 1 + dayShift) % 7) + 7) % 7) + 1;
}

export function buildCronExpression(form: CronFormFields, tzOffset = getTzOffsetHours()): string {
  const localMin = parseInt(form.minute || "0");
  const localHr = parseInt(form.hour || "9");
  const utcHr = localHourToUtc(localHr, tzOffset);
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
      const dayShift = getDayShift(localHr, tzOffset);
      const dayNames = form.daysOfWeek
        .map((d) => shiftDay(d, dayShift))
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

export function formatTime(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:${minute.toString().padStart(2, "0")} ${ampm}`;
}

export function describeCron(cron: string, tzOffset = getTzOffsetHours()): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hr, dom, , dow] = parts;

  if (min?.startsWith("*/")) {
    return `Every ${min.slice(2)} minutes`;
  }
  if (hr === "*" && dom === "*") {
    return `Hourly at :${min?.padStart(2, "0")}`;
  }

  const utcHour = parseInt(hr || "0");
  const localHour = utcHourToLocal(utcHour, tzOffset);
  const timeStr = formatTime(localHour, parseInt(min || "0"));

  if (dow && dow !== "*") {
    const reverseDayShift = getReverseDayShift(utcHour, tzOffset);
    const dayStr = dow
      .split(",")
      .map((d) => {
        const idx = DAY_LABELS.findIndex(
          (l) => l.toUpperCase().slice(0, 3) === d.toUpperCase().slice(0, 3),
        );
        if (idx === -1) return d.charAt(0) + d.slice(1).toLowerCase();
        const localIdx = shiftDay(idx + 1, reverseDayShift) - 1;
        return DAY_LABELS[localIdx];
      })
      .join(", ");
    return `${dayStr} at ${timeStr}`;
  }
  if (dom && dom !== "*") {
    return `Monthly on day ${dom} at ${timeStr}`;
  }
  return `Daily at ${timeStr}`;
}

export function parseCronToForm(
  cron: string,
  tzOffset = getTzOffsetHours(),
): Partial<CronFormFields> {
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

  const utcHour = parseInt(hr || "9");
  const localHour = String(utcHourToLocal(utcHour, tzOffset));

  if (dow && dow !== "*") {
    const reverseDayShift = getReverseDayShift(utcHour, tzOffset);
    const days = dow
      .split(",")
      .map((d) => {
        const idx = DAY_LABELS.findIndex(
          (l) => l.toUpperCase().slice(0, 3) === d.toUpperCase().slice(0, 3),
        );
        if (idx === -1) return null;
        return shiftDay(idx + 1, reverseDayShift);
      })
      .filter((d): d is number => d !== null);
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
