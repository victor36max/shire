import { describe, expect, test } from "bun:test";
import {
  buildCronExpression,
  describeCron,
  parseCronToForm,
  localHourToUtc,
  utcHourToLocal,
  getDayShift,
  getReverseDayShift,
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
