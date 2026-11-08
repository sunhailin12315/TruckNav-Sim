import { describe, expect, it } from "vitest";
import {
    estimateDetourMinutes,
    findNearestPoiAhead,
    findPoisAlongRoute,
    POI_REACH_DEFAULT_KM,
    reachFor,
} from "~/assets/utils/routing/poiAlongRoute";

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
        // The actual POI coordinates and its off-route spur distance are
        // reported too, for the "+X km" detour badge.
        expect(hit!.poiCoords).toEqual([0.05, 0.0005]);
        expect(hit!.detourKm).toBeCloseTo(0.0555, 3);
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

describe("estimateDetourMinutes", () => {
    it("uses the truck's average speed when it is plausible", () => {
        expect(estimateDetourMinutes(2, 80)).toBe(2);
        expect(estimateDetourMinutes(2, 60)).toBe(2);
    });

    it("falls back to 60 km/h when no average speed is known", () => {
        expect(estimateDetourMinutes(1, 0)).toBe(1);
        expect(estimateDetourMinutes(1.2, 0)).toBe(1);
    });

    it("never reports zero minutes", () => {
        expect(estimateDetourMinutes(0.3, 90)).toBe(1);
    });
});

describe("findPoisAlongRoute", () => {
    it("returns every hit sorted by km ahead", () => {
        const { path, cache } = buildPath(101);
        // Two stops at km 700 and km 200; the list leads with the nearer.
        const pois: [number, number][] = [
            [0.07, 0.0002],
            [0.02, 0.0002],
        ];

        const hits = findPoisAlongRoute(path, cache, 0, pois, 1000, 0.1);

        expect(hits.length).toBe(2);
        expect(hits[0]!.kmAhead).toBeCloseTo(200, 6);
        expect(hits[1]!.kmAhead).toBeCloseTo(700, 6);
    });

    it("is exact between the vertices the old scan sampled past", () => {
        // A stop hanging off segment 7→8's middle: the old scan stepped
        // every 10th vertex and could miss here entirely.
        const { path, cache } = buildPath(101);
        const pois: [number, number][] = [[0.0075, 0.0003]];

        const hits = findPoisAlongRoute(path, cache, 0, pois, 1000, 0.1);

        expect(hits.length).toBe(1);
        expect(hits[0]!.kmAhead).toBeGreaterThan(70);
        expect(hits[0]!.kmAhead).toBeLessThan(80);
        expect(hits[0]!.detourKm).toBeCloseTo(0.0333, 3);
    });

    it("skips stops at or behind the truck", () => {
        const { path, cache } = buildPath(101);
        const pois: [number, number][] = [[0.001, 0]];

        expect(
            findPoisAlongRoute(path, cache, 20, pois, 1000, 0.1),
        ).toEqual([]);
    });
});

describe("reachFor", () => {
    it("gives roadside stops a short reach and the rest the town reach", () => {
        expect(reachFor("gas_ico")).toBeLessThan(POI_REACH_DEFAULT_KM);
        expect(reachFor("service_ico")).toBeLessThan(POI_REACH_DEFAULT_KM);
        expect(reachFor("toll_ico")).toBeLessThan(reachFor("gas_ico"));
        expect(reachFor("company_ico")).toBe(POI_REACH_DEFAULT_KM);
        expect(reachFor("whatever")).toBe(POI_REACH_DEFAULT_KM);
    });
});
