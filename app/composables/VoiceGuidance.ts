import type { LocaleCode } from "~/assets/utils/shared/settingsSchema";

// BCP-47 tag per app locale for speech synthesis; falls back to en-US.
const SPEECH_LANGS: Record<LocaleCode, string> = {
    en: "en-US",
    de: "de-DE",
    nl: "nl-NL",
    cs: "cs-CZ",
    sk: "sk-SK",
    ro: "ro-RO",
    ko: "ko-KR",
    zh: "zh-CN",
};

// Locales the bundled neural model can speak; everything else keeps using
// the OS speech voice (the melo model is Chinese + English).
const NEURAL_LOCALES: ReadonlySet<string> = new Set(["zh", "en"]);

// Electron preload bridge, typed loosely like the other renderer access
// points ((window as any).electronAPI elsewhere in the app).
interface ElectronNeuralTts {
    ttsStatus: () => Promise<boolean>;
    ttsSynthesize: (
        text: string,
        locale: string,
    ) => Promise<ArrayBuffer | Uint8Array | null>;
}

const electronTts = (): ElectronNeuralTts | null => {
    if (!import.meta.client) return null;
    const api = (window as any).electronAPI;
    return api?.ttsSynthesize ? (api as ElectronNeuralTts) : null;
};

// Windows/Electron ships one SAPI default voice that may not match the
// spoken language — an English engine reading Chinese stays silent. Pick a
// system voice matching the cue language: exact tag first, then the bare
// language prefix, then the engine default. Voices load asynchronously, so
// refresh the cache whenever the engine reports a change.
let cachedVoice: SpeechSynthesisVoice | null = null;
let cachedVoiceKey = "";

const normalized = (lang: string) => lang.replace("_", "-").toLowerCase();

const pickVoice = (lang: string): SpeechSynthesisVoice | null => {
    if (lang === cachedVoiceKey && cachedVoice) return cachedVoice;

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const want = normalized(lang);
    const matched =
        voices.find((v) => normalized(v.lang) === want) ??
        voices.find((v) =>
            normalized(v.lang).startsWith(`${want.split("-")[0]}-`),
        ) ??
        null;

    cachedVoice = matched;
    cachedVoiceKey = lang;
    return matched;
};

// ===== Neural cue cache: synthesis is slow, cue texts are templated =====
// Object URLs for synthesized WAVs, keyed by "<locale>:<text>", LRU-capped;
// evicted URLs are revoked so the blobs don't pile up.
const NEURAL_CACHE_MAX = 40;
const neuralCache = new Map<string, string>();

const neuralCacheGet = (key: string): string | undefined => {
    const url = neuralCache.get(key);
    if (url !== undefined) {
        // Refresh recency (Map iterates in insertion order).
        neuralCache.delete(key);
        neuralCache.set(key, url);
    }
    return url;
};

const neuralCachePut = (key: string, url: string) => {
    if (neuralCache.size >= NEURAL_CACHE_MAX) {
        const oldest = neuralCache.keys().next().value;
        if (oldest !== undefined) {
            const stale = neuralCache.get(oldest);
            if (stale) URL.revokeObjectURL(stale);
            neuralCache.delete(oldest);
        }
    }
    neuralCache.set(key, url);
};

// One availability probe per page load: the main process reports whether
// the model files are present. A failed synthesize later also disables
// the engine for the session, so a broken setup can't retry-stall cues.
let neuralStatusProbe: Promise<boolean> | null = null;
let neuralDisabled = false;

const neuralAvailable = (): Promise<boolean> => {
    const api = electronTts();
    if (!api) return Promise.resolve(false);
    neuralStatusProbe ??= api.ttsStatus().catch(() => false);
    return neuralStatusProbe;
};

/**
 * Spoken navigation cues. Two engines behind one speak() facade: the
 * offline neural voice (sherpa-onnx via the Electron main process) when
 * available and enabled, otherwise the Web Speech API (zero dependencies,
 * like SoundAlerts). Either way the newest cue wins — the running utterance
 * is cancelled so a burst of announcements can't queue up behind each
 * other, and the Web Speech re-speak is deferred by a tick because some
 * engines (Android WebView, Chrome) drop an utterance started in the same
 * tick as a cancel.
 */
export const useVoiceGuidance = () => {
    const { settings } = useSettings();

    const supported =
        import.meta.client && "speechSynthesis" in window;

    let speakTimer: ReturnType<typeof setTimeout> | null = null;
    let currentAudio: HTMLAudioElement | null = null;
    // Bumped by every speak(): the async neural path checks it before
    // playing, so a slow synthesis can't surface a stale cue after a
    // newer one has taken over.
    let speakToken = 0;

    if (import.meta.client && supported) {
        // Warm the voice list and keep the cache fresh as voices arrive.
        window.speechSynthesis.onvoiceschanged = () => {
            cachedVoice = null;
            cachedVoiceKey = "";
        };
    }

    const clearPendingSpeak = () => {
        if (speakTimer !== null) {
            clearTimeout(speakTimer);
            speakTimer = null;
        }
    };

    const stopAudio = () => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    };

    // Synthesize a cue into the object-URL cache without playing it. Used
    // by speakNeural and by prewarm(); a failed synthesize disables the
    // neural engine for the session (the OS voice takes over).
    const synthToCache = async (
        text: string,
        locale: LocaleCode,
    ): Promise<string | null> => {
        const api = electronTts();
        if (!api) return null;

        const cacheKey = `${locale}:${text}`;
        const cached = neuralCacheGet(cacheKey);
        if (cached) return cached;

        const wav = await api.ttsSynthesize(text, locale).catch(() => null);
        if (!wav) {
            neuralDisabled = true;
            return null;
        }
        // Copy into a plain buffer: IPC may hand back a view, and Blob
        // wants an ArrayBuffer-backed part.
        const url = URL.createObjectURL(
            new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
        );
        neuralCachePut(cacheKey, url);
        return url;
    };

    // Pre-synthesize fixed cues in the background: the WASM engine needs
    // seconds per cue (model load on the very first), so warming them at
    // navigation start keeps the first spoken call instant.
    const prewarm = (texts: string[]) => {
        const locale = settings.value.locale;
        const wantsNeural =
            settings.value.gameplay.voiceNavigation &&
            settings.value.gameplay.voiceNeural &&
            !neuralDisabled &&
            NEURAL_LOCALES.has(locale) &&
            electronTts() !== null;
        if (!wantsNeural) return;

        for (const text of texts) {
            void synthToCache(text, locale).catch(() => {});
        }
    };

    const cancel = () => {
        clearPendingSpeak();
        stopAudio();
        if (!supported) return;
        try {
            window.speechSynthesis.cancel();
        } catch {
            // Speech synthesis unavailable — nothing to cancel.
        }
    };

    const speakSystem = (text: string, lang: string) => {
        if (!supported) return;
        try {
            const synth = window.speechSynthesis;
            synth.cancel();
            clearPendingSpeak();

            speakTimer = setTimeout(() => {
                speakTimer = null;
                try {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = lang;
                    utterance.voice = pickVoice(lang);
                    utterance.rate = 1.05;
                    synth.speak(utterance);
                } catch (e) {
                    console.error("Speech synthesis failed:", e);
                }
            }, 60);
        } catch (e) {
            console.error("Speech synthesis failed:", e);
        }
    };

    const speakNeural = async (text: string, locale: LocaleCode) => {
        const url = await synthToCache(text, locale);
        if (!url) return false;

        const audio = new Audio(url);
        audio.onended = () => {
            if (currentAudio === audio) currentAudio = null;
        };
        currentAudio = audio;
        await audio.play();
        return true;
    };

    const speak = (text: string) => {
        if (!settings.value.gameplay.voiceNavigation) return;
        cancel();

        const locale = settings.value.locale;
        const token = ++speakToken;
        const fallbackSystem = () => {
            if (token === speakToken) {
                speakSystem(text, SPEECH_LANGS[locale] ?? "en-US");
            }
        };
        const wantsNeural =
            settings.value.gameplay.voiceNeural &&
            !neuralDisabled &&
            NEURAL_LOCALES.has(locale) &&
            electronTts() !== null;

        if (wantsNeural) {
            neuralAvailable()
                .then(async (available) => {
                    if (!available || token !== speakToken) return false;
                    try {
                        return await speakNeural(text, locale);
                    } catch (e) {
                        console.error("Neural TTS failed:", e);
                        return false;
                    }
                })
                .then((played) => {
                    if (!played) fallbackSystem();
                })
                .catch(fallbackSystem);
            return;
        }

        speakSystem(text, SPEECH_LANGS[locale] ?? "en-US");
    };

    return { speak, cancel, supported, prewarm };
};
