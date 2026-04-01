/**
 * Shared time formatting utilities for the frontend.
 */

/**
 * Parse a timestamp string as UTC. SQLite's datetime('now') produces bare
 * strings like "2026-04-01 12:00:00" without a timezone suffix. Browsers
 * interpret those as local time, so we append 'Z' to force UTC parsing.
 */
export function parseUtcTimestamp(ts: string): Date {
  if (/[Zz]$/.test(ts) || /[+-]\d{2}:?\d{2}$/.test(ts)) {
    return new Date(ts);
  }
  return new Date(ts.replace(" ", "T") + "Z");
}

/** Short relative time string: "just now", "3m ago", "2h ago", "5d ago" */
export function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = parseUtcTimestamp(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatTime12h(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Message timestamp label:
 * - <60s: "just now"
 * - <60m: "Xm ago"
 * - same day: "X:XX AM/PM"
 * - yesterday: "Yesterday X:XX AM/PM"
 * - older: "Mar 15 X:XX AM/PM"
 */
export function messageTimeLabel(isoString: string): string {
  const now = new Date(Date.now());
  const date = parseUtcTimestamp(isoString);
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.floor((today.getTime() - msgDay.getTime()) / 86_400_000);

  if (dayDiff === 0) return formatTime12h(date);
  if (dayDiff === 1) return `Yesterday ${formatTime12h(date)}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${formatTime12h(date)}`;
}

/** Day separator label: "Today", "Yesterday", or "Monday, March 15, 2026" */
export function dateSeparatorLabel(isoString: string): string {
  const now = new Date(Date.now());
  const date = parseUtcTimestamp(isoString);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.floor((today.getTime() - msgDay.getTime()) / 86_400_000);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Check whether two ISO date strings fall on the same calendar day (local time). */
export function isSameDay(a: string, b: string): boolean {
  const da = parseUtcTimestamp(a);
  const db = parseUtcTimestamp(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
