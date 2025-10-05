import { randomUUID} from "crypto"
import { store } from "./src/storage/fileStore"
import { addTransaction } from "./src/ledger"
import { canStartBet } from "./src/economy"
import { logger } from "./src/logger"

export type ChallengeGame = "coin_flip" | "old_maid" | "poker" | "typing_battle";
export type Opponent =
    | { kind: "user"; id: string }
    | { kind: "dealer" };