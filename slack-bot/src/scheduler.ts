import { logger } from "./logger.js";
import { msUntil, nextMidnightEt, nextWeeklyMondayEt, nowEt } from "./time.js";

type JobFn = () => Promise<void> | void;

function scheduleOnce(whenMsFromNow: number, name: string, fn: JobFn) {
  logger.info("Scheduling job", { name, inMs: whenMsFromNow });
  setTimeout(async () => {
    try {
      logger.info("Job start", { name, at: nowEt().toISO() });
      await fn();
      logger.info("Job finish", { name, at: nowEt().toISO() });
    } catch (e: any) {
      logger.error("Job error", { name, error: e?.message || String(e) });
    }
  }, whenMsFromNow).unref?.(); // allow process to exit if nothing else
}

export function scheduleDailyEt(name: string, fn: JobFn) {
  const scheduleNext = () => {
    const next = nextMidnightEt();
    const ms = msUntil(next);
    scheduleOnce(ms, name, async () => {
      await fn();
      scheduleNext();
    });
  };
  scheduleNext();
}

export function scheduleWeeklyMondayEt(name: string, fn: JobFn) {
  const scheduleNext = () => {
    const next = nextWeeklyMondayEt();
    const ms = msUntil(next);
    scheduleOnce(ms, name, async () => {
      await fn();
      scheduleNext();
    });
  };
  scheduleNext();
}
