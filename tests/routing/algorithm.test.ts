import { beforeEach, describe, expect, it } from "vitest";
import {
    calculateRoute,
    getScaleMultiplier,
    mergeClosePoints,
    resetRoutingState,
    simplifyPath,
    smoothPath,
    type WorkerCityArea,
} from "~/assets/utils/routing/algorithm";
import { toRad } from "~/assets/utils/map/maths";

interface TestEdge {
    to: number;
    weight: number;
    hIn: number;
    hOut: number;
    isFerry: number;
    requiredDlc: number;
    vPrefabId: number;
    maneuverType: number;
    exitNumber: number;
    startIndex?: number;
    pointCount?: number;
}

function edge(
    to: number,
    weight: number,
    bearingDeg: number,
    extra: Partial<TestEdge> = {},
): TestEdge {
    const bearing = toRad(bearingDeg);
    return {
        to,
        weight,
        hIn: bearing,
        hOut: bearing,
        isFerry: 0,
        requiredDlc: 0,
        vPrefabId: 0,
        maneuverType: 0,
        exitNumber: 0,
        ...extra,
    };
}

function buildAdjacency(
    entries: [number, TestEdge][],
): Map<number, TestEdge[]> {
    const adjacency = new Map<number, TestEdge[]>();
    for (const [from, e] of entries) {
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from)!.push(e);
    }
    return adjacency;
}

describe("getScaleMultiplier", () => {
    const config = { ruralScale: 19, urbanScale: 3, hasUkRule: true };

    it("returns the rural scale outside cities", () => {
        expect(getScaleMultiplier(100, 100, null, null, config)).toBe(19);
    });

    it("applies the UK rule for south-west Great Britain", () => {
        expect(getScaleMultiplier(-32000, -6000, null, null, config)).toBe(15);
    });

    it("returns the urban scale inside a city area", () => {
        const cities: WorkerCityArea[] = [
            { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
        ];
        expect(getScaleMultiplier(5, 5, cities, null, config)).toBe(3);
    });

    it("UK rule wins only when the point is outside city areas", () => {
        const cities: WorkerCityArea[] = [
            { minX: -33000, maxX: -31000, minZ: -6000, maxZ: -5000 },
        ];
        expect(getScaleMultiplier(-32000, -5500, cities, null, config)).toBe(3);
        expect(getScaleMultiplier(-34000, -6000, cities, null, config)).toBe(15);
    });

    it("ignores the UK rule when disabled", () => {
        const noUk = { ...config, hasUkRule: false };
        expect(getScaleMultiplier(-32000, -6000, null, null, noUk)).toBe(19);
    });

    it("finds areas anywhere in a long list via the spatial grid", () => {
        // 400 disjoint areas spread over the map; only the last one contains
        // the probe point. A regression to a broken bucketing would miss it.
        const cities: WorkerCityArea[] = [];
        for (let i = 0; i < 400; i++) {
            cities.push({
                minX: i * 30000,
                maxX: i * 30000 + 10000,
                minZ: 0,
                maxZ: 10000,
            });
        }

        const probe = 399 * 30000 + 5000;
        expect(getScaleMultiplier(probe, 5000, cities, null, config)).toBe(3);
        expect(getScaleMultiplier(probe + 20000, 5000, cities, null, config)).toBe(19);
    });

    it("handles large negative coordinates across cell boundaries", () => {
        const cities: WorkerCityArea[] = [
            { minX: -60000, maxX: -45000, minZ: -30000, maxZ: -20000 },
        ];
        // Inside (spanning two grid cells diagonally); urban beats the UK rule.
        expect(getScaleMultiplier(-51000, -25000, cities, null, config)).toBe(3);
        expect(getScaleMultiplier(-59000, -29000, cities, null, config)).toBe(3);
        // Outside the area but inside the UK rule zone.
        expect(getScaleMultiplier(-44000, -25000, cities, null, config)).toBe(15);
        // Outside both: rural fallback.
        expect(getScaleMultiplier(-20000, -25000, cities, null, config)).toBe(19);
    });
});

describe("calculateRoute", () => {
    // One algorithm module instance maps exactly one graph; the worker calls
    // resetRoutingState() on INIT_GRAPH, tests mirror that.
    beforeEach(() => {
        resetRoutingState();
    });

    function buildForkGraph() {
        //      B(0,1)---B2(1,1)
        //     /            \
        //  S(0,0)--A(1,0)--T(2,0)
        const nodeCoords = new Map<number, [number, number]>([
            [0, [0, 0]],
            [1, [1, 0]],
            [2, [2, 0]],
            [3, [0, 1]],
            [4, [1, 1]],
        ]);
        const adjacency = buildAdjacency([
            [0, edge(1, 600, 90)], // S -> A (east)
            [1, edge(2, 600, 90)], // A -> T (east)
            [0, edge(3, 600, 0)], // S -> B (north)
            [3, edge(4, 600, 90)], // B -> B2 (east)
            [4, edge(2, 600, 135)], // B2 -> T (south-east)
        ]);
        return { nodeCoords, adjacency };
    }

    it("prefers the road aligned with the truck's heading", () => {
        const { nodeCoords, adjacency } = buildForkGraph();

        const east = calculateRoute(
            0,
            new Set([2]),
            90,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
        );
        expect(east!.nodeSequence).toEqual([0, 1, 2]);

        const north = calculateRoute(
            0,
            new Set([2]),
            0,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
        );
        expect(north!.nodeSequence).toEqual([0, 3, 4, 2]);
    });

    it("falls back to pure weights when no heading is given", () => {
        const { nodeCoords, adjacency } = buildForkGraph();

        const result = calculateRoute(
            0,
            new Set([2]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
        );
        // East fork costs 1200, northern fork 1800.
        expect(result!.nodeSequence).toEqual([0, 1, 2]);
    });

    it("filters edges by owned DLCs", () => {
        const nodeCoords = new Map<number, [number, number]>([
            [0, [0, 0]],
            [1, [1, 0]],
            [2, [0.5, 0.5]],
        ]);
        const adjacency = buildAdjacency([
            [0, edge(1, 100, 90, { requiredDlc: 7 })],
            [0, edge(2, 150, 45)],
            [2, edge(1, 150, 135)],
        ]);

        const withDlc = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [7],
            [1, 0],
        );
        expect(withDlc!.nodeSequence).toEqual([0, 1]);

        const withoutDlc = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [1, 0],
        );
        expect(withoutDlc!.nodeSequence).toEqual([0, 2, 1]);
    });

    it("returns an edge sequence aligned with the node sequence", () => {
        const { nodeCoords, adjacency } = buildForkGraph();

        const result = calculateRoute(
            0,
            new Set([2]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
        );

        expect(result).not.toBeNull();
        const { nodeSequence, edges, endId } = result!;
        expect(edges.length).toBe(nodeSequence.length - 1);
        for (let i = 0; i < edges.length; i++) {
            expect(edges[i]!.to).toBe(nodeSequence[i + 1]);
        }
        expect(endId).toBe(nodeSequence[nodeSequence.length - 1]);
        expect(nodeSequence[0]).toBe(0);
    });

    it("returns null when the destination is unreachable", () => {
        const { nodeCoords, adjacency } = buildForkGraph();
        nodeCoords.set(9, [9, 9]);

        const result = calculateRoute(
            0,
            new Set([9]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [9, 9],
        );
        expect(result).toBeNull();
    });

    it("re-maps cleanly after resetRoutingState (graph reload)", () => {
        resetRoutingState();
        const coordsA = new Map<number, [number, number]>([
            [0, [0, 0]],
            [1, [1, 0]],
            [2, [2, 0]],
        ]);
        const graphA = buildAdjacency([
            [0, edge(1, 100, 90)],
            [1, edge(2, 100, 90)],
        ]);
        const first = calculateRoute(
            0,
            new Set([2]),
            null,
            graphA,
            coordsA,
            "road",
            [],
            [2, 0],
        );
        expect(first!.nodeSequence).toEqual([0, 1, 2]);

        // Different graph with a different node count: without the reset the
        // stale edge-id mapping would corrupt this calculation.
        resetRoutingState();
        const coordsB = new Map<number, [number, number]>([
            [0, [0, 0]],
            [1, [0.5, 1]],
            [2, [1, 0]],
            [3, [2, 0]],
        ]);
        const graphB = buildAdjacency([
            [0, edge(2, 100, 90)],
            [2, edge(3, 100, 90)],
            [0, edge(1, 300, 0)],
            [1, edge(3, 300, 90)],
        ]);
        const second = calculateRoute(
            0,
            new Set([3]),
            null,
            graphB,
            coordsB,
            "road",
            [],
            [2, 0],
        );
        expect(second!.nodeSequence).toEqual([0, 2, 3]);
    });
});

describe("simplifyPath", () => {
    it("collapses collinear points to the endpoints", () => {
        const path: [number, number][] = [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ];
        expect(simplifyPath(path, 0.00003)).toEqual([
            [0, 0],
            [3, 0],
        ]);
    });

    it("keeps the corner of an L-shape", () => {
        const path: [number, number][] = [
            [0, 0],
            [1, 0],
            [1, 1],
        ];
        expect(simplifyPath(path, 0.00003)).toEqual(path);
    });

    it("passes through paths of two points or fewer", () => {
        const two: [number, number][] = [
            [0, 0],
            [1, 1],
        ];
        expect(simplifyPath(two)).toEqual(two);
        expect(simplifyPath([])).toEqual([]);
    });
});

describe("smoothPath", () => {
    it("keeps endpoints and path length", () => {
        const path: [number, number][] = [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ];
        const smoothed = smoothPath(path, 4);

        expect(smoothed.length).toBe(path.length);
        expect(smoothed[0]).toEqual(path[0]);
        expect(smoothed[smoothed.length - 1]).toEqual(path[path.length - 1]);
    });

    it("moves interior points toward the local average", () => {
        const path: [number, number][] = [
            [0, 0],
            [1, 1],
            [2, 0],
        ];
        const [mid] = smoothPath(path, 1).slice(1, 2);

        // 0.25*(0,0) + 0.5*(1,1) + 0.25*(2,0)
        expect(mid![0]).toBeCloseTo(1, 10);
        expect(mid![1]).toBeCloseTo(0.5, 10);
    });
});

describe("mergeClosePoints", () => {
    it("merges points closer than the minimum distance", () => {
        // 0.00005 deg of latitude is ~5.5m, below the 8m default.
        const merged = mergeClosePoints([
            [0, 0],
            [0, 0.00005],
            [0, 0.001],
        ]);
        expect(merged.length).toBe(2);
        expect(merged[0]![1]).toBeCloseTo(0.000025, 8);
    });

    it("keeps points farther apart untouched", () => {
        const merged = mergeClosePoints([
            [0, 0],
            [0, 0.0002],
        ]);
        expect(merged.length).toBe(2);
    });
});
