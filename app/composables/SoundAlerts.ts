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
 * Driver-assist feedback: short square-wave beeps (classic GPS style) plus
 * native vibration on Android/web. Both are gated by the soundAlerts
 * setting, which ships off — sound is the intrusive one.
 */
export function useSoundAlerts() {
    const { settings } = useSettings();

    function playBeep(frequency = 880, durationMs = 180, times = 1) {
        if (!settings.value.gameplay.soundAlerts) return;

        const ctx = ensureAudioContext();
        if (!ctx) return;

        const gap = 0.25;
        for (let i = 0; i < times; i++) {
            const startAt = ctx.currentTime + i * gap;
            const seconds = durationMs / 1000;

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = "square";
            oscillator.frequency.value = frequency;

            gain.gain.setValueAtTime(0.0001, startAt);
            gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

            oscillator.connect(gain).connect(ctx.destination);
            oscillator.start(startAt);
            oscillator.stop(startAt + seconds + 0.05);
        }
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

    return { playBeep, vibrate };
}
