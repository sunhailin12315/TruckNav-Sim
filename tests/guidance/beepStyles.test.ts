import { describe, expect, it } from "vitest";
import { BEEP_STYLES } from "~/assets/utils/shared/settingsSchema";
import { beepVoiceFor } from "~/assets/utils/guidance/beepStyles";

describe("beepVoiceFor", () => {
    it("resolves every shipped style id", () => {
        for (const style of BEEP_STYLES) {
            const voice = beepVoiceFor(style);
            expect(voice.type).toBeTruthy();
            expect(voice.pitchScale).toBeGreaterThan(0);
            expect(voice.level).toBeGreaterThan(0);
            expect(voice.level).toBeLessThanOrEqual(0.2);
            expect(voice.blipsPerHit).toBeGreaterThanOrEqual(1);
        }
    });

    it("classic keeps the original square-wave one-shot", () => {
        const voice = beepVoiceFor("classic");
        expect(voice).toMatchObject({
            type: "square",
            pitchScale: 1,
            harmonics: [],
            endScale: 1,
            blipsPerHit: 1,
            level: 0.12,
        });
    });

    it("chip splits each hit into sliding blips", () => {
        const voice = beepVoiceFor("chip");
        expect(voice.blipsPerHit).toBe(2);
        expect(voice.endScale).not.toBe(1);
    });

    it("keeps the styles audibly distinct", () => {
        const voices = BEEP_STYLES.map(beepVoiceFor);
        const signatures = voices.map(
            (v) => `${v.type}:${v.pitchScale}:${v.harmonics.length}:${v.endScale}:${v.blipsPerHit}`,
        );
        expect(new Set(signatures).size).toBe(BEEP_STYLES.length);
    });

    it("falls back to classic on unknown or corrupt ids", () => {
        for (const junk of [undefined, null, "synthwave", 42, {}, ""]) {
            expect(beepVoiceFor(junk)).toEqual(beepVoiceFor("classic"));
        }
    });
});
