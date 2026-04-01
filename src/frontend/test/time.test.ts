import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  parseUtcTimestamp,
  timeAgo,
  messageTimeLabel,
  dateSeparatorLabel,
  isSameDay,
} from "../lib/time";

// Pin "now" to 2026-03-31 14:30:00 local time for deterministic tests
const NOW = new Date(2026, 2, 31, 14, 30, 0).getTime();
let origDateNow: () => number;

beforeEach(() => {
  origDateNow = Date.now;
  Date.now = () => NOW;
});

afterEach(() => {
  Date.now = origDateNow;
});

describe("parseUtcTimestamp", () => {
  it("appends Z to bare SQLite timestamps", () => {
    const d = parseUtcTimestamp("2026-04-01 12:00:00");
    expect(d.toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });

  it("handles ISO strings with Z suffix unchanged", () => {
    const d = parseUtcTimestamp("2026-04-01T12:00:00.000Z");
    expect(d.toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });

  it("handles ISO strings with timezone offset", () => {
    const d = parseUtcTimestamp("2026-04-01T12:00:00+05:00");
    expect(d.toISOString()).toBe("2026-04-01T07:00:00.000Z");
  });

  it("handles T-separated strings without timezone", () => {
    const d = parseUtcTimestamp("2026-04-01T12:00:00");
    expect(d.toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for <60s ago", () => {
    const ts = new Date(NOW - 30_000).toISOString();
    expect(timeAgo(ts)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const ts = new Date(NOW - 5 * 60_000).toISOString();
    expect(timeAgo(ts)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const ts = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(timeAgo(ts)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const ts = new Date(NOW - 2 * 86_400_000).toISOString();
    expect(timeAgo(ts)).toBe("2d ago");
  });

  it("handles bare SQLite UTC timestamp", () => {
    // 5 minutes ago in UTC, formatted as bare SQLite string
    const fiveMinAgo = new Date(NOW - 5 * 60_000);
    const bare = fiveMinAgo.toISOString().replace("T", " ").replace(".000Z", "");
    expect(timeAgo(bare)).toBe("5m ago");
  });
});

describe("messageTimeLabel", () => {
  it("returns 'just now' for <60s", () => {
    const ts = new Date(NOW - 10_000).toISOString();
    expect(messageTimeLabel(ts)).toBe("just now");
  });

  it("returns 'Xm ago' for <60m", () => {
    const ts = new Date(NOW - 25 * 60_000).toISOString();
    expect(messageTimeLabel(ts)).toBe("25m ago");
  });

  it("returns time for same day messages past 1h", () => {
    // 3h ago = 11:30 AM same day
    const ts = new Date(2026, 2, 31, 11, 30, 0).toISOString();
    expect(messageTimeLabel(ts)).toBe("11:30 AM");
  });

  it("returns 'Yesterday HH:MM' for yesterday", () => {
    const ts = new Date(2026, 2, 30, 9, 15, 0).toISOString();
    expect(messageTimeLabel(ts)).toBe("Yesterday 9:15 AM");
  });

  it("returns 'Mon DD HH:MM' for older dates", () => {
    const ts = new Date(2026, 2, 15, 15, 42, 0).toISOString();
    expect(messageTimeLabel(ts)).toBe("Mar 15 3:42 PM");
  });

  it("formats midnight correctly as 12:00 AM", () => {
    const ts = new Date(2026, 2, 31, 0, 0, 0).toISOString();
    expect(messageTimeLabel(ts)).toBe("12:00 AM");
  });

  it("formats noon correctly as 12:00 PM", () => {
    const ts = new Date(2026, 2, 31, 12, 0, 0).toISOString();
    expect(messageTimeLabel(ts)).toBe("12:00 PM");
  });
});

describe("dateSeparatorLabel", () => {
  it("returns 'Today' for today", () => {
    const ts = new Date(2026, 2, 31, 10, 0, 0).toISOString();
    expect(dateSeparatorLabel(ts)).toBe("Today");
  });

  it("returns 'Yesterday' for yesterday", () => {
    const ts = new Date(2026, 2, 30, 10, 0, 0).toISOString();
    expect(dateSeparatorLabel(ts)).toBe("Yesterday");
  });

  it("returns formatted date for older dates", () => {
    const ts = new Date(2026, 2, 15, 10, 0, 0).toISOString();
    const label = dateSeparatorLabel(ts);
    // Should contain the day number and year at minimum
    expect(label).toContain("15");
    expect(label).toContain("2026");
  });
});

describe("isSameDay", () => {
  it("returns true for same day", () => {
    expect(
      isSameDay(
        new Date(2026, 2, 31, 8, 0, 0).toISOString(),
        new Date(2026, 2, 31, 22, 0, 0).toISOString(),
      ),
    ).toBe(true);
  });

  it("returns false for different days", () => {
    expect(
      isSameDay(
        new Date(2026, 2, 30, 23, 59, 0).toISOString(),
        new Date(2026, 2, 31, 0, 0, 0).toISOString(),
      ),
    ).toBe(false);
  });

  it("returns false for same day different months", () => {
    expect(
      isSameDay(
        new Date(2026, 1, 15, 10, 0, 0).toISOString(),
        new Date(2026, 2, 15, 10, 0, 0).toISOString(),
      ),
    ).toBe(false);
  });
});
