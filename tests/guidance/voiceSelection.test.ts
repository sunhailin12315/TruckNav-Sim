import { describe, expect, it } from "vitest";
import {
    AUTO_VOICE,
    selectVoiceFrom,
    voicesForLocale,
} from "~/assets/utils/guidance/voiceSelection";

const V = (voiceURI: string, lang: string) => ({
    voiceURI,
    name: voiceURI,
    lang,
});

const VOICES = [
    V("Microsoft David", "en-US"),
    V("Microsoft Hazel Desktop", "en-GB"),
    V("Microsoft Huihui Desktop", "zh-CN"),
    V("Hans", "de-DE"),
];

describe("selectVoiceFrom", () => {
    it("prefers the pinned voiceURI regardless of language", () => {
        expect(
            selectVoiceFrom(VOICES, "zh-CN", "Microsoft Hazel Desktop")
                ?.voiceURI,
        ).toBe("Microsoft Hazel Desktop");
    });

    it("degrades to auto matching when the pinned voice vanished", () => {
        expect(
            selectVoiceFrom(VOICES, "zh-CN", "Removed Voice")?.voiceURI,
        ).toBe("Microsoft Huihui Desktop");
    });

    it("auto matches the exact tag first", () => {
        expect(selectVoiceFrom(VOICES, "zh_CN", AUTO_VOICE)?.voiceURI).toBe(
            "Microsoft Huihui Desktop",
        );
        expect(selectVoiceFrom(VOICES, "en-GB", AUTO_VOICE)?.voiceURI).toBe(
            "Microsoft Hazel Desktop",
        );
    });

    it("auto falls back to the language prefix, then to null", () => {
        // en-US exact exists, but an en-AU request takes the prefix match.
        expect(selectVoiceFrom(VOICES, "en-AU", AUTO_VOICE)?.voiceURI).toBe(
            "Microsoft David",
        );
        expect(selectVoiceFrom(VOICES, "fr-FR", AUTO_VOICE)).toBeNull();
    });

    it("auto with an empty engine list yields null", () => {
        expect(selectVoiceFrom([], "en-US", AUTO_VOICE)).toBeNull();
    });
});

describe("voicesForLocale", () => {
    it("offers the voices whose prefix matches the spoken language", () => {
        expect(
            voicesForLocale(VOICES, "en-US").map((v) => v.voiceURI),
        ).toEqual(["Microsoft David", "Microsoft Hazel Desktop"]);
        expect(
            voicesForLocale(VOICES, "de-DE").map((v) => v.voiceURI),
        ).toEqual(["Hans"]);
    });

    it("falls back to every voice when nothing matches", () => {
        expect(voicesForLocale(VOICES, "fr-FR")).toHaveLength(4);
    });

    it("handles an empty list", () => {
        expect(voicesForLocale([], "en-US")).toEqual([]);
    });
});
