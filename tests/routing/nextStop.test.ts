import { describe, expect, it } from "vitest";
import { nextStopKm } from "~/assets/utils/routing/nextStop";

describe("nextStopKm", () => {
    it("picks the first stop still ahead and shares the remaining time by distance", () => {
        // Stops at km 120 and km 300; the truck is at km 100 of 400 left,
        // 300 minutes remaining. The km-120 stop gets 300 × 20/400.
        const stop = nextStopKm([120, 300], 100, 400, 300);

        expect(stop!.index).toBe(0);
        expect(stop!.distanceKm).toBe(20);
        expect(stop!.minutes).toBeCloseTo(15);
    });

    it("moves on to the following stop once one is reached", () => {
        const stop = nextStopKm([120, 300], 120, 280, 240);
        expect(stop!.index).toBe(1);
        expect(stop!.distanceKm).toBe(180);
        expect(stop!.minutes).toBeCloseTo(240 * (180 / 280));
    });

    it("is null without stops ahead, or without a route left", () => {
        expect(nextStopKm([120], 200, 100, 60)).toBeNull();
        expect(nextStopKm([120], 0, 0, 60)).toBeNull();
        expect(nextStopKm([], 0, 100, 60)).toBeNull();
        expect(nextStopKm([120], 0, 400, 0)).toBeNull();
    });
});
