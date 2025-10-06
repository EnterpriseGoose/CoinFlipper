import { DateTime } from "luxon";
import { CONFIG } from "./config.js";
import { logger } from "./logger.js";

type JobFn = () => Promise<void> | void;

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return 1000;
  return Math.max(1000, Math.floor(ms));
}

function msUntil(target: DateTime): number {
  const now = DateTime.now().setZone(CONFIG.etTz);
  const diff = target.diff(now).as("milliseconds");
  return clampDelay(diff);
}

function nextMidnightEt(): DateTime {
  const now = DateTime.now().setZone(CONFIG.etTz);
  return now.plus({ days: 1 }).startOf("day");
}

function nextMondayMidnightEt(): DateTime {
  const now = DateTime.now().setZone(CONFIG.etTz);
  const daysUntilMon = ((8 - now.weekday) % 7) || 7;
  return now.plus({ days: daysUntilMon }).startOf("day");
}

export function scheduleDailyEt(name: string, fn: JobFn) {
  async function run() {
    logger.info("Job start", { name, at: DateTime.now().toISO() });
    try {
      await fn();
    } catch (e: any) {
      logger.error("Job error", { name, error: e?.message || String(e) });
    } finally {
      logger.info("Job finish", { name, at: DateTime.now().toISO() });
      const delay = msUntil(nextMidnightEt());
      logger.info("Scheduling job", { name, inMs: delay });
      setTimeout(run, delay);
    }
  }

  const delay = msUntil(nextMidnightEt());
  logger.info("Scheduling job", { name, inMs: delay });
  setTimeout(run, delay);
}

export function scheduleWeeklyMondayEt(name: string, fn: JobFn) {
  async function run() {
    logger.info("Job start", { name, at: DateTime.now().toISO() });
    try {
      await fn();
    } catch (e: any) {
      logger.error("Job error", { name, error: e?.message || String(e) });
    } finally {
      logger.info("Job finish", { name, at: DateTime.now().toISO() });
      const delay = msUntil(nextMondayMidnightEt());
      logger.info("Scheduling job", { name, inMs: delay });
      setTimeout(run, delay);
    }
  }
  const delay = msUntil(nextMondayMidnightEt());
  logger.info("Scheduling job", { name, inMs: delay });
  setTimeout(run, delay);
}