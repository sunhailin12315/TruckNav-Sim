import { describe, expect, it } from "vitest";
import { findNearestPoiAhead } from "~/assets/utils/routing/poiAlongRoute";

// Straight west-east line, 10 km per point.
function buildPath(points: number) {
    const path: [number, number][] = [];
    for (let i = 0; i < points; i++) {
        path.push([i * 0.001, 0]);
    }
    const cache = new Float32Array(points * 3);
    for (let i = 0; i < points; i++) {
        cache[i * 3] = i * 10;
    }
    return { path, cache };
}

describe("findNearestPoiAhead", () => {
    it("finds the first POI within the detour allowance ahead", () => {
        const { path, cache } = buildPath(101);
        // A service area ~55 m off the path at km 500 (index 50); with a
        // 0.1 km detour allowance it only becomes reachable there.
        const pois: [number, number][] = [[0.05, 0.0005]];

        const hit = findNearestPoiAhead(path, cache, 0, pois, 1000, 0.1);

        expect(hit).not.toBeNull();
        expect(hit!.kmAhead).toBe(500);
        expect(hit!.coords[0]).toBeCloseTo(0.05, 6);
    });

    it("skips POIs beyond the search horizon", () => {
        const { path, cache } = buildPath(101);
        const pois: [number, number][] = [[0.06, 0]]; // km 600

        expect(
            findNearestPoiAhead(path, cache, 0, pois, 500, 0.1),
        ).toBeNull();
        expect(
            findNearestPoiAhead(path, cache, 0, pois, 1000, 0.1),
        ).not.toBeNull();
    });

    it("ignores POIs farther than the detour allowance", () => {
        const { path, cache } = buildPath(101);
        // 0.02 deg of latitude is ~2.2 km off the path.
        const pois: [number, number][] = [[0.05, 0.02]];

        expect(
            findNearestPoiAhead(path, cache, 0, pois, 1000, 1),
        ).toBeNull();
    });

    it("ignores POIs behind the search start", () => {
        const { path, cache } = buildPath(101);
        const pois: [number, number][] = [[0.01, 0]]; // km 100

        expect(
            findNearestPoiAhead(path, cache, 50, pois, 1000, 1),
        ).toBeNull();
    });

    it("returns null on empty inputs or invalid indices", () => {
        const { path, cache } = buildPath(101);

        expect(findNearestPoiAhead(path, cache, 0, [], 100, 1)).toBeNull();
        expect(
            findNearestPoiAhead(path, cache, path.length - 1, [[0.5, 0]], 100, 1),
        ).toBeNull();
        expect(findNearestPoiAhead([], cache, 0, [[0.5, 0]], 100, 1)).toBeNull();
    });
});
