import { describe, expect, it } from "vitest";
import {
    buildRouteAlternatives,
    summarizeRouteResult,
    type RouteAlternativeSummary,
} from "~/assets/utils/routing/routeAlternatives";

// Two-point stats cache tail: [km, gameHours, realHours].
function makeStats(km: number, gameHours: number) {
    return new Float32Array([0, 0, 0, km, gameHours, 0]);
}

const FLAGS = { avoidTolls: false, avoidFerries: false };

const primary: RouteAlternativeSummary = {
    kind: "primary",
    flags: FLAGS,
    km: 100,
    gameMinutes: 120,
    tollCount: 3,
    ferryCount: 1,
};

describe("summarizeRouteResult", () => {
    it("reads km and game minutes from the stats cache tail", () => {
        expect(
            summarizeRouteResult("primary", FLAGS, makeStats(100, 2), 2, 3, 1),
        ).toEqual({
            kind: "primary",
            flags: FLAGS,
            km: 100,
            gameMinutes: 120,
            tollCount: 3,
            ferryCount: 1,
        });
    });

    it("returns null for an empty path", () => {
        expect(
            summarizeRouteResult(
                "primary",
                FLAGS,
                makeStats(100, 2),
                0,
                0,
                0,
            ),
        ).toBeNull();
    });
});

describe("buildRouteAlternatives", () => {
    it("keeps genuinely different variants", () => {
        const tolls: RouteAlternativeSummary = {
            ...primary,
            kind: "tolls",
            km: 130,
            gameMinutes: 140,
            tollCount: 0,
        };
        const ferries: RouteAlternativeSummary = {
            ...primary,
            kind: "ferries",
            km: 160,
            gameMinutes: 170,
            ferryCount: 0,
        };

        expect(buildRouteAlternatives(primary, [tolls, ferries])).toEqual([
            tolls,
            ferries,
        ]);
    });

    it("drops variants that are the same road as the primary", () => {
        const sameRoad: RouteAlternativeSummary = {
            ...primary,
            kind: "tolls",
            km: 100.2,
        };

        expect(buildRouteAlternatives(primary, [sameRoad])).toEqual([]);
    });

    it("keeps same-distance variants that dodge the gates", () => {
        // Within the 0.5% km epsilon but fewer toll gates: a real detour.
        const detoured: RouteAlternativeSummary = {
            ...primary,
            kind: "tolls",
            km: 100.1,
            tollCount: 0,
        };

        expect(buildRouteAlternatives(primary, [detoured])).toEqual([
            detoured,
        ]);
    });
});
