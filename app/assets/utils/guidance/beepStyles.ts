import type { BeepStyle } from "~/assets/utils/shared/settingsSchema";

// Beep timbre presets for the driver-assist alerts, resolved from the
// beepStyle setting. Like voiceAnnouncements.ts this is pure and testable:
// it only describes *what* to synthesize; SoundAlerts owns the
// AudioContext and the envelope plumbing.

export interface BeepVoice {
    /** Web Audio oscillator shape for the alert's fundamental. */
    type: OscillatorType;
    /** Multiplier on the caller's frequency; keeps per-alert pitch order. */
    pitchScale: number;
    /**
     * Extra partials layered over the fundamental, as [frequency multiplier,
     * gain] pairs. Empty keeps the plain single-oscillator path; their gains
     * are fractions of the peak level, so overall loudness stays bounded.
     */
    harmonics: readonly (readonly [number, number])[];
    /**
     * Optional pitch slide over one tone, as a frequency multiplier at the
     * tone's end (1 = no slide). Gives the chip blips their movement.
     */
    endScale: number;
    /**
     * How many tones one alert hit splits into, with each tone's duration
     * scaled to the slice (1 = the hit stays one tone). >1 with a slide
     * reads as "beep-beep" chirps per hit.
     */
    blipsPerHit: number;
    /** Peak gain of the shared envelope. */
    level: number;
}

const BEEP_VOICES: Record<BeepStyle, BeepVoice> = {
    // Classic GPS: the raw square-wave beep the alerts shipped with.
    classic: {
        type: "square",
        pitchScale: 1,
        harmonics: [],
        endScale: 1,
        blipsPerHit: 1,
        level: 0.12,
    },
    // Sine with a low fifth underneath: round and unobtrusive.
    soft: {
        type: "sine",
        pitchScale: 0.9,
        harmonics: [[1.5, 0.35]],
        endScale: 1,
        blipsPerHit: 1,
        level: 0.16,
    },
    // Two sliding blips per hit: the "chip-chip" console style.
    chip: {
        type: "triangle",
        pitchScale: 1.1,
        harmonics: [],
        endScale: 1.5,
        blipsPerHit: 2,
        level: 0.14,
    },
    // Square fundamental with an octave+fifth shimmer: arcade brightness.
    chirp: {
        type: "square",
        pitchScale: 1,
        harmonics: [[2, 0.25], [3, 0.1]],
        endScale: 1,
        blipsPerHit: 1,
        level: 0.1,
    },
};

/**
 * Resolves a stored (or corrupt) style id to its voice, defaulting to the
 * classic square wave. Unknown ids fall back instead of throwing so a bad
 * settings blob can never silence or crash the alerts.
 */
export function beepVoiceFor(style: unknown): BeepVoice {
    return BEEP_VOICES[style as BeepStyle] ?? BEEP_VOICES.classic;
}
