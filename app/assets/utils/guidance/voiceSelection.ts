import { AUTO_VOICE } from "~/assets/utils/shared/settingsSchema";

export { AUTO_VOICE };

/** The subset of SpeechSynthesisVoice these helpers need. */
export interface SpeechVoiceLike {
    voiceURI: string;
    name: string;
    lang: string;
}

const normalized = (lang: string) => lang.replace("_", "-").toLowerCase();

/**
 * Resolves the voice for a cue: the explicitly chosen voiceURI wins, then
 * an exact tag match for the spoken language, then its bare language
 * prefix, then null (the engine's own default). A chosen voice that no
 * longer exists (OS voice pack removed, locale switched) degrades to the
 * automatic path instead of going silent.
 */
export function selectVoiceFrom<T extends SpeechVoiceLike>(
    voices: readonly T[],
    lang: string,
    wantedUri: string,
): T | null {
    if (wantedUri !== AUTO_VOICE) {
        const picked = voices.find((v) => v.voiceURI === wantedUri);
        if (picked) return picked;
    }

    const want = normalized(lang);
    return (
        voices.find((v) => normalized(v.lang) === want) ??
        voices.find((v) =>
            normalized(v.lang).startsWith(`${want.split("-")[0]}-`),
        ) ??
        null
    );
}

/**
 * The voices worth offering for a spoken language: everything whose
 * language prefix matches (a mismatched engine reads the cue silently —
 * see the note in VoiceGuidance), falling back to the full list when the
 * system has none for this language so the picker is never empty.
 */
export function voicesForLocale<T extends SpeechVoiceLike>(
    voices: readonly T[],
    lang: string,
): T[] {
    const want = normalized(lang).split("-")[0]!;
    const matching = voices.filter((v) =>
        normalized(v.lang).startsWith(want),
    );
    return matching.length > 0 ? matching : [...voices];
}
