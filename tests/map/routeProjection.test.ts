import { describe, expect, it } from "vitest";
import { DEG_PER_GAME_M } from "~/assets/utils/map/converters";
import {
    projectAlongPath,
    snapCoords,
    snapWeightOf,
} from "~/assets/utils/map/routeProjection";

// A straight road running north, one segment per 0.001° of latitude.
const northRoad: [number, number][] = Array.from(
    { length: 11 },
    (_, i) => [10, i * 0.001] as [number, number],
);

// The same road, but segments run south then north again — the route's own
// way back lies right on its way there.
const foldRoad: [number, number][] = [
    [10, 0.004],
    [10, 0.003],
    [10, 0.002],
    [10, 0.001],
    [10, 0.002],
    [10, 0.003],
];

describe("projectAlongPath", () => {
    it("finds the segment the truck is on", () => {
        const p = projectAlongPath(northRoad, 0, 10, [10, 0.0045], 0);
        expect(p!.index).toBe(4);
        expect(p!.at).toEqual([10, 0.0045]);
        expect(p!.distanceDeg).toBe(0);
    });

    it("clamps to the window and honours startSearch", () => {
        const p = projectAlongPath(northRoad, 6, 9, [10, 0.001], 0);
        expect(p!.index).toBe(6);
        expect(p!.distanceDeg).toBeCloseTo(0.005);
    });

    it("skips a segment running against the truck", () => {
        // Truck at the fold, facing north: segment 3→4 runs south (against),
        // segment 4→5 runs north (its way). The north-running one wins even
        // though the south-running one is marginally closer.
        const p = projectAlongPath(foldRoad, 0, 5, [10.0001, 0.002], 0);
        expect(p!.index).toBe(4);
    });

    it("falls back to the raw nearest when nothing runs its way", () => {
        // Facing south on a north-only road (reversing into a dock).
        const p = projectAlongPath(northRoad, 0, 10, [10, 0.0045], 180);
        expect(p!.index).toBe(4);
    });

    it("breaks a tie with the later segment", () => {
        // Truck exactly on the node between segments 3 and 4.
        const p = projectAlongPath(northRoad, 0, 10, [10, 0.003], 0);
        expect(p!.index).toBe(3);
    });

    it("returns null on an empty window", () => {
        expect(projectAlongPath(northRoad, 5, 5, [10, 0.003], 0)).toBeNull();
    });
});

describe("snapWeightOf", () => {
    it("is 1 within 10 game metres and 0 beyond 18", () => {
        expect(snapWeightOf(0)).toBe(1);
        expect(snapWeightOf(10 * DEG_PER_GAME_M)).toBe(1);
        expect(snapWeightOf(18 * DEG_PER_GAME_M)).toBe(0);
        expect(snapWeightOf(50 * DEG_PER_GAME_M)).toBe(0);
    });

    it("eases linearly between the two", () => {
        expect(snapWeightOf(14 * DEG_PER_GAME_M)).toBeCloseTo(0.5);
    });
});

describe("snapCoords", () => {
    it("eases the marker onto the line without jumping", () => {
        const truck: [number, number] = [10.001, 0.003];
        const at: [number, number] = [10, 0.003];
        expect(snapCoords(truck, at, 1)).toEqual(at);
        expect(snapCoords(truck, at, 0)).toEqual(truck);
        const half = snapCoords(truck, at, 0.5);
        expect(half[0]).toBeCloseTo(10.0005);
    });
});
