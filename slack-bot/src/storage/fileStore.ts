import { promises as fs } from "fs";
import * as path from "path";
import { CONFIG } from "../config.js";
import { State } from  "../types.js";
import { logger } from "../logger.js";

const DEFAULT_STATE = (): State => ({
    version: 1,
    users: {},
    balances: {},
    inventory: {},
    transactions: [],
    games: {},
    announcements: { dailyTopEnabled: false, weeklyResetEnabled: false },
    secretCoins: { globalCap: 3, awards: [] },
    idempotency: {},
    featureFlags: { ...CONFIG.defaultFlags },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

export class FileStore {
   private state: State = DEFAULT_STATE();
   private filePath: string;

   constructor() {
    this.filePath = path.join(CONFIG.dataDir, CONFIG.stateFile);
   }

   async init() {
    await fs.mkdir(CONFIG.dataDir, { recursive: true});
    try {
        const raw = await fs.readFile(this.filePath, "utf8");
        this.state = JSON.parse(raw) as State;
        logger.info("State loaded", { file: this.filePath });
    } catch (e: any) {
        logger.warn("No exisitng state; creating new", { file: this.filePath});
        await this.save();
    }
   }

   get(): State {
    return this.state;
   }

   async save() {
    this.state.updatedAt = new Date().toISOString();
    const tmp = this.filePath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
    logger.debug("State saved", { file: this.filePath }); 
   }

   async update(mutator: (s: State) => void) {
    mutator(this.state);
    await this.save();
   }
}

export const store = new FileStore();