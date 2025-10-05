export type FeatureFlags = {
    optIn: boolean;
    economy: boolean;
    shop: boolean;
    streaks: boolean;
    games: boolean;
    leaderboard: boolean;
    secretCoins: boolean;
    aiDebate: boolean;
};

export type User = {
    id: string;
    play:boolean;
    see: boolean;
    tz?: string;
    createdAt: string;
    updatedAt: string;
    stats: {
        currentStreak: number;
        longestStreak: number;
        lastQualifyingDateEt?: string;
    };
};

export type InventoryItem =
| { key: "streak_saver"; qty: number}
| { key: "game_breaker"; qty: number}
| { key: "sigma"; qty: number}
| { key: "reactor"; qty: number};

export type TransactionType =
| "grant"
| "bet"
| "win"
| "loss"
| "purchase"
| "refund"
| "admin";

export type Transaction = {
    txId: string;
    userId: string;
    type: TransactionType;
    amount: number;
    balanceAfter: number
    refId?: string;
    createdAt: string;
    idemKey?: string;
};

export type Balance = {
    userId: string;
    amount: number;
    updatedAt: string;
};

export type SecretCoinAward = {
    userId: string;
    at: string;
    reason: string;
};

export type GameRecord = {
    id: string;
    type: "coin_flip" | "old_maid" | "poker" | "typing_battle";
    participants: string[];
    state: "pending" | "active" | "completed" | "cancelled";
    stake?: number;
    winnderId?: string;
    createdAt: string;
    updatedAt: string;
};

export type AnnoucmentConfig = {
    channelId?: string;
    dailyTopEnabled: boolean;
    weeklyResetEnabled: boolean;
};

export type IdempotencyEntry = {
    key: string;
    createdAt: string;
    ttlMs?: number;
    meta?: Record<string, unknown>;
};

export type State = {
    version: number;
    users: Record<string, User>;
    balances: Record<string, Balance>;
    inventory: Record<string, InventoryItem[]>;
    transactions: Transaction[];
    games: Record<string, GameRecord>;
    announcements: AnnoucmentConfig; 
    secretCoins: {
        globalCap: number;
        awards: SecretCoinAward[];
    };
    idempotency: Record<string, IdempotencyEntry>;
    featureFlags: FeatureFlags;
    createdAt: string;
    updatedAt: string;
};


