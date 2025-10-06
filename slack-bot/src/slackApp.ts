import { App } from "@slack/bolt";
import { store } from "./storage/fileStore";
import { logger } from "./logger";
import { getBalance } from "./economy";
import { createChallengeRecord, setChallengeRootMessage, acceptChallengeAndLockStake, declineChallenge, refundStakes, getChallenge } from "./challenge";
import { canStartBet } from "./economy";  


const COOLDOWN_MS = 60_000;
const cooldown = new Map<string, number>()

function isPlay(userId: string): boolean {
    const u = store.get().users[userId];
    return !!u?.play;
}

function onCooldown(key: string): boolean {
    const now = Date.now();
    const until = cooldown.get(key) || 0;
    if (now < until) return true;
    cooldown.set(key, now + COOLDOWN_MS);
    return false;
}

async function safeAddReaction(
    client: any,
    channel: string,
    ts: string,
    name: string,
    fallback?: string
) {
    try {
        await client.reactions.add({ channel, timestamp: ts, name });
    } catch (e) {
        if (fallback) {
            try {
                await client.reactions.add({ channel, timestamp: ts, name: fallback });
            } catch {

            }
        }
    }
}

function getMessageSurfaceIds(msg: any) : { channel?:string; ts?: string } {
    const channel = (msg as any).channel as string | undefined;
    const ts = (msg as any).ts as string | undefined;
    return { channel, ts};
}

function isChannelLike(id?: string) {
    // REMEMBER C = PUBLIC || G = PRIVATE || D = DM
    return !!id && (id.startsWith("C") || id.startsWith("G"));
}


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

function parseUserMention(text: string): string | null {
    const m = text.match(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/i);
    return m ? m [1] : null;
}


type ChallengeParseOk = {
  ok: true;
  opponent: "dealer" | "user";
  opponentId?: string;
  game: "coin_flip" | "old_maid" | "poker" | "typing_battle";
  stake: number;
};
type ChallengeParseErr = { ok: false; error: string };
type ChallengeParse = ChallengeParseOk | ChallengeParseErr;

function parseChallengeArgs(txt: string): ChallengeParse {
  const parts = (txt || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return { ok: false, error: "Usage: /challenge @user|dealer [game] [amount]" };

  const target = parts[0].toLowerCase();
  let opponent: "dealer" | "user" = "user";
  let opponentId: string | undefined;

  if (target === "dealer") {
    opponent = "dealer";
  } else {
    const uid = parseUserMention(parts[0]);
    if (!uid) return { ok: false, error: "First arg must be @user or 'dealer'" };
    opponent = "user";
    opponentId = uid;
  }

  const gameMap: Record<string, ChallengeParseOk["game"]> = {
    coin: "coin_flip",
    coin_flip: "coin_flip",
    oldmaid: "old_maid",
    old_maid: "old_maid",
    poker: "poker",
    typing: "typing_battle",
    typing_battle: "typing_battle",
  };
  const gRaw = parts[1].toLowerCase();
  const game = gameMap[gRaw];
  if (!game) return { ok: false, error: "Game must be one of: coin, oldmaid, poker, typing" };

  const stake = Number(parts[2]);
  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, error: "Amount must be a positive number" };

  return { ok: true, opponent, opponentId, game, stake };
}

async function resolveUserIdByHandle(client: any, token: string): Promise<string | null> {
    const handle = token.replace(/^@/, "").toLowerCase();
    console.log("Looking for handle:", handle); // Add this
    let cursor: string | undefined;
    
    try {
        do {
            const res = await client.users.list({ limit: 200, cursor });
            const members = (res.members as any[]) ?? [];
            
            console.log(`Checking ${members.length} users...`); // Add this
            
            for (const m of members) {
                if (m.deleted || m.is_bot) continue;
                const uname = (m.name ?? "").toLowerCase();
                const dname = (m.profile?.display_name ?? "").toLowerCase();
                const rname = (m.profile?.real_name ?? "").toLowerCase();
                
                // Add this debug line to see what usernames exist
                if (uname.includes("qwik") || dname.includes("qwik") || rname.includes("qwik")) {
                    console.log("Found potential match:", { uname, dname, rname, id: m.id });
                }
                
                if (uname === handle || dname === handle || rname === handle) {
                    console.log("Exact match found:", { uname, dname, rname, id: m.id }); // Add this
                    return m.id as string;
                }
            }
            cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor);
    } catch (e: any) {
        logger.error("Error resolving user handle", { handle, error: e?.message });
    }
    
    console.log("No user found for handle:", handle);
    return null;
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

    app.command("/challenge", async ({ ack, respond, command, client, logger }) => {
        await ack();
        const userId = command.user_id;
        const channelId = command.channel_id;

        const s = store.get();
        if (!s.users[userId]?.play) {
            await respond({ response_type: "ephemeral", text: "You must opt in first. React with :siege-coin: to opy in. "});
            return;
        }

        const can = canStartBet(userId);
        if(!can.ok) {
            await respond({ response_type: "ephemeral", text: can.reason! });
            return;
        }

        await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: "Choose someone to challenge",
            blocks: [
                {
                    type: "section",
                    block_id: "pick",
                    text: { type: "mrkdwn", text: "Choose someone to challenge:" },
                    accessory: {
                        type: "users_select",
                        action_id: "opponent",
                        placeholder: { type: "plain_text", text: "Default: yourself" }
                    }
                },
                {
                    type: "actions",
                    elements: [
                    { type: "button", text: { type: "plain_text", text: ":x: Cancel" }, value: "cancel", action_id: "challenge_cancel" },
                    { type: "button", text: { type: "plain_text", text: ":white_check_mark: Go!" }, value: "confirm", action_id: "challenge_confirm" }
                    ]
                }
            ]
        });
    });

    app.action("opponent", async ({ ack }) => { await ack(); });

    app.action("challenge_cancel", async ({ ack, respond }) => {
        await ack();
        await respond({ delete_original: true });
    });

    app.action("challenge_confirm", async ({ ack, body, client, respond }) => {
        await ack();

        const userId = (body as any).user?.id as string | undefined;
        const channelId = (body as any).channel?.id as string | undefined;
        if (!userId || !channelId) return;

        const vals = (body as any).state?.values;
        const opponentId = vals?.pick?.opponent?.selected_user as string | undefined ?? userId;

        const can = canStartBet(userId);
        if (!can.ok) {
            await respond({ text: can.reason!, response_type: "ephemeral" });
            return;
        }

        const game: "coin_flip" = "coin_flip";
        const stake = 5;

        const rec = await createChallengeRecord({
            channel: channelId,
            challengerId: userId,
            opponent: { kind: "user", id: opponentId },
            game,
            stake
        });

        const textHead = `<@${userId}> challenged <@${opponentId}> to *coin flip* for *${stake}* coins.`;

        const post = await client.chat.postMessage({
            channel: channelId,
            text: textHead,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: textHead } },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "Accept" }, style: "primary", action_id: "challenge_accept", value: rec.id },
                        { type: "button", text: { type: "plain_text", text: "Decline" }, style: "danger", action_id: "challenge_decline", value: rec.id }
                    ]
                }
            ]
        });

        await setChallengeRootMessage(rec.id, channelId, (post as any).ts);

        await client.chat.postEphemeral({
            channel: channelId,
            user: opponentId,
            text: `You were challenged by <@${userId}> to *coin flip* for *${stake}* coins. Accept or decline above.`
        });

        await respond({ delete_original: true });
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
                    updatedAt: new Date().toISOString(),
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

    app.message(/\bcoin\b/i, async ({ message, client }) => {
        const m: any = message;
        const userId = m.user as string | undefined;
        if (!userId || userId === "USLACKBOT") return;
        if (!isPlay(userId)) return;
        if (m.subtype) return;

        const { channel, ts } = getMessageSurfaceIds(m);
        if(!channel || !ts) return;

        const key = `${userId}:${channel}:coin`;
        if (onCooldown(key)) return;

        await safeAddReaction(client, channel, ts, "siege-coin");
    });


    app.message(/\b(?:gamble|gambling)\b/i, async ({ message, client }) => {
        const m: any = message;
        const userId = m.user as string | undefined;
        if (!userId || userId === "USLACKBOT") return;
        if (!isPlay(userId)) return;
        if (m.subtype) return;

        const { channel, ts } = getMessageSurfaceIds(m);
        if (!channel || !ts) return;

        const key = `${userId}:${channel}:gamble`;
        if (onCooldown(key)) return;

        await safeAddReaction(client, channel, ts, "game_die", "slot_machine");

        if (isChannelLike(channel)) {
            try {
            await client.chat.postEphemeral({
                channel,
                user: userId,
                text: "let's go **gambling**! 🎲",
            });
            } catch {}
        }
    });

    app.message(/\bwin(ned)?\b|\bwon\b/i, async ({ message, client}) => {
        const m: any = message;
        const userId = m.user as string | undefined;
        if (!userId || userId === "USLACKBOT") return;
        if (!isPlay(userId)) return;
        if (m.subtype) return;

        const { channel, ts } = getMessageSurfaceIds(m);
        if (!channel || !ts) return;

        const key = `${userId}:${channel}:win`;
        if (onCooldown(key)) return;

        await safeAddReaction(client, channel, ts, "heidi_happy", "tada")
    });

    app.message(/\blose\b|\blost\b/i, async ({ message, client }) => {
        const m: any = message;
        const userId = m.user as string | undefined;
        if (!userId || userId === "USLACKBOT") return;
        if (!isPlay(userId)) return;
        if (m.subtype) return;

        const { channel, ts } = getMessageSurfaceIds(m);
        if (!channel || !ts) return;

        const key = `${userId}:${channel}:lose`;
        if (onCooldown(key)) return;

        await safeAddReaction(client, channel, ts, "orpheus_sad", "cry");
    });

    // app.command("/challenge", async ({ ack, respond, command, client, logger }) => {
    //     await ack();
    //     try {
    //         const userId = command.user_id;
    //         const channelId = command.channel_id;

    //         logger?.info?.("challenge:received", { text: command.text, userId, channelId });

    //         const s = store.get();
    //         if (!s.users[userId]?.play) {
    //             await respond({ response_type: "ephemeral", text: "You must opt in first. React with :siege-coin: to opt in." });
    //             return;
    //         }

    //         const parts = (command.text || "").trim().split(/\s+/).filter(Boolean);
    //         let parsed = parseChallengeArgs(command.text || "");

    //         if (!parsed.ok && parts[0]?.startsWith("@") && parts.length >= 3) {
    //         const handleUid = await resolveUserIdByHandle(client, parts[0]);
    //         if (!handleUid) {
    //             await respond({ response_type: "ephemeral", text: `Couldn't find user ${parts[0]}. Try picking them from the mention popup.` });
    //             return;
    //         }
    //         parsed = parseChallengeArgs(`<@${handleUid}> ${parts[1]} ${parts[2]}`);
    //         }

    //         if (!parsed.ok) {
    //         await client.views.open({
    //             trigger_id: command.trigger_id,
    //             view: {
    //             type: "modal",
    //             callback_id: "challenge_modal",
    //             private_metadata: JSON.stringify({ channelId }),
    //             title: { type: "plain_text", text: "Start a challenge" },
    //             submit: { type: "plain_text", text: "Start" },
    //             close: { type: "plain_text", text: "Cancel" },
    //             blocks: [
    //                 { type: "input", block_id: "op", label: { type: "plain_text", text: "Opponent" }, element: { type: "users_select", action_id: "opponent" } },
    //                 { type: "input", block_id: "gm", label: { type: "plain_text", text: "Game" }, element: { type: "static_select", action_id: "game",
    //                     options: [
    //                     { text: { type: "plain_text", text: "Coin flip" }, value: "coin_flip" },
    //                     { text: { type: "plain_text", text: "Old Maid" }, value: "old_maid" },
    //                     { text: { type: "plain_text", text: "Poker" }, value: "poker" },
    //                     { text: { type: "plain_text", text: "Typing battle" }, value: "typing_battle" }
    //                     ] } },
    //                 { type: "input", block_id: "st", label: { type: "plain_text", text: "Stake (coins)" }, element: { type: "plain_text_input", action_id: "stake" } }
    //             ]
    //             }
    //         });
    //         await respond({ response_type: "ephemeral", text: "Pick opponent/game/stake in the modal." });
    //         return;
    //         }


    //         const can = canStartBet(userId);
    //         if (!can.ok) {
    //             await respond({ response_type: "ephemeral", text: can.reason! });
    //             return;
    //         }

    //         if (parsed.opponent === "user" && parsed.opponentId === userId) {
    //             await respond({ response_type: "ephemeral", text: "You can’t challenge yourself." });
    //             return;
    //         }

    //         const rec = await createChallengeRecord({
    //             channel: channelId,
    //             challengerId: userId,
    //             opponent: parsed.opponent === "dealer" ? { kind: "dealer" } : { kind: "user", id: parsed.opponentId! },
    //             game: parsed.game,
    //             stake: parsed.stake,
    //         });

    //         logger?.info?.("challenge:created", { id: rec.id, game: rec.game, stake: rec.stake, opponent: rec.opponent });

    //         const textHead = `<@${userId}> challenged ` + (rec.opponent.kind === "user" ? `<@${(rec.opponent as any).id}>` : "*the dealer*") +` to *${rec.game.replace("_", " ")}* for *${rec.stake}* coins.`;

    //         if (rec.opponent.kind === "user") {
    //             const post = await client.chat.postMessage({
    //                 channel: channelId,
    //                 text: textHead,
    //                 blocks: [
    //                     { type: "section", text: { type: "mrkdwn", text: textHead } },
    //                     {
    //                         type: "actions",
    //                         elements: [
    //                             { type: "button", text: { type: "plain_text", text: "Accept" }, style: "primary", action_id: "challenge_accept", value: rec.id },
    //                             { type: "button", text: { type: "plain_text", text: "Decline" }, style: "danger", action_id: "challenge_decline", value: rec.id },
    //                         ],
    //                     },
    //                 ],
    //             });

    //         await setChallengeRootMessage(rec.id, channelId, (post as any).ts);

    //         await client.chat.postEphemeral({
    //             channel: channelId,
    //             user: (rec.opponent as any).id,
    //             text: `You were challenged by <@${userId}> to *${rec.game.replace("_", " ")}* for *${rec.stake}* coins. Accept or decline above.`,
    //         });

    //         await respond({ response_type: "ephemeral", text: "Challenge posted. Waiting for acceptance…" });
            
    //         } else {
    //             const post = await client.chat.postMessage({
    //                 channel: channelId,
    //                 text: textHead + " Dealer is thinking…",
    //                 blocks: [{ type: "section", text: { type: "mrkdwn", text: textHead + "\n_Dealer accepts._" } }],
    //             });

    //         await setChallengeRootMessage(rec.id, channelId, (post as any).ts);

    //         const accepted = await acceptChallengeAndLockStake(rec.id, userId);
    //         if (!accepted.ok) {
    //             await client.chat.postMessage({
    //                 channel: channelId,
    //                 thread_ts: (post as any).ts,
    //                 text: `Could not start: ${accepted.reason}`,
    //             });
    //             await refundStakes(rec.id);
    //             return;
    //         }

    //         await client.chat.postMessage({
    //             channel: channelId,
    //             thread_ts: (post as any).ts,
    //             text: `Challenge accepted by *dealer*. (Game flow starts in Phase 5.)`,
    //         });

    //         await respond({ response_type: "ephemeral", text: "Dealer accepted. Game will start (Phase 5)." });
    //         }

    //     } catch (e: any) {
    //         logger?.error?.("challenge:handler-error", { error: e?.message, stack: e?.stack });
    //         try {
    //             await respond({ response_type: "ephemeral", text: "Something went wrong starting the challenge. Try again." });
    //         } catch { /* ignore */ }
    //     }
    // });


    app.view("challenge_modal", async ({ ack, body, view, client, logger }) => {
        await ack();

        try {
            const meta = JSON.parse(view.private_metadata || "{}");
            const channelId = meta.channelId as string | undefined;
            const challengerId = body.user.id as string;

            const opponentId = view.state.values?.op?.opponent?.selected_user as string | undefined;
            if (!opponentId) {
                if (channelId) {
                    await client.chat.postEphemeral({ channel: channelId, user: challengerId, text: "Pick an opponent." });
                } else {
                    const im = await client.conversations.open({ users: challengerId });
                    await client.chat.postMessage({ channel: im.channel!.id!, text: "Pick an opponent." });
                }
            return;
            }

            const game = (view.state.values?.gm?.game?.selected_option?.value ?? "coin_flip") as
            "coin_flip" | "old_maid" | "poker" | "typing_battle";
            const stakeRaw = (view.state.values?.st?.stake?.value ?? "").trim();
            const stake = Number(stakeRaw);


            if (!Number.isFinite(stake) || stake <= 0) {
            if (channelId) {
                await client.chat.postEphemeral({
                channel: channelId,
                user: challengerId,
                text: "Stake must be a positive number."
                });
            }
            return;
            }

            if (!channelId) {
            const im = await client.conversations.open({ users: challengerId });
            await client.chat.postMessage({
                channel: im.channel!.id!,
                text: "Couldn’t find the original channel to post in."
            });
            return;
            }

            const rec = await createChallengeRecord({
            channel: channelId,
            challengerId,
            opponent: { kind: "user", id: opponentId },
            game,
            stake
            });

            const textHead =
            `<@${challengerId}> challenged <@${opponentId}> to *${game.replace("_"," ")}* for *${stake}* coins.`;

            const post = await client.chat.postMessage({
            channel: channelId,
            text: textHead,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: textHead } },
                {
                type: "actions",
                elements: [
                    { type: "button", text: { type: "plain_text", text: "Accept" }, style: "primary", action_id: "challenge_accept", value: rec.id },
                    { type: "button", text: { type: "plain_text", text: "Decline" }, style: "danger", action_id: "challenge_decline", value: rec.id }
                ]
                }
            ]
            });

            await setChallengeRootMessage(rec.id, channelId, (post as any).ts);

            await client.chat.postEphemeral({
            channel: channelId,
            user: opponentId,
            text: `You were challenged by <@${challengerId}> to *${game.replace("_"," ")}* for *${stake}* coins. Accept or decline above.`
            });

        } catch (e: any) {
            logger.error("challenge_modal_error", { error: e?.message, stack: e?.stack });
        }
    });

    app.action("challenge_accept", async ({ ack, body, client, respond }) => {
        await ack();
        const action = (body as any).actions?.[0];
        const challengeId = action?.value as string | undefined;
        const userId = (body as any).user?.id as string | undefined;
        const channelId = (body as any).channel?.id as string | undefined;
        if (!challengeId || !userId || !channelId) return;

        const rec = getChallenge(challengeId);
        if (!rec) { await respond?.({ response_type:"ephemeral", text:"Challenge no longer exists." }); return; }
        if (rec.opponent.kind !== "user" || rec.opponent.id !== userId) {
            await respond?.({ response_type:"ephemeral", text:"Only the challenged user can accept." });
            return;
        }
        if (!store.get().users[userId]?.play) {
            await respond?.({ response_type:"ephemeral", text:"Opt in first: react with :siege-coin: then tap Accept again." });
            return;
        }

        const res = await acceptChallengeAndLockStake(challengeId, userId);
        if (!res.ok) { await respond?.({ response_type:"ephemeral", text:`Could not accept: ${res.reason}` }); return; }

        const ts = getChallenge(challengeId)?.rootTs;
        await client.chat.postMessage({ channel: channelId, thread_ts: ts, text: `✅ <@${userId}> accepted. Stakes locked. (Game runs in Phase 5.)` });
        if (ts) {
            await client.chat.update({
            channel: channelId, ts,
            text: `Challenge accepted.`,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Challenge accepted.*` } }]
            });
        }
        });

        app.action("challenge_decline", async ({ ack, body, client, respond }) => {
        await ack();
        const action = (body as any).actions?.[0];
        const challengeId = action?.value as string | undefined;
        const userId = (body as any).user?.id as string | undefined;
        const channelId = (body as any).channel?.id as string | undefined;
        if (!challengeId || !userId || !channelId) return;

        const rec = getChallenge(challengeId);
        if (!rec) { await respond?.({ response_type:"ephemeral", text:"Challenge no longer exists." }); return; }
        if (rec.opponent.kind !== "user" || rec.opponent.id !== userId) {
            await respond?.({ response_type:"ephemeral", text:"Only the challenged user can decline." });
            return;
        }

        await declineChallenge(challengeId, userId);
        await refundStakes(challengeId);

        const ts = rec.rootTs;
        await client.chat.postMessage({ channel: channelId, thread_ts: ts, text: `❌ <@${userId}> declined the challenge.` });
        if (ts) {
            await client.chat.update({
            channel: channelId, ts,
            text: `Challenge declined.`,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: `*Challenge declined.*` } }]
            });
        }
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

    app.command("/listusers", async ({ ack, respond, client }) => {
        await ack();
        
        try {
            const res = await client.users.list({ limit: 20 });
            const members = (res.members as any[]) ?? [];
            const userList = members
                .filter(m => !m.deleted && !m.is_bot)
                .map(m => `${m.name} (${m.profile?.display_name || 'no display name'})`)
                .slice(0, 10)
                .join('\n');
                
            await respond({
                response_type: "ephemeral",
                text: `First 10 users:\n${userList}`
            });
        } catch (e) {
            await respond({
                response_type: "ephemeral", 
                text: "Error fetching users"
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