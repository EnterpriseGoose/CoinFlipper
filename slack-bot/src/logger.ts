type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

let currentLevel: Level = "info";

export function setLogLevel(level: Level) {
    currentLevel = level;
}

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}) {
    if (LEVELS[level] < LEVELS[currentLevel]) return;
    const line = {
        t: new Date().toISOString(),
        level,
        msg,
        ...ctx,
    };
    //Logs
    console.log(JSON.stringify(line));
}

export const logger= {
    debug: (m: string, c?: Record<string, unknown>) => log("debug", m, c),
    info: (m: string, c?: Record<string, unknown>) => log("info", m, c),
    warn: (m: string, c?: Record<string, unknown>) => log("warn", m, c),
    error:(m: string, c?: Record<string, unknown>) => log("error", m, c),
};