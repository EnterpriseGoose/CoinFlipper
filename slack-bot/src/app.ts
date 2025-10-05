import "dotenv/config";
import { App } from "@slack/bolt";
import { CONFIG } from "./config.js";
import { setLogLevel, logger } from "./logger.js";
import { store } from "./storage/fileStore.js"
import { scheduleDailyEt, scheduleWeeklyMondayEt } from "./scheduler.js";
import { nowEt } from "./time.js";

async function init() {
  setLogLevel(CONFIG.logLevel);
  await store.init();

  logger.info("Backend done", {
    dataDir: CONFIG.dataDir,
    stateFile: CONFIG.stateFile,
    tz: CONFIG.etTz,
    flags: store.get().featureFlags,
  });
  
  // add payout and other stuff later
  scheduleDailyEt("daily-midnight-et", async () => {
    logger.info("Daily tick (ET)", { dateEt: nowEt().toISODate() });
  });

  // add weekly reset, leaderboard
  scheduleWeeklyMondayEt("weekly-monday-et", async () => {
    logger.info("Weekly tick (ET)", { weekOf: nowEt().toISODate() });
  });
}

init().catch((e) => {
  logger.error("Fatal init error idiot", { error: e?.message || String(e)});
  process.exit(1);
});