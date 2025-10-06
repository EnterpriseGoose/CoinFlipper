import { DateTime } from "luxon";
import { CONFIG } from "./config.js";
import { setLogLevel, logger } from "./logger.js";
import { store } from "./storage/fileStore.js"
import { scheduleDailyEt, scheduleWeeklyMondayEt } from "./scheduler.js";
import { buildSlackApp, startSlackApp } from "./slackApp.js";
import { runDailyGrantForAll } from "./economy.js";

async function init() {
  setLogLevel(CONFIG.logLevel);
  await store.init();

  logger.info("Inital functions", {
    dataDir: CONFIG.dataDir,
    stateFile: CONFIG.stateFile,
    tz: CONFIG.etTz,
    flags: store.get().featureFlags,
  });

  const app = buildSlackApp();
  await startSlackApp(app);
  await runDailyGrantForAll();

  // Payout done, add other stuff later(self ranking maybe?)
  scheduleDailyEt("daily-midnight-et", async () => {
    const dateEt = DateTime.now().setZone(CONFIG.etTz).toISODate()!;
    await runDailyGrantForAll(dateEt);
    logger.info("Daily tick (ET) complete", { dateEt });
  });

  // add weekly reset, leaderboard
  scheduleWeeklyMondayEt("weekly-monday-et", async () => {
    const weekOf = DateTime.now().setZone(CONFIG.etTz).toISODate()!;
    logger.info("Weekly tick (ET)", { weekOf });
  });
}

init().catch((e) => {
  logger.error("Fatal init error idiot", { error: e?.message || String(e)});
  process.exit(1);
});

