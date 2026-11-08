import { app, ipcMain } from "electron";
import { existsSync } from "fs";
import path from "path";

// Offline neural TTS via sherpa-onnx (WASM build). Two constraints shaped
// this: the native addon returns samples as external ArrayBuffers, which
// Electron's V8 sandbox forbids ("External buffers are not allowed", also
// under ELECTRON_RUN_AS_NODE), so the WASM variant runs in-process; and
// sherpa-onnx 2.x drops dictDir, which melo's jieba Chinese segmentation
// needs — hence the 1.10.x pin. WASM synthesis is ~5x slower than native
// (2-6 s per cue vs <1 s), still far inside the announcement lead times,
// and the renderer caches synthesized cues.

const MODEL_ID = "vits-melo-tts-zh_en";
// The bundled melo model speaks Chinese + English; other locales fall back.
const SUPPORTED_LOCALES = new Set(["zh", "en"]);

// Minimal shape of the sherpa-onnx WASM module we rely on (upstream ships
// no TypeScript declarations).
interface SherpaAudio {
    samples: Float32Array;
    sampleRate: number;
}
interface SherpaOfflineTts {
    generate(args: { text: string; sid: number; speed: number }): SherpaAudio;
}
interface SherpaModule {
    createOfflineTts(config: unknown): SherpaOfflineTts;
}

let offlineTts: SherpaOfflineTts | null = null;
let engineError: string | null = null;

// The WASM engine handles one generate() at a time; keep requests ordered.
let generationChain: Promise<unknown> = Promise.resolve();

function modelDir(): string {
    // Same layout as bin/: loose folder in dev, extraResources when packed.
    const base = app.isPackaged
        ? path.join(process.resourcesPath, "tts-models")
        : path.join(app.getAppPath(), "tts-models");
    return path.join(base, MODEL_ID);
}

function modelFilesPresent(): boolean {
    const dir = modelDir();
    return (
        existsSync(path.join(dir, "model.onnx")) &&
        existsSync(path.join(dir, "tokens.txt")) &&
        existsSync(path.join(dir, "lexicon.txt")) &&
        existsSync(path.join(dir, "dict"))
    );
}

function ensureEngine(): SherpaOfflineTts | null {
    if (offlineTts) return offlineTts;
    if (engineError) return null;

    if (!modelFilesPresent()) {
        engineError = `TTS model files not found under ${modelDir()}`;
        return null;
    }

    const dir = modelDir();
    try {
        const sherpa = require("sherpa-onnx") as SherpaModule;
        // The config replaces the wrapper defaults wholesale, so every
        // model block must be present (see sherpa-onnx-tts.js 1.10.46).
        offlineTts = sherpa.createOfflineTts({
            offlineTtsModelConfig: {
                offlineTtsVitsModelConfig: {
                    model: path.join(dir, "model.onnx"),
                    tokens: path.join(dir, "tokens.txt"),
                    lexicon: path.join(dir, "lexicon.txt"),
                    dataDir: "",
                    dictDir: path.join(dir, "dict"),
                    noiseScale: 0.667,
                    noiseScaleW: 0.8,
                    lengthScale: 1.0,
                },
                offlineTtsMatchaModelConfig: {
                    acousticModel: "",
                    vocoder: "",
                    lexicon: "",
                    tokens: "",
                    dataDir: "",
                    dictDir: "",
                    noiseScale: 0.667,
                    lengthScale: 1.0,
                },
                offlineTtsKokoroModelConfig: {
                    model: "",
                    voices: "",
                    tokens: "",
                    dataDir: "",
                    lengthScale: 1.0,
                    dictDir: "",
                    lexicon: "",
                },
                numThreads: 1, // 2 aborts inside the wasm heap on load
                debug: 0,
                provider: "cpu",
            },
            // Text-normalization rules shipped with the model: number.fst
            // reads Arabic digits aloud (without it "500米" is dropped as
            // OOV); new_heteronym.fst fixes Chinese polyphones.
            ruleFsts: ["number.fst", "new_heteronym.fst"]
                .map((f) => path.join(dir, f))
                .filter((f) => existsSync(f))
                .join(","),
            ruleFars: "",
            maxNumSentences: 1,
        });
        return offlineTts;
    } catch (e) {
        engineError = `Failed to initialize sherpa-onnx: ${e}`;
        console.error("NeuralTts:", engineError);
        return null;
    }
}

function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = generationChain.then(task, task);
    generationChain = run.catch(() => {});
    return run;
}

// 16-bit mono PCM WAV wrapper — small enough to pass straight over IPC.
// melo's raw output peaks around 0.10-0.18 (-16 dBFS), far too quiet for
// cab playback: peak-normalize to 0.85, capping the boost so a near-silent
// take can't amplify its noise floor.
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const gain = peak > 0 ? Math.min(0.85 / peak, 6) : 1;

    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20); // format: PCM
    buffer.writeUInt16LE(1, 22); // channels: mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
    buffer.writeUInt16LE(bytesPerSample, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]! * gain));
        buffer.writeInt16LE(
            s < 0 ? s * 0x8000 : s * 0x7fff,
            44 + i * bytesPerSample,
        );
    }

    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    );
}

async function synthesize(
    text: string,
    locale: string,
): Promise<ArrayBuffer | null> {
    if (!SUPPORTED_LOCALES.has(locale)) return null;

    return enqueue(() => {
        const tts = ensureEngine();
        if (!tts) return null;

        try {
            const audio = tts.generate({ text, sid: 0, speed: 1.0 });
            return encodeWav(audio.samples, audio.sampleRate);
        } catch (e) {
            console.error("NeuralTts: synthesis failed:", e);
            return null;
        }
    });
}

/** Wire the neural TTS IPC endpoints; call once during app setup. */
export function registerNeuralTts(): void {
    ipcMain.handle("tts:status", () => modelFilesPresent());
    ipcMain.handle(
        "tts:synthesize",
        (_event, text: unknown, locale: unknown) => {
            if (typeof text !== "string" || typeof locale !== "string") {
                return null;
            }
            return synthesize(text, locale);
        },
    );
}

/**
 * Startup diagnostic: exercises the full chain (addon load → model session
 * → synthesis) in the real runtime and reports to stdout. Launch the app
 * from a terminal to see the result.
 */
export function runNeuralTtsSelfTest(): void {
    if (!modelFilesPresent()) {
        console.log("NeuralTts self-test: model files not present, engine off");
        return;
    }
    const started = Date.now();
    synthesize("语音自检", "zh")
        .then((wav) => {
            if (wav) {
                const seconds = Math.round((wav.byteLength - 44) / 2 / 44100);
                console.log(
                    `NeuralTts self-test: OK in ${Date.now() - started} ms (${seconds.toFixed(2)}s wav, ${wav.byteLength} bytes)`,
                );
            } else {
                console.log(
                    `NeuralTts self-test: FAILED after ${Date.now() - started} ms (null result, see error above)`,
                );
            }
        })
        .catch((e) => {
            console.log(`NeuralTts self-test: FAILED — ${e}`);
        });
}
