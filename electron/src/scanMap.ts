import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";

// One-shot map scanning: spawns a dedicated Node subprocess (ELECTRON_RUN_AS_NODE)
// that parses the local game install and emits TruckNav map data directly into
// userData/maps/<game>-scan. Progress travels over stdout as JSON lines and is
// forwarded to the renderer via "scan:progress"; the web companion polls
// GET /api/scan-status instead.

export type ScanPhase =
    | "prepare"
    | "sectors"
    | "graph"
    | "convert"
    | "writing"
    | "done";

export interface ScanState {
    running: boolean;
    game: "ets2" | "ats" | null;
    phase: ScanPhase;
    percent: number;
    detail: string | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    result: { nodes: number; edges: number; cities: number; gameVersion: string } | null;
}

const scanWorkerDir = () =>
    app.isPackaged
        ? path.join(process.resourcesPath, "scan")
        : path.join(app.getAppPath(), "electron", "resources", "scan");

let scanProcess: ChildProcess | null = null;
const listeners = new Set<(state: ScanState) => void>();

function currentState(): ScanState {
    return (globalThis as any).__scanState ?? {
        running: false,
        game: null,
        phase: "done",
        percent: 0,
        detail: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        result: null,
    };
}

function setState(patch: Partial<ScanState>) {
    const next = { ...currentState(), ...patch };
    (globalThis as any).__scanState = next;
    for (const cb of listeners) {
        try {
            cb(next);
        } catch {
            // renderer gone; ignore
        }
    }
    // broadcast to every open window (companion browsers poll /api/scan-status)
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("scan:progress", next);
        }
    }
}

function heapMb(): number {
    // Sector parsing accumulates the whole graph in memory; be generous but
    // never exceed half of physical RAM.
    return Math.min(12288, Math.floor((os.totalmem() / 1024 / 1024) * 0.5));
}

function appendLog(message: string) {
    try {
        const fs = require("fs") as typeof import("fs");
        fs.appendFileSync(
            path.join(app.getPath("userData"), "scan-log.txt"),
            `${new Date().toISOString()} ${message}\n`,
        );
    } catch {
        // logging must never break the scan
    }
}

async function runScan(game: "ets2" | "ats"): Promise<void> {
    const gameDir = getGameDirectory(game);
    if (!gameDir || !existsSync(gameDir)) {
        setState({
            running: false,
            phase: "done",
            error: `game directory not found for ${game}; pick it in settings first`,
            finishedAt: new Date().toISOString(),
        });
        return;
    }
    const worker = path.join(scanWorkerDir(), "scan-worker.mjs");
    if (!existsSync(worker)) {
        setState({
            running: false,
            phase: "done",
            error: "scan worker bundle missing (run npm run build:scan)",
            finishedAt: new Date().toISOString(),
        });
        return;
    }

    const outDir = path.join(app.getPath("userData"), "maps", `${game}-scan`);
    setState({
        running: true,
        game,
        phase: "prepare",
        percent: 0,
        detail: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
    });
    appendLog(`scan started game=${game} dir=${gameDir} out=${outDir}`);

    return new Promise<void>((resolve) => {
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
        scanProcess = spawn(
            process.execPath,
            [
                `--max-old-space-size=${heapMb()}`,
                worker,
                "--gameDir",
                gameDir,
                "--out",
                outDir,
                "--game",
                game,
            ],
            { env, windowsHide: true },
        );

        let stdoutBuffer = "";
        scanProcess.stdout?.on("data", (chunk) => {
            stdoutBuffer += chunk.toString();
            let idx;
            while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
                const line = stdoutBuffer.slice(0, idx).trim();
                stdoutBuffer = stdoutBuffer.slice(idx + 1);
                if (!line) continue;
                let parsed: any;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    appendLog(`[worker] ${line}`);
                    continue;
                }
                if (parsed.type === "progress") {
                    setState({
                        phase: parsed.phase,
                        percent: parsed.percent,
                        detail: parsed.detail ?? null,
                    });
                } else if (parsed.type === "log") {
                    appendLog(`[worker] ${parsed.message}`);
                } else if (parsed.type === "done") {
                    setState({
                        running: false,
                        phase: "done",
                        percent: 100,
                        result: parsed.stats,
                        finishedAt: new Date().toISOString(),
                    });
                    appendLog(`scan done: ${JSON.stringify(parsed.stats)}`);
                } else if (parsed.type === "error") {
                    setState({
                        running: false,
                        phase: "done",
                        error: parsed.message,
                        finishedAt: new Date().toISOString(),
                    });
                    appendLog(`scan error: ${parsed.message}`);
                }
            }
        });
        scanProcess.stderr?.on("data", (chunk) => appendLog(`[stderr] ${chunk}`));

        scanProcess.on("close", (code) => {
            const state = currentState();
            scanProcess = null;
            if (state.running) {
                setState({
                    running: false,
                    phase: "done",
                    error:
                        state.error ??
                        `scan worker exited unexpectedly (code ${code})`,
                    finishedAt: new Date().toISOString(),
                });
            }
            resolve();
        });
        scanProcess.on("error", (err) => {
            scanProcess = null;
            setState({
                running: false,
                phase: "done",
                error: `failed to start scan worker: ${err.message}`,
                finishedAt: new Date().toISOString(),
            });
            resolve();
        });
    });
}

/**
 * Best-effort Steam library lookup for the given game's install directory.
 * Returns null when Steam isn't installed or the game isn't present.
 */
function getGameDirectory(game: "ets2" | "ats"): string | null {
    const appName = game === "ets2" ? "Euro Truck Simulator 2" : "American Truck Simulator";
    const candidates: string[] = [];

    const steamRoot = getSteamRoot();
    if (steamRoot) {
        candidates.push(path.join(steamRoot, "steamapps", "common", appName));
        try {
            const vdf = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
            if (existsSync(vdf)) {
                const fs = require("fs") as typeof import("fs");
                const content = fs.readFileSync(vdf, "utf-8");
                const re = /"path"\s+"([^"]+)"/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(content))) {
                    candidates.push(
                        path.join(m[1].replace(/\\\\/g, "\\"), "steamapps", "common", appName),
                    );
                }
            }
        } catch {
            // fall through to candidates so far
        }
    }

    for (const dir of candidates) {
        if (existsSync(dir)) {
            return dir;
        }
    }
    return null;
}

function getSteamRoot(): string | null {
    try {
        const { spawnSync } = require("child_process") as typeof import("child_process");
        const res = spawnSync("reg", [
            "query",
            "HKCU\\Software\\Valve\\Steam",
            "/v",
            "SteamPath",
        ], { encoding: "utf-8", windowsHide: true });
        const match = res.stdout?.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match?.[1]) return match[1].trim();
    } catch {
        // registry not readable; no fallback for now
    }
    return null;
}

/** For the web-companion express API: same guard as the IPC handler. */
export function startScan(game: "ets2" | "ats"): { ok: boolean; error?: string } {
    if (currentState().running) {
        return { ok: false, error: "a scan is already running" };
    }
    runScan(game === "ats" ? "ats" : "ets2").catch((err) =>
        setState({
            running: false,
            phase: "done",
            error: String(err?.message ?? err),
            finishedAt: new Date().toISOString(),
        }),
    );
    return { ok: true };
}

export function registerScanMap() {
    ipcMain.handle("scan:status", () => currentState());
    ipcMain.handle("scan:start", async (_event, game: "ets2" | "ats") => {
        const heap = heapMb();
        if (os.totalmem() < 16 * 1024 * 1024 * 1024) {
            appendLog(`warning: low memory machine, heap capped at ${heap} MB`);
        }
        return startScan(game === "ats" ? "ats" : "ets2");
    });
    ipcMain.handle("scan:cancel", () => {
        if (scanProcess) {
            scanProcess.kill();
            scanProcess = null;
            setState({
                running: false,
                phase: "done",
                error: "scan cancelled",
                finishedAt: new Date().toISOString(),
            });
            return { ok: true };
        }
        return { ok: false, error: "no scan running" };
    });
    ipcMain.handle("scan:gamemapdir", (_event, game: "ets2" | "ats") =>
        getGameDirectory(game),
    );
}

export function attachScanProgress(cb: (state: ScanState) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function currentScanState(): ScanState {
    return currentState();
}

export function killScan() {
    if (scanProcess) {
        try {
            scanProcess.kill();
        } catch {
            // already gone
        }
        scanProcess = null;
    }
}
