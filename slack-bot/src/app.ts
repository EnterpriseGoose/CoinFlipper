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

    if (CONFIG.leaderboardChannelId) {
      try {
        await app.client.chat.postMessage({
          channel: CONFIG.leaderboardChannelId,
          text: buildTop10Text(),
        });
        logger.info("Posted daily Top 10", { channel: CONFIG.leaderboardChannelId });
      } catch (e: any) {
        logger.warn("Failed to post daily Top 10", { error: e?.message });
      }
    }
  });

  // add weekly reset, leaderboard
  scheduleWeeklyMondayEt("weekly-monday-et", async () => {
    const weekOf = DateTime.now().setZone(CONFIG.etTz).toISODate()!;
    logger.info("Weekly tick (ET)", { weekOf });

    if (CONFIG.leaderboardChannelId) {
      try {
        await app.client.chat.postMessage({
          channel: CONFIG.leaderboardChannelId,
          text: buildTop10Text(),
        });
        logger.info("Posted weekly Top 10", { channel: CONFIG.leaderboardChannelId });
      } catch (e: any) {
        logger.warn("Failed to post weekly Top 10", { error: e?.message });
      }
    }
  });
}

function buildTop10Text(): string {
  const s = store.get();
  const balances = Object.values(s.balances || {}); // { userId, amount }
  const top = balances
    .sort((a: any, b: any) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 10);

  const lines = top.map((b: any, i: number) => `${i + 1}. <@${b.userId}> — ${b.amount} coins`);
  return `🏆 *Top 10 Coin Holders*\n\n${lines.join("\n")}${top.length === 0 ? "_No players yet._" : ""}`;
}


init().catch((e) => {
  logger.error("Fatal init error idiot", { error: e?.message || String(e)});
  process.exit(1);
});

