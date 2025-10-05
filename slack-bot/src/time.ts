import { DateTime } from "luxon";
import { ET_TZ } from "./config.js";

export function nowEt(): DateTime {
  return DateTime.now().setZone(ET_TZ);
}

export function nextMidnightEt(): DateTime {
  const now = nowEt();
  return now.plus({ days: 1 }).startOf("day");
}

export function nextWeeklyMondayEt(): DateTime {
  // Monday 00:00 ET
  const now = nowEt().startOf("minute");
  let next = now.set({ weekday: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });
  if (next <= now) next = next.plus({ weeks: 1 });
  return next;
}

export function msUntil(dt: DateTime): number {
  const diff = dt.toMillis() - nowEt().toMillis();
  return Math.max(0, diff);
}
