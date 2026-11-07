import { beforeEach, describe, expect, it } from "vitest";
import {
    buildRouteStatsCache,
    calculateRoute,
    getScaleMultiplier,
    mergeClosePoints,
    resetRoutingState,
    simplifyPath,
    smoothPath,
    type WorkerCityArea,
} from "~/assets/utils/routing/algorithm";
import { toRad } from "~/assets/utils/map/maths";
import { convertEts2ToGeo } from "~/assets/utils/map/converters";

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

    it("penalizes ferry edges when avoidFerries is set", () => {
        resetRoutingState();
        const nodeCoords = new Map<number, [number, number]>([
            [0, [0, 0]], // S
            [1, [2, 0]], // F: destination dock
            [2, [0, 2]], // R
            [3, [2, 2]], // R2
        ]);
        const adjacency = buildAdjacency([
            [0, edge(1, 1000, 90, { isFerry: 1 })], // S -> F ferry crossing
            [0, edge(2, 700, 0)], // S -> R north road detour
            [2, edge(3, 700, 90)], // R -> R2
            [3, edge(1, 700, 180)], // R2 -> F
        ]);

        // Default: the ferry (1000) beats the detour (2100 + turn penalties).
        const withFerry = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
        );
        expect(withFerry!.nodeSequence).toEqual([0, 1]);

        // avoidFerries adds 25 km per ferry edge, so the detour wins.
        const avoiding = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
            true,
        );
        expect(avoiding!.nodeSequence).toEqual([0, 2, 3, 1]);
    });

    it("penalizes edges touching toll nodes when avoidTolls is set", () => {
        resetRoutingState();
        const nodeCoords = new Map<number, [number, number]>([
            [0, [0, 0]], // S
            [1, [2, 0]], // T: destination
            [2, [1, 0.5]], // G: toll gate on the direct road
            [3, [0, 2]], // R
            [4, [2, 2]], // R2
        ]);
        const adjacency = buildAdjacency([
            [0, edge(2, 500, 27)], // S -> G toll road
            [2, edge(1, 500, 333)], // G -> T toll road
            [0, edge(3, 700, 0)], // S -> R detour
            [3, edge(4, 700, 90)], // R -> R2
            [4, edge(1, 700, 180)], // R2 -> T
        ]);

        // Only the gate node is toll-tagged.
        const tollNodes = new Set([2]);

        const avoiding = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
            false,
            true,
            tollNodes,
        );
        expect(avoiding!.nodeSequence).toEqual([0, 3, 4, 1]);

        // Without the flag the cheaper toll road wins.
        const throughToll = calculateRoute(
            0,
            new Set([1]),
            null,
            adjacency,
            nodeCoords,
            "road",
            [],
            [2, 0],
            false,
            false,
            tollNodes,
        );
        expect(throughToll!.nodeSequence).toEqual([0, 2, 1]);
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

describe("buildRouteStatsCache", () => {
    it("marks where the route enters urban areas", () => {
        // A path along game x from 0 to 10000 in 1000-unit steps; a city
        // area covers 4000..6000, so exactly two segments are urban.
        const gamePoints: [number, number][] = [];
        for (let x = 0; x <= 10000; x += 1000) {
            gamePoints.push([x, 0]);
        }
        const path = gamePoints.map(([x, z]) => convertEts2ToGeo(x, z));

        const cities: WorkerCityArea[] = [
            { minX: 4000, maxX: 6000, minZ: -1000, maxZ: 1000 },
        ];

        const { stats, urbanKmMarks } = buildRouteStatsCache(
            path,
            cities,
            "ets2",
            0,
            80,
            { ruralScale: 19, urbanScale: 3, hasUkRule: true },
        );

        // 10 rural segments × 19 km before the first urban segment.
        expect(urbanKmMarks.length).toBe(1);
        expect(urbanKmMarks[0]).toBeCloseTo(76, 3);

        // Rural segments accumulate at 19 km each (scale 19).
        expect(stats[1 * 3]).toBeCloseTo(19, 3);
        // Urban segments accumulate at 3 km each (scale 3).
        expect(stats[6 * 3]).toBeCloseTo(76 + 2 * 3, 3);
    });

    it("returns no marks for a fully rural route", () => {
        const path: [number, number][] = [
            [0, 0],
            [0.001, 0],
            [0.002, 0],
        ];

        const { stats, urbanKmMarks } = buildRouteStatsCache(
            path,
            null,
            "ets2",
            0,
            80,
            { ruralScale: 19, urbanScale: 3, hasUkRule: true },
        );

        expect(urbanKmMarks.length).toBe(0);
        expect(stats[2 * 3]).toBeGreaterThan(0);
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
