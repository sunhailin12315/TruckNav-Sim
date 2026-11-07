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

/**
 * Spoken navigation cues via the Web Speech API (zero dependencies, like
 * SoundAlerts). The newest cue wins: speech synthesis is cancelled before
 * each speak so a burst of announcements can't queue up behind each other.
 */
export const useVoiceGuidance = () => {
    const { settings } = useSettings();
    const { t } = useTranslations();

    const supported =
        import.meta.client && "speechSynthesis" in window;

    const speak = (text: string) => {
        if (!supported || !settings.value.gameplay.voiceNavigation) return;

        try {
            const synth = window.speechSynthesis;
            synth.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang =
                SPEECH_LANGS[settings.value.locale] ?? "en-US";
            utterance.rate = 1.05;
            synth.speak(utterance);
        } catch (e) {
            console.error("Speech synthesis failed:", e);
        }
    };

    const cancel = () => {
        if (!supported) return;
        try {
            window.speechSynthesis.cancel();
        } catch {
            // Speech synthesis unavailable — nothing to cancel.
        }
    };

    return { speak, cancel, supported };
};
