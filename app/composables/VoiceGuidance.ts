import type { LocaleCode } from "~/assets/utils/shared/settingsSchema";
import {
    AUTO_VOICE,
    selectVoiceFrom,
    voicesForLocale,
} from "~/assets/utils/guidance/voiceSelection";
import { applyPronunciationFixes } from "~/assets/utils/guidance/pronunciation";

// BCP-47 tag per app locale for speech synthesis; falls back to en-US.
const SPEECH_LANGS: Record<LocaleCode, string> = {
    en: "en-US",
    de: "de-DE",
    nl: "nl-NL",
    cs: "cs-CZ",
    sk: "sk-SK",
    ro: "ro-RO",
    fr: "fr-FR",
    ru: "ru-RU",
    ko: "ko-KR",
    zh: "zh-CN",
};

// Locales the bundled offline neural model can speak; everything else keeps
// using the cloud or OS voice (the melo model is Chinese + English).
const NEURAL_LOCALES: ReadonlySet<string> = new Set(["zh", "en"]);

// Live cues must never hang on the network: a cloud synthesis slower than
// this loses the race to the offline engines. The result still lands in the
// cache, so a slow cue becomes an instant one the next time.
const CLOUD_GRACE_MS = 5000;

// Electron preload bridge, typed loosely like the other renderer access
// points ((window as any).electronAPI elsewhere in the app).
interface CloudAudioPayload {
    kind: "mp3";
    bytes: ArrayBuffer | Uint8Array;
}
interface ElectronNeuralTts {
    ttsStatus: () => Promise<boolean>;
    ttsSynthesize: (
        text: string,
        locale: string,
    ) => Promise<ArrayBuffer | Uint8Array | null>;
    ttsCloudSynthesize?: (
        text: string,
        locale: string,
    ) => Promise<CloudAudioPayload | null>;
}

const electronTts = (): ElectronNeuralTts | null => {
    if (!import.meta.client) return null;
    const api = (window as any).electronAPI;
    return api?.ttsSynthesize ? (api as ElectronNeuralTts) : null;
};

// Windows/Electron ships one SAPI default voice that may not match the
// spoken language — an English engine reading Chinese stays silent. The
// user can pin a voice (voiceName setting); otherwise pick a system voice
// matching the cue language: exact tag first, then the bare language
// prefix, then the engine default. Voices load asynchronously, so refresh
// the cache whenever the engine reports a change.
let cachedVoice: SpeechSynthesisVoice | null = null;
let cachedVoiceKey = "";

const pickVoice = (lang: string, wantedUri: string): SpeechSynthesisVoice | null => {
    const cacheKey = `${lang}|${wantedUri}`;
    if (cacheKey === cachedVoiceKey && cachedVoice) return cachedVoice;

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    cachedVoice = selectVoiceFrom(voices, lang, wantedUri);
    cachedVoiceKey = cacheKey;
    return cachedVoice;
};

// Reactive voice list for the settings picker: the engine fills it late
// (voiceschanged), so it's a ref refreshed on every change event plus the
// first read attempt.
const voiceList = ref<SpeechSynthesisVoice[]>([]);

const refreshVoiceList = () => {
    if (!import.meta.client || !("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) voiceList.value = [...voices];
};

// ===== Cue audio cache: synthesis is slow, cue texts are templated =====
// Object URLs for synthesized audio, keyed by "<engine>|<locale>|<fixed
// text>" (the fix table can make two cues share a pronunciation form; two
// engines never share one URL), LRU-capped; evicted URLs are revoked so
// the blobs don't pile up.
const NEURAL_CACHE_MAX = 60;
const cueCache = new Map<string, string>();

const cueCacheGet = (key: string): string | undefined => {
    const url = cueCache.get(key);
    if (url !== undefined) {
        // Refresh recency (Map iterates in insertion order).
        cueCache.delete(key);
        cueCache.set(key, url);
    }
    return url;
};

const cueCachePut = (key: string, url: string) => {
    if (cueCache.size >= NEURAL_CACHE_MAX) {
        const oldest = cueCache.keys().next().value;
        if (oldest !== undefined) {
            const stale = cueCache.get(oldest);
            if (stale) URL.revokeObjectURL(stale);
            cueCache.delete(oldest);
        }
    }
    cueCache.set(key, url);
};

// In-flight syntheses per cache key, so a live cue arriving while
// prewarm is still filling the same entry joins it instead of doubling
// the request.
const inflight = new Map<string, Promise<string | null>>();

const toUrl = (
    bytes: ArrayBuffer | Uint8Array,
    mime: string,
): string | null => {
    try {
        // Copy into a plain buffer: IPC may hand back a view, and Blob
        // wants an ArrayBuffer-backed part.
        return URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: mime }),
        );
    } catch {
        return null;
    }
};

// One availability probe per page load: the main process reports whether
// the model files are present. A failed synthesize later also disables
// the engine for the session, so a broken setup can't retry-stall cues.
let neuralStatusProbe: Promise<boolean> | null = null;
let neuralDisabled = false;
let cloudDisabled = false;

const neuralAvailable = (): Promise<boolean> => {
    const api = electronTts();
    if (!api) return Promise.resolve(false);
    neuralStatusProbe ??= api.ttsStatus().catch(() => false);
    return neuralStatusProbe;
};

const cachedOr = (
    cacheKey: string,
    synthesize: () => Promise<string | null>,
): Promise<string | null> => {
    const cached = cueCacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    const running = inflight.get(cacheKey);
    if (running) return running;

    const task = synthesize()
        .then((url) => {
            if (url) cueCachePut(cacheKey, url);
            return url;
        })
        .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, task);
    return task;
};

/**
 * Spoken navigation cues. Three engines behind one speak() facade, best
 * voice first: the online HD neural voice (Edge Read Aloud via the main
 * process, disk-cached so each cue text costs one round trip ever), then
 * the offline neural model (sherpa-onnx), then the Web Speech API (zero
 * dependencies, like SoundAlerts). Either way the newest cue wins — the
 * running utterance is cancelled so a burst of announcements can't queue
 * up behind each other, and the Web Speech re-speak is deferred by a tick
 * because some engines (Android WebView, Chrome) drop an utterance
 * started in the same tick as a cancel.
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
        // Warm the voice list and keep the cache + the settings picker's
        // options fresh as voices arrive.
        window.speechSynthesis.onvoiceschanged = () => {
            cachedVoice = null;
            cachedVoiceKey = "";
            refreshVoiceList();
        };
        refreshVoiceList();
    }

    const clearPendingSpeak = () => {
        if (speakTimer !== null) {
            clearTimeout(speakTimer);
            speakTimer = null;
        }
    };

    // Voices worth offering for the app locale right now (language prefix
    // match, or everything when the system has none) — for the picker.
    const localeVoices = computed(() => {
        const locale = settings.value.locale;
        return voicesForLocale(
            voiceList.value,
            SPEECH_LANGS[locale] ?? "en-US",
        );
    });

    const stopAudio = () => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    };

    // Synthesize one cue into the cache via the cloud voice; a null or
    // failed result disables the cloud path for the session (the offline
    // engines take over). Deliberately never rejects.
    const primeCloud = (fixed: string, locale: LocaleCode): Promise<string | null> =>
        cachedOr(`c|${locale}|${fixed}`, async () => {
            const api = electronTts();
            if (!api?.ttsCloudSynthesize) return null;
            const audio = await api
                .ttsCloudSynthesize(fixed, locale)
                .catch(() => null);
            if (!audio) {
                cloudDisabled = true;
                return null;
            }
            const url = toUrl(audio.bytes, "audio/mpeg");
            if (!url) cloudDisabled = true;
            return url;
        });

    // The offline sherpa path; a failed synthesize disables the engine for
    // the session (the OS voice takes over), same contract as before.
    const primeLocal = (fixed: string, locale: LocaleCode): Promise<string | null> =>
        cachedOr(`n|${locale}|${fixed}`, async () => {
            const api = electronTts();
            if (!api) return null;
            const wav = await api.ttsSynthesize(fixed, locale).catch(() => null);
            if (!wav) {
                neuralDisabled = true;
                return null;
            }
            return toUrl(wav, "audio/wav");
        });

    // Resolve a cue to a playable object URL through the enabled neural
    // engines, cloud first. cloudGraceMs bounds only the cloud hop — a
    // timed-out request keeps running and fills the cache for later, but
    // the offline engines answer now. Returns null when nothing can play.
    const primeCue = async (
        text: string,
        locale: LocaleCode,
        cloudGraceMs: number | null,
    ): Promise<string | null> => {
        const fixed = applyPronunciationFixes(text, locale);

        if (
            settings.value.gameplay.voiceCloud &&
            !cloudDisabled &&
            electronTts()?.ttsCloudSynthesize
        ) {
            const attempt = primeCloud(fixed, locale);
            const url =
                cloudGraceMs === null
                    ? await attempt
                    : await new Promise<string | null>((resolve) => {
                          let settled = false;
                          const timer = setTimeout(() => {
                              settled = true;
                              resolve(null);
                          }, cloudGraceMs);
                          attempt.then((u) => {
                              if (settled) return;
                              settled = true;
                              clearTimeout(timer);
                              resolve(u);
                          });
                      });
            if (url) return url;
        }

        if (
            NEURAL_LOCALES.has(locale) &&
            !neuralDisabled &&
            (await neuralAvailable())
        ) {
            return await primeLocal(fixed, locale);
        }
        return null;
    };

    // Pre-synthesize fixed cues in the background with no deadline: the
    // offline WASM engine needs seconds per cue (model load on the very
    // first), so warming them at navigation start keeps the first spoken
    // call instant. Cloud cues warm the on-disk cache across launches.
    const prewarm = (texts: string[]) => {
        const locale = settings.value.locale;
        const wantsNeural =
            settings.value.gameplay.voiceNavigation &&
            settings.value.gameplay.voiceNeural &&
            settings.value.gameplay.voiceName === AUTO_VOICE &&
            electronTts() !== null;
        if (!wantsNeural) return;

        for (const text of texts) {
            void primeCue(text, locale, null).catch(() => {});
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
                    utterance.voice = pickVoice(
                        lang,
                        settings.value.gameplay.voiceName,
                    );
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

    const speakNeural = async (
        text: string,
        locale: LocaleCode,
        token: number,
    ): Promise<boolean> => {
        const url = await primeCue(text, locale, CLOUD_GRACE_MS);
        if (!url || token !== speakToken) return false;

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
                // The OS engine gets the raw text: system voices use proper
                // dictionaries and the fix table is for the neural models.
                speakSystem(text, SPEECH_LANGS[locale] ?? "en-US");
            }
        };
        // A pinned voice outranks the neural engines: what the user picked
        // is what they want to hear, neural or not.
        const wantsNeural =
            settings.value.gameplay.voiceNeural &&
            settings.value.gameplay.voiceName === AUTO_VOICE &&
            electronTts() !== null;

        if (wantsNeural) {
            speakNeural(text, locale, token)
                .then((played) => {
                    if (!played) fallbackSystem();
                })
                .catch((e) => {
                    console.error("Neural TTS failed:", e);
                    fallbackSystem();
                });
            return;
        }

        speakSystem(text, SPEECH_LANGS[locale] ?? "en-US");
    };

    /** Speak one sample cue for the settings UI, regardless of the
     * voiceNavigation toggle — the user clicked to hear the voice. The
     * system engine path previews the *selected* voice directly (pinned or
     * auto-matched), which is exactly what the picker is demonstrating. */
    const previewVoice = (text: string) => {
        cancel();
        speakToken++;
        const locale = settings.value.locale;
        speakSystem(text, SPEECH_LANGS[locale] ?? "en-US");
    };

    return {
        speak,
        cancel,
        supported,
        prewarm,
        previewVoice,
        availableVoices: voiceList,
        localeVoices,
    };
};
