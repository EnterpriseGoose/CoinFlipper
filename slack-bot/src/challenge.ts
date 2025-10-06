import { randomUUID} from "crypto"
import { store } from "./storage/fileStore"
import { addTransaction } from "./ledger"
import { canStartBet } from "./economy"
import { logger } from "./logger"

export type ChallengeGame = "coin_flip" | "old_maid" | "poker" | "typing_battle";
export type Opponent =
    | { kind: "user"; id: string }
    | { kind: "dealer" };

export type Challenge = {
    id: string;
    channel: string;
    rootTs?: string;
    createdAt: string;
    updatedAt: string;
    challengerId: string;
    opponent: Opponent;
    game: ChallengeGame;
    stake: number;
    state: "pending" | "declined" | "accepted" | "canceled";
    acceptedBy?: string;
};

function nowIso() { return new Date().toISOString(); }

export function getChallenge(id: string): Challenge | undefined {
    return (store.get().games[id] as any) as Challenge | undefined;
}

export async function createChallengeRecord(
    params: Omit<Challenge, "id" | "createdAt" | "updatedAt" | "state">
): Promise<Challenge> {
    const id = randomUUID();
    const rec: Challenge = {
        id,
        ...params,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        state: "pending",
    };

    await store.update((s) => {
        (s.games[id] as any) = rec;
    });

    logger.info("Challenge created", { id, challengerId: rec.challengerId, game: rec.game, stake: rec.stake, opp: rec.opponent.kind });
    return rec;
}

export async function setChallengeRootMessage(id: string, channel: string, ts: string) {
    await store.update((s) => {
        const r = (s.games[id] as any) as Challenge | undefined;
        if (!r) return;
        r.channel = channel;
        r.rootTs = ts;
        r.updatedAt = nowIso();
    });
}

export async function declineChallenge(id: string, declinerId?: string): Promise<Challenge | undefined> {
    let updated: Challenge | undefined;
    await store.update((s) => {
        const r = (s.games[id] as any) as Challenge | undefined;
        if (!r) return;
        r.state = "declined";
        r.updatedAt = nowIso();
        updated = r;
    });
    logger.info("Challenge declined", { id, declinerId });
    return updated;
}

export async function acceptChallengeAndLockStake(id: string, accepterId: string): Promise<{ ok: boolean; reason?: string; rec?: Challenge }> {
    const rec = getChallenge(id);
    if (!rec) return { ok: false, reason: "Challenge not found"};
    if (rec.state !== "pending") return { ok: false, reason: `Challenge is ${rec.state}`};

    const challengerCheck = canStartBet(rec.challengerId);
    if(!challengerCheck.ok) return { ok: false, reason:    `Challenger cannot start: ${challengerCheck.reason}`};

    if (rec.opponent.kind === "user") {
        if (accepterId !== rec.opponent.id) return { ok: false, reason: "Only the challenged user can accept"};
        const oppCheck = canStartBet(rec.opponent.id);
        if (!oppCheck.ok) return { ok: false, reason: `Opponent cannot start: ${oppCheck.reason}` };
    }

    try {
        await addTransaction(rec.challengerId, "bet", -rec.stake, {
            refId: `challenge:${rec.id}`,
            idemKey: `challenge:${rec.id}:stake:${rec.challengerId}`
        });

        if  (rec.opponent.kind === "user") {
            await addTransaction(rec.opponent.id, "bet", -rec.stake, {
                refId: `challenge:${rec.id}`,
                idemKey: `challenge:${rec.id}:stake:${rec.opponent.id}`
            });
        }
    } catch (e: any) {
        logger.error("Stake lock failed", { id: rec.id, error: e?.message || String(e) });
        return { ok: false, reason: "Stake lock failed"};
    }

    await store.update((s) => {
        const r = (s.games[id] as any) as Challenge;
        r.state = "accepted";
        r.acceptedBy = accepterId;
        r.updatedAt = nowIso();
    });

    logger.info("Challenge accepted", { id: rec.id, accepterId });
    return { ok: true, rec: getChallenge(id) };
}

export async function refundStakes(id: string) {
    const rec = getChallenge(id);
    if (!rec) return;
    const refundOne = async (uid: string) => {
        try {
            await addTransaction(uid, "refund", rec.stake, {
                refId: `challenge:${rec.id}`,
                idemKey: `challenge:${rec.id}:refund:${uid}`
            });
        } catch {}
    };

    await refundOne(rec.challengerId);
    if (rec.opponent.kind === "user") {
        await refundOne(rec.opponent.id);
    }
}