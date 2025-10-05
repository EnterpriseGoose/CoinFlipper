import { App } from "@slack/bolt";
import { store } from "./storage/fileStore";
import { logger } from "./logger";
import { getBalance, runDailyGrantForAll } from "./economy";

const COOLDOWN_MS = 60_000;
const cooldwon = new Map<string, number>();

function nowIso() { return new Date().toISOString(); }

function ensureUserInState(userId: string) {
    const s = store.get();
    if (!s.users[userId]) {
        s.users[userId] = {
            id: userId,
            play: false,
            see: false,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            stats: { currentStreak: 0, longestStreak: 0 },
        };
    }
    if (!s.balances[userId]) {
        s.balances[userId] = { userId, amount: 0, updatedAt: nowIso() };
    }
}

async function setPlay(userId: string, on: boolean) {
    await store.update((s) => {
        ensureUserInState(userId);
        s.users[userId].play = on;
        s.users[userId].updatedAt = nowIso();
    });
}

async function setSee(userId: string, on: boolean) {
    await store.update((s) => {
        ensureUserInState(userId);
        s.users[userId].see = on;
        s.users[userId].updatedAt = nowIso();
    });
}

export function buildSlackApp() {
    const app = new App({
        token: process.env.SLACK_BOT_TOKEN,
        socketMode: true,
        appToken: process.env.SLACK_APP_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
    });

    //add special emoji reaction
    app.event("reaction_added", async ({ event, client, logger: boltLogger }) => {
        const ev: any = event;
        try {
            if (ev.reaction !== "siege-coin") return; //change based on reaction name i forgor name
            const userId: string = ev.user;
            if (!userId || userId === "USLACKBOT") return;

            await setPlay(userId, true);
            logger.info("Opt-in (PLAY) via :siege-coin: reaction", { userId });

            const channelId: string | undefined = ev.item?.channel;
            if (channelId) {
                await client.chat.postEphemeral({
                    channel: channelId,
                    user: userId,
                    text: "Welcome to the gamblers. You can now use commands! Toggle the activity feed with `/see on` or `/see off`. Opt out anytime with `/stopgambling`.",
                });
            }
        } catch (e: any) {
            boltLogger.error(e);
        }
    });

    app.command("/see", async ({ ack, respond, command }) => {
        await ack();
        const userId = command.user_id;
        const arg = (command.text || "").trim().toLowerCase();

        if (arg !== "on" && arg !== "off") {
            await respond({
                response_type: "ephemeral",
                text: "Usage: `/see on` or `/see off` "
            });
            return;
        }
        
        const on = arg === "on";
        await setSee(userId, on);

        await respond({
            response_type: "ephemeral",
            text: on
            ? "👀 Activity feed is now **ON**. You’ll see public game posts."
            : "🙈 Activity feed is now **OFF**. You won’t see public game posts."
        });
    });

    app.command("/stopgambling", async ({ ack, respond, command }) => {
        await ack();
        const userId = command.user_id;
        await store.update((s) => {
            ensureUserInState(userId);
            s.users[userId].play = false;
            s.users[userId].see = false;
            s.users[userId].updatedAt = nowIso();
        });

        await respond ({
            response_type: "ephemeral",
            text: "🛑 You’re opted out. The bot won’t react to you or show you game activity. Re-opt-in by reacting with :siege-coin: on any post."  
        });
    });

    app.command("/coin", async ({ ack, respond, command}) => {
        await ack();
        const userId = command.user_id;

        const s = store.get();
        if (!s.users[userId]) {
            await store.update((st) => {
                st.users[userId] = {
                    id: userId,
                    play: false,
                    see: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toDateString(),
                    stats: { currentStreak: 0, longestStreak: 0},
                };
            });
        }

        const balance = getBalance(userId);
        const u = store.get().users[userId];

        await respond({
            response_type: "ephemeral",
            blocks: [
                {
                    type: "section",
                    text: { type: "mrkdwn", text: `*Your coins:* \`${balance}\`` }
                },
                {
                    type: "context",
                    elements: [
                        { type: "mrkdwn", text: `PLAY: *${u.play ? "on" : "off"}* • SEE: *${u.see ? "on" : "off"}*` },
                        { type: "mrkdwn", text: `Streak: *${u.stats.currentStreak}* (best *${u.stats.longestStreak}*)` }
                    ]
                }
            ]
        });
    });

    //because socket is being stupid
    app.event("app_mention", async ({event, say, client}) => {
        const ev = event as any;
        const text = String((event as any).text || "").toLowerCase();

        if (text.includes("hello")) {
            await client.chat.postMessage({
                channel: ev.channel,
                text: `hello <@${ev.user}>, start gambling RIGHT NOW!`,
            });
            return;
        }

        if (text.includes("help")) {
            await client.chat.postMessage({
                channel: ev.channel,
                text: "Hi ! Opt in by reacting with :siege-coin:. Toggle feed with `/see on|off`. Opt out with `/stopgambling`.",
                thread_ts: ev.thread_ts || ev.ts,
            });
        }
    });
    return app;
}

export async function startSlackApp(app: ReturnType<typeof buildSlackApp>) {
    const port = Number(process.env.PORT) || 3000;
    await app.start({ port });
    logger.info("Slack app runnin (SOCKET)", { port });
}