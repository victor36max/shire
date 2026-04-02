import { describe, expect, test } from "bun:test";
import {
  buildCronExpression,
  describeCron,
  parseCronToForm,
  localHourToUtc,
  utcHourToLocal,
  getDayShift,
  getReverseDayShift,
  getTzOffsetHours,
  formatTime,
  type CronFormFields,
} from "./cron-utils";

const baseForm: CronFormFields = {
  frequency: "weekly",
  minute: "42",
  hour: "4",
  daysOfWeek: [2, 3, 4, 5, 6], // Tue-Sat
  dayOfMonth: "1",
  intervalMinutes: "30",
};

describe("localHourToUtc / utcHourToLocal", () => {
  test("UTC+8: local 4 → UTC 20", () => {
    expect(localHourToUtc(4, 8)).toBe(20);
  });

  test("UTC+8: UTC 20 → local 4", () => {
    expect(utcHourToLocal(20, 8)).toBe(4);
  });

  test("UTC-5: local 22 → UTC 3 (next day)", () => {
    expect(localHourToUtc(22, -5)).toBe(3);
  });

  test("UTC-5: UTC 3 → local 22", () => {
    expect(utcHourToLocal(3, -5)).toBe(22);
  });

  test("UTC+0: local 10 → UTC 10", () => {
    expect(localHourToUtc(10, 0)).toBe(10);
  });
});

describe("getDayShift", () => {
  test("UTC+8 at 4 AM: day shifts -1 (previous day in UTC)", () => {
    expect(getDayShift(4, 8)).toBe(-1);
  });

  test("UTC+8 at 10 AM: no day shift", () => {
    expect(getDayShift(10, 8)).toBe(0);
  });

  test("UTC-5 at 22: day shifts +1 (next day in UTC)", () => {
    expect(getDayShift(22, -5)).toBe(1);
  });

  test("UTC-5 at 2 AM: no day shift", () => {
    expect(getDayShift(2, -5)).toBe(0);
  });

  test("UTC+0: never shifts", () => {
    expect(getDayShift(0, 0)).toBe(0);
    expect(getDayShift(23, 0)).toBe(0);
  });
});

describe("getReverseDayShift", () => {
  test("UTC+8 with UTC hour 20: reverse shift +1 (local is next day)", () => {
    expect(getReverseDayShift(20, 8)).toBe(1);
  });

  test("UTC+8 with UTC hour 10: no reverse shift", () => {
    expect(getReverseDayShift(10, 8)).toBe(0);
  });

  test("UTC-5 with UTC hour 3: reverse shift -1 (local is previous day)", () => {
    expect(getReverseDayShift(3, -5)).toBe(-1);
  });
});

describe("buildCronExpression — day-of-week shift", () => {
  test("UTC+8 at 4:42 AM: Tue-Sat local → Mon-Fri in cron", () => {
    const cron = buildCronExpression(baseForm, 8);
    // Tue(2)-Sat(6) shifted by -1 → Mon(1)-Fri(5)
    expect(cron).toBe("42 20 * * MON,TUE,WED,THU,FRI");
  });

  test("UTC+8 at 10 AM: no day shift, Tue-Sat stays Tue-Sat", () => {
    const form = { ...baseForm, hour: "10" };
    const cron = buildCronExpression(form, 8);
    expect(cron).toBe("42 2 * * TUE,WED,THU,FRI,SAT");
  });

  test("UTC-5 at 10 PM: Mon-Fri local → Tue-Sat in cron", () => {
    const form: CronFormFields = {
      ...baseForm,
      hour: "22",
      daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    };
    const cron = buildCronExpression(form, -5);
    // Mon(1)-Fri(5) shifted by +1 → Tue(2)-Sat(6)
    expect(cron).toBe("42 3 * * TUE,WED,THU,FRI,SAT");
  });

  test("UTC+0: no day shift", () => {
    const cron = buildCronExpression(baseForm, 0);
    expect(cron).toBe("42 4 * * TUE,WED,THU,FRI,SAT");
  });

  test("UTC+8 at 4 AM: Sun wraps to Sat", () => {
    const form = { ...baseForm, daysOfWeek: [7] }; // Sun
    const cron = buildCronExpression(form, 8);
    // Sun(7) shifted by -1 → Sat(6)
    expect(cron).toBe("42 20 * * SAT");
  });

  test("UTC-5 at 10 PM: Sat wraps to Sun", () => {
    const form: CronFormFields = {
      ...baseForm,
      hour: "22",
      daysOfWeek: [6], // Sat
    };
    const cron = buildCronExpression(form, -5);
    // Sat(6) shifted by +1 → Sun(7)
    expect(cron).toBe("42 3 * * SUN");
  });

  test("daily frequency is not affected by day shift", () => {
    const form: CronFormFields = { ...baseForm, frequency: "daily" };
    const cron = buildCronExpression(form, 8);
    expect(cron).toBe("42 20 * * *");
  });
});

describe("describeCron — shows local days", () => {
  test("UTC+8: MON-FRI in cron → Tue-Sat in display", () => {
    const desc = describeCron("42 20 * * MON,TUE,WED,THU,FRI", 8);
    expect(desc).toBe("Tue, Wed, Thu, Fri, Sat at 4:42 AM");
  });

  test("UTC-5: TUE-SAT in cron → Mon-Fri in display", () => {
    const desc = describeCron("42 3 * * TUE,WED,THU,FRI,SAT", -5);
    expect(desc).toBe("Mon, Tue, Wed, Thu, Fri at 10:42 PM");
  });

  test("UTC+0: no shift in display", () => {
    const desc = describeCron("42 4 * * TUE,WED,THU,FRI,SAT", 0);
    expect(desc).toBe("Tue, Wed, Thu, Fri, Sat at 4:42 AM");
  });

  test("daily cron not affected", () => {
    const desc = describeCron("0 20 * * *", 8);
    expect(desc).toBe("Daily at 4:00 AM");
  });
});

describe("parseCronToForm — reverses day shift", () => {
  test("UTC+8: MON-FRI in cron → Tue-Sat in form", () => {
    const result = parseCronToForm("42 20 * * MON,TUE,WED,THU,FRI", 8);
    expect(result.frequency).toBe("weekly");
    expect(result.hour).toBe("4");
    expect(result.minute).toBe("42");
    expect(result.daysOfWeek?.sort()).toEqual([2, 3, 4, 5, 6]); // Tue-Sat
  });

  test("UTC-5: TUE-SAT in cron → Mon-Fri in form", () => {
    const result = parseCronToForm("42 3 * * TUE,WED,THU,FRI,SAT", -5);
    expect(result.frequency).toBe("weekly");
    expect(result.hour).toBe("22");
    expect(result.daysOfWeek?.sort()).toEqual([1, 2, 3, 4, 5]); // Mon-Fri
  });

  test("UTC+0: no shift", () => {
    const result = parseCronToForm("42 4 * * TUE,WED,THU,FRI,SAT", 0);
    expect(result.daysOfWeek?.sort()).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("getTzOffsetHours", () => {
  test("returns a number", () => {
    expect(typeof getTzOffsetHours()).toBe("number");
  });
});

describe("formatTime", () => {
  test("formats AM time correctly", () => {
    expect(formatTime(9, 5)).toBe("9:05 AM");
  });

  test("formats PM time correctly", () => {
    expect(formatTime(14, 30)).toBe("2:30 PM");
  });

  test("formats noon as 12 PM", () => {
    expect(formatTime(12, 0)).toBe("12:00 PM");
  });

  test("formats midnight as 12 AM", () => {
    expect(formatTime(0, 0)).toBe("12:00 AM");
  });

  test("formats 1 AM correctly", () => {
    expect(formatTime(1, 0)).toBe("1:00 AM");
  });
});

describe("buildCronExpression — non-weekly frequencies", () => {
  test("every_n_minutes uses default 30", () => {
    const form: CronFormFields = {
      frequency: "every_n_minutes",
      minute: "0",
      hour: "9",
      daysOfWeek: [],
      dayOfMonth: "1",
      intervalMinutes: "",
    };
    expect(buildCronExpression(form, 0)).toBe("*/30 * * * *");
  });

  test("every_n_minutes uses specified interval", () => {
    const form: CronFormFields = {
      frequency: "every_n_minutes",
      minute: "0",
      hour: "9",
      daysOfWeek: [],
      dayOfMonth: "1",
      intervalMinutes: "15",
    };
    expect(buildCronExpression(form, 0)).toBe("*/15 * * * *");
  });

  test("hourly uses minute field", () => {
    const form: CronFormFields = {
      frequency: "hourly",
      minute: "15",
      hour: "9",
      daysOfWeek: [],
      dayOfMonth: "1",
      intervalMinutes: "30",
    };
    expect(buildCronExpression(form, 0)).toBe("15 * * * *");
  });

  test("monthly uses dayOfMonth", () => {
    const form: CronFormFields = {
      frequency: "monthly",
      minute: "0",
      hour: "10",
      daysOfWeek: [],
      dayOfMonth: "15",
      intervalMinutes: "30",
    };
    expect(buildCronExpression(form, 0)).toBe("0 10 15 * *");
  });

  test("weekly with empty daysOfWeek falls back to daily", () => {
    const form: CronFormFields = {
      frequency: "weekly",
      minute: "0",
      hour: "9",
      daysOfWeek: [],
      dayOfMonth: "1",
      intervalMinutes: "30",
    };
    expect(buildCronExpression(form, 0)).toBe("0 9 * * *");
  });

  test("unknown frequency falls back to daily", () => {
    const form: CronFormFields = {
      frequency: "unknown" as CronFormFields["frequency"],
      minute: "0",
      hour: "9",
      daysOfWeek: [],
      dayOfMonth: "1",
      intervalMinutes: "30",
    };
    expect(buildCronExpression(form, 0)).toBe("0 9 * * *");
  });
});

describe("describeCron — additional formats", () => {
  test("every N minutes", () => {
    expect(describeCron("*/15 * * * *", 0)).toBe("Every 15 minutes");
  });

  test("hourly at specific minute", () => {
    expect(describeCron("30 * * * *", 0)).toBe("Hourly at :30");
  });

  test("monthly cron", () => {
    expect(describeCron("0 10 15 * *", 0)).toBe("Monthly on day 15 at 10:00 AM");
  });

  test("invalid cron returns raw string", () => {
    expect(describeCron("not a cron")).toBe("not a cron");
  });

  test("unknown day name falls back to capitalized form", () => {
    expect(describeCron("0 10 * * XDAY", 0)).toBe("Xday at 10:00 AM");
  });
});

describe("parseCronToForm — additional formats", () => {
  test("every_n_minutes cron", () => {
    const result = parseCronToForm("*/10 * * * *", 0);
    expect(result.frequency).toBe("every_n_minutes");
    expect(result.intervalMinutes).toBe("10");
  });

  test("hourly cron", () => {
    const result = parseCronToForm("30 * * * *", 0);
    expect(result.frequency).toBe("hourly");
    expect(result.minute).toBe("30");
  });

  test("monthly cron", () => {
    const result = parseCronToForm("0 10 15 * *", 0);
    expect(result.frequency).toBe("monthly");
    expect(result.hour).toBe("10");
    expect(result.dayOfMonth).toBe("15");
  });

  test("daily cron", () => {
    const result = parseCronToForm("0 9 * * *", 0);
    expect(result.frequency).toBe("daily");
    expect(result.hour).toBe("9");
    expect(result.minute).toBe("0");
  });

  test("invalid cron returns empty", () => {
    const result = parseCronToForm("bad");
    expect(result).toEqual({});
  });

  test("weekly cron with unknown day returns empty daysOfWeek for unknown", () => {
    const result = parseCronToForm("0 10 * * XDAY", 0);
    expect(result.frequency).toBe("weekly");
    expect(result.daysOfWeek).toEqual([]);
  });
});

describe("round-trip: buildCron → parseCronToForm preserves local intent", () => {
  test("UTC+8: Tue-Sat at 4:42 AM round-trips correctly", () => {
    const cron = buildCronExpression(baseForm, 8);
    const parsed = parseCronToForm(cron, 8);
    expect(parsed.hour).toBe("4");
    expect(parsed.minute).toBe("42");
    expect(parsed.daysOfWeek?.sort()).toEqual([2, 3, 4, 5, 6]);
  });

  test("UTC-5: Mon-Fri at 10 PM round-trips correctly", () => {
    const form: CronFormFields = {
      ...baseForm,
      hour: "22",
      daysOfWeek: [1, 2, 3, 4, 5],
    };
    const cron = buildCronExpression(form, -5);
    const parsed = parseCronToForm(cron, -5);
    expect(parsed.hour).toBe("22");
    expect(parsed.daysOfWeek?.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("UTC+0: no shift needed, round-trips correctly", () => {
    const cron = buildCronExpression(baseForm, 0);
    const parsed = parseCronToForm(cron, 0);
    expect(parsed.hour).toBe("4");
    expect(parsed.daysOfWeek?.sort()).toEqual([2, 3, 4, 5, 6]);
  });
});
