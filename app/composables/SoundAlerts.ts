import { beepVoiceFor } from "~/assets/utils/guidance/beepStyles";

let audioContext: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    try {
        audioContext ??= new (window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext!);

        if (audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }

        return audioContext;
    } catch {
        return null;
    }
}

/**
 * Driver-assist feedback: short synthesized beeps (timbre chosen by the
 * beepStyle setting — classic square-wave GPS beep, soft sine, chip blips,
 * or arcade chirp) plus native vibration on Android/web. Alerts are gated
 * by the soundAlerts setting, which ships off; the settings panel previews
 * bypass that gate because the user asked to hear the sound.
 */
export function useSoundAlerts() {
    const { settings } = useSettings();

    function synthesize(
        frequency: number,
        durationMs: number,
        times: number,
    ) {
        const ctx = ensureAudioContext();
        if (!ctx) return;

        const voice = beepVoiceFor(settings.value.gameplay.beepStyle);
        const gap = 0.25;
        // A chip-style hit is two short rising blips sharing the hit's
        // duration, so "2 hits" (fatigue) reads as chip-chip · chip-chip.
        const blips = voice.blipsPerHit;
        const seconds = durationMs / 1000;
        const slice = seconds / blips;

        for (let i = 0; i < times; i++) {
            const hitStart = ctx.currentTime + i * gap;

            for (let b = 0; b < blips; b++) {
                const startAt = hitStart + b * slice;
                const tone = slice * 0.85; // 15 % intra-hit gap
                const baseFreq = frequency * voice.pitchScale;

                // One shared envelope per blip keeps the level predictable
                // whatever the timbre.
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.0001, startAt);
                gain.gain.exponentialRampToValueAtTime(
                    voice.level,
                    startAt + 0.02,
                );
                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    startAt + tone,
                );
                gain.connect(ctx.destination);

                const partials: readonly (readonly [number, number])[] = [
                    [1, 1],
                    ...voice.harmonics,
                ];
                for (const [freqScale, partGain] of partials) {
                    const oscillator = ctx.createOscillator();
                    oscillator.type = voice.type;
                    oscillator.frequency.setValueAtTime(
                        baseFreq * freqScale,
                        startAt,
                    );
                    if (voice.endScale !== 1) {
                        oscillator.frequency.exponentialRampToValueAtTime(
                            baseFreq * freqScale * voice.endScale,
                            startAt + tone,
                        );
                    }

                    const partialGain = ctx.createGain();
                    partialGain.gain.value = partGain;

                    oscillator.connect(partialGain).connect(gain);
                    oscillator.start(startAt);
                    oscillator.stop(startAt + tone + 0.05);
                }
            }
        }
    }

    function playBeep(frequency = 880, durationMs = 180, times = 1) {
        if (!settings.value.gameplay.soundAlerts) return;

        synthesize(frequency, durationMs, times);
    }

    /** One sample beep for the settings UI, regardless of soundAlerts. */
    function previewBeep() {
        synthesize(700, 200, 2);
    }

    function vibrate(pattern: number | number[]) {
        if (!settings.value.gameplay.soundAlerts) return;

        if (
            typeof navigator !== "undefined" &&
            typeof navigator.vibrate === "function"
        ) {
            navigator.vibrate(pattern);
        }
    }

    return { playBeep, previewBeep, vibrate };
}
