import { describe, expect, it } from "vitest";
import {
    CONCISE_TURN_ANNOUNCEMENT_KM,
    pickTurnAnnouncement,
    TURN_ANNOUNCEMENT_THRESHOLDS_KM,
} from "~/assets/utils/guidance/voiceAnnouncements";

describe("pickTurnAnnouncement", () => {
    it("fires the far threshold when crossed from above", () => {
        expect(pickTurnAnnouncement(5.2, 4.8, [], false)).toBe(5);
    });

    it("fires the middle threshold after the far one was spoken", () => {
        expect(pickTurnAnnouncement(3.2, 2.8, [5], false)).toBe(3);
    });

    it("fires the near threshold after the middle one was spoken", () => {
        expect(pickTurnAnnouncement(1.2, 0.9, [5, 3], false)).toBe(1);
    });

    it("skips intermediate marks crossed in one sample", () => {
        // One update step can cross 3 and 1 together (low telemetry rate):
        // the farthest just-crossed mark fires, the other is not replayed.
        expect(pickTurnAnnouncement(3.4, 0.8, [5], false)).toBe(3);
        expect(pickTurnAnnouncement(0.8, 0.4, [5, 3], false)).toBeNull();
    });

    it("never repeats a threshold for the same turn", () => {
        expect(pickTurnAnnouncement(5.5, 4.5, [5], false)).toBeNull();
        expect(pickTurnAnnouncement(3.1, 2.9, [5, 3], false)).toBeNull();
        expect(
            pickTurnAnnouncement(1.1, 0.9, [5, 3, 1], false),
        ).toBeNull();
    });

    it("does nothing while the distance has not crossed a mark", () => {
        expect(pickTurnAnnouncement(6.5, 5.1, [], false)).toBeNull();
        expect(pickTurnAnnouncement(2.5, 1.5, [], false)).toBeNull();
        expect(pickTurnAnnouncement(0.8, 0.4, [], false)).toBeNull();
        expect(pickTurnAnnouncement(0.05, 0.02, [1], false)).toBeNull();
    });

    it("concise mode only uses the concise mark", () => {
        expect(pickTurnAnnouncement(5.1, 4.9, [], true)).toBeNull();
        expect(pickTurnAnnouncement(1.2, 0.9, [], true)).toBeNull();
        expect(pickTurnAnnouncement(0.6, 0.45, [], true)).toBe(0.5);
        expect(TURN_ANNOUNCEMENT_THRESHOLDS_KM).toEqual([5, 3, 1]);
        expect(CONCISE_TURN_ANNOUNCEMENT_KM).toEqual([0.5]);
    });

    it("still fires once in concise mode after a detailed mark was spoken", () => {
        expect(pickTurnAnnouncement(0.6, 0.45, [5, 3], true)).toBe(0.5);
    });
});
