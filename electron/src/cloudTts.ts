import { app, ipcMain } from "electron";
import { createHash } from "crypto";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "fs";
import path from "path";
import type { Readable } from "stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// Online neural TTS through the Edge "Read Aloud" endpoint (msedge-tts):
// free, keyless, and dramatically better pronunciation than the bundled
// melo model — this is the primary voice when the toggle is on. Every
// result is cached on disk per (locale, voice, text), so a cue only costs
// one round trip ever; offline launches replay the cache, misses fall
// through to the local sherpa engine and then the OS voice. The cloud is
// never a hard dependency, so failures must stay invisible.

// One female neural voice per app locale; locales absent here skip the
// cloud path (the OS voice covers them).
const CLOUD_VOICES: Record<string, string> = {
    zh: "zh-CN-XiaoxiaoNeural",
    en: "en-US-AvaMultilingualNeural",
    de: "de-DE-TanjaNeural",
    nl: "nl-NL-FennaNeural",
    cs: "cs-CZ-VlastaNeural",
    sk: "sk-SK-ViktoriaNeural",
    ro: "ro-RO-AlinaNeural",
    ko: "ko-KR-SunHiNeural",
};

// Keep the newest N synthesized cues on disk (~tens of KB per mp3).
const CACHE_MAX_FILES = 200;
// Hard bound on collecting one stream; the renderer races a shorter
// grace so a hung request never stalls a live cue past the OS fallback.
const SYNTHESIS_TIMEOUT_MS = 15_000;

interface CloudAudio {
    kind: "mp3";
    bytes: ArrayBuffer;
}

interface CloudHandle {
    tts: MsEdgeTTS;
    ready: Promise<void>;
}

// One socket-backed client per voice, reused across cues. Any failure
// retires the handle — a broken socket poisons the instance.
const handles = new Map<string, CloudHandle>();

function handleFor(voice: string): CloudHandle {
    let handle = handles.get(voice);
    if (!handle) {
        const tts = new MsEdgeTTS({
            connectionTimeoutMs: 8_000,
            synthesisTimeoutMs: SYNTHESIS_TIMEOUT_MS,
        });
        handle = {
            tts,
            ready: tts.setMetadata(
                voice,
                OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
            ),
        };
        handles.set(voice, handle);
        // A rejected handshake must not stay cached as "ready".
        handle.ready.catch(() => {
            if (handles.get(voice) === handle) {
                handles.delete(voice);
                try {
                    tts.close();
                } catch {
                    // already dead socket
                }
            }
        });
    }
    return handle;
}

// toStream splices the text into an SSML template verbatim — escape the
// XML metacharacters cue text could carry.
function xmlEscape(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function collect(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
            stream.destroy();
            reject(new Error("cloud synthesis timed out"));
        }, SYNTHESIS_TIMEOUT_MS);
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
            clearTimeout(timer);
            resolve(Buffer.concat(chunks));
        });
        stream.on("error", (e: unknown) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

function cacheDir(): string {
    return path.join(app.getPath("userData"), "tts-cloud-cache");
}

function cacheFile(voice: string, text: string): string {
    const hash = createHash("sha1")
        .update(`${voice}\u0000${text}`)
        .digest("hex");
    return path.join(cacheDir(), `${hash}.mp3`);
}

// Best-effort LRU: newest N files survive, pruning errors never sink a
// fresh synthesis.
function pruneCache(keep: string): void {
    try {
        const dir = cacheDir();
        const files = readdirSync(dir)
            .filter((f) => f.endsWith(".mp3"))
            .map((f) => ({ f, mtime: statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        for (const stale of files.slice(CACHE_MAX_FILES)) {
            if (path.join(dir, stale.f) === keep) continue;
            unlinkSync(path.join(dir, stale.f));
        }
    } catch {
        // pruning is optional housekeeping
    }
}

async function synthesizeCloud(
    text: string,
    locale: string,
): Promise<CloudAudio | null> {
    const voice = CLOUD_VOICES[locale];
    if (!voice || text.trim().length === 0) return null;

    const file = cacheFile(voice, text);
    if (existsSync(file)) {
        try {
            const buf = readFileSync(file);
            return {
                kind: "mp3",
                bytes: buf.buffer.slice(
                    buf.byteOffset,
                    buf.byteOffset + buf.byteLength,
                ) as ArrayBuffer,
            };
        } catch {
            // corrupt or locked cache entry: fall through to a fresh take
        }
    }

    const handle = handleFor(voice);
    try {
        await handle.ready;
        const { audioStream } = handle.tts.toStream(xmlEscape(text), {
            // Match the OS path's slightly brisk 1.05 rate.
            rate: "+5%",
        });
        const buf = await collect(audioStream);
        if (buf.length === 0) return null;

        try {
            mkdirSync(cacheDir(), { recursive: true });
            writeFileSync(file, buf);
            pruneCache(file);
        } catch {
            // an unwritable cache only costs the next launch a re-fetch
        }

        return {
            kind: "mp3",
            bytes: buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength,
            ) as ArrayBuffer,
        };
    } catch (e) {
        console.error("CloudTts: synthesis failed:", e);
        handles.delete(voice);
        try {
            handle.tts.close();
        } catch {
            // already dead socket
        }
        return null;
    }
}

/** Wire the cloud TTS IPC endpoint; call once during app setup. */
export function registerCloudTts(): void {
    ipcMain.handle(
        "tts:cloud:synthesize",
        (_event, text: unknown, locale: unknown) => {
            if (typeof text !== "string" || typeof locale !== "string") {
                return null;
            }
            return synthesizeCloud(text, locale);
        },
    );
}
