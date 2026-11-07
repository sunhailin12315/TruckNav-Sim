import { describe, expect, it } from "vitest";
import {
    pickTurnAnnouncement,
    TURN_ANNOUNCEMENT_THRESHOLDS_KM,
} from "~/assets/utils/guidance/voiceAnnouncements";

describe("pickTurnAnnouncement", () => {
    it("fires the far threshold when crossed from above", () => {
        expect(pickTurnAnnouncement(2.1, 1.9, [], false)).toBe(2);
    });

    it("fires the near threshold after the far one was spoken", () => {
        expect(pickTurnAnnouncement(0.6, 0.4, [2], false)).toBe(0.5);
    });

    it("never repeats a threshold for the same turn", () => {
        expect(pickTurnAnnouncement(2.5, 1.5, [2], false)).toBeNull();
        expect(pickTurnAnnouncement(0.6, 0.3, [2, 0.5], false)).toBeNull();
    });

    it("does nothing while the distance has not crossed a mark", () => {
        expect(pickTurnAnnouncement(3, 2.5, [], false)).toBeNull();
        expect(pickTurnAnnouncement(0.4, 0.2, [], false)).toBeNull();
    });

    it("concise mode only uses the nearest mark", () => {
        expect(pickTurnAnnouncement(2.1, 1.9, [], true)).toBeNull();
        expect(pickTurnAnnouncement(0.6, 0.4, [], true)).toBe(0.5);
        expect(TURN_ANNOUNCEMENT_THRESHOLDS_KM).toEqual([2, 0.5]);
    });

    it("still fires once in concise mode after the mark was spoken elsewhere", () => {
        expect(pickTurnAnnouncement(0.6, 0.4, [2], true)).toBe(0.5);
    });
});
