import { describe, expect, it } from "vitest";
import {
    buildGraphIndex,
    NeighborIndex,
    NodeCoordIndex,
} from "~/assets/utils/routing/graphIndex";

const STRIDE = 12;

// A small known graph, plus helpers to read it back the way the old
// object-graph build did.
//
//  0 ── 1 ── 3
//  └── 2 ──┘     (ids deliberately skip: 0,1,2,3 with no 4)
// Geometry: edge (u→v) starts at (u+1, u+2)*0.01 and ends at
// (v+1, v+2)*0.01, with a couple of mid points to exercise the
// "as v: last point" rule.
function sampleBuffers() {
    const edges = [
        { u: 0, v: 1, points: 3 },
        { u: 1, v: 3, points: 2 },
        { u: 0, v: 2, points: 2 },
        { u: 2, v: 3, points: 4 },
    ];
    const geometry: number[] = [];
    const graph = new Float32Array(edges.length * STRIDE);

    edges.forEach((e, i) => {
        const startX = (e.u + 1) * 0.01;
        const startLat = (e.u + 2) * 0.01;
        const endX = (e.v + 1) * 0.01;
        const endLat = (e.v + 2) * 0.01;
        // startIndex is a float element index (lng at +p*2, lat at +p*2+1).
        const startIndex = geometry.length;
        for (let p = 0; p < e.points; p++) {
            const t = p / (e.points - 1);
            geometry.push(startX + (endX - startX) * t);
            geometry.push(startLat + (endLat - startLat) * t);
        }
        const base = i * STRIDE;
        graph[base] = e.u;
        graph[base + 1] = e.v;
        graph[base + 8] = startIndex;
        graph[base + 9] = e.points;
    });

    return {
        graphF32: graph,
        geometryF32: new Float32Array(geometry),
    };
}

describe("buildGraphIndex", () => {
    const { graphF32, geometryF32 } = sampleBuffers();
    const index = buildGraphIndex(graphF32, geometryF32);

    it("finds every node and the id bounds", () => {
        expect(index.nodeCount).toBe(4);
        expect(index.maxNodeId).toBe(3);
    });

    it("takes a node's position as u from the edge's first point", () => {
        // Node 0 first appears as u on edge (0→1): (0.01, 0.02).
        expect(index.coords[0]).toBeCloseTo(0.01, 7);
        expect(index.coords[1]).toBeCloseTo(0.02, 7);
    });

    it("takes a node's position as v from the edge's last point", () => {
        // Node 3 only appears as v: last edge (2→3) ends at (0.04, 0.05).
        expect(index.coords[3 * 2]).toBeCloseTo(0.04, 7);
        expect(index.coords[3 * 2 + 1]).toBeCloseTo(0.05, 7);
    });

    it("preserves the old build's first-seen order for repeated nodes", () => {
        // Node 1 is v first (edge 0→1, ends at (0.02, 0.03)) and only later
        // u (edge 1→3, whose start would also be (0.02, 0.03)).
        expect(index.coords[2]).toBeCloseTo(0.02, 7);
        expect(index.coords[3]).toBeCloseTo(0.03, 7);
    });

    it("stores neighbours in edge order per source node", () => {
        const neighbors = new NeighborIndex();
        neighbors.adopt(index);

        expect(neighbors.get(0)).toEqual([1, 2]);
        expect(neighbors.get(1)).toEqual([3]);
        expect(neighbors.get(2)).toEqual([3]);
        // Sink node and out-of-range ids answer like the old guards expected.
        expect(neighbors.get(3)).toEqual([]);
        expect(neighbors.get(99)).toEqual([]);
        expect(neighbors.get(-1)).toEqual([]);
        expect(neighbors.size).toBe(4);
    });

    it("answers coordinates with a copy, undefined for holes", () => {
        const coords = new NodeCoordIndex();
        coords.adopt(index);

        const pos = coords.get(2)!;
        // Float32 geometry: values round-trip through the f32 grid, so the
        // same tolerance as the raw scan applies.
        expect(pos[0]).toBeCloseTo(0.03, 7);
        expect(pos[1]).toBeCloseTo(0.04, 7);
        expect(coords.get(99)).toBeUndefined();
        expect(coords.size).toBe(4);
    });

    it("detaches from the graph on adopt(null)", () => {
        const neighbors = new NeighborIndex();
        neighbors.adopt(index);
        neighbors.adopt(null);
        expect(neighbors.size).toBe(0);
        expect(neighbors.get(0)).toEqual([]);
    });

    it("handles an empty graph", () => {
        const empty = buildGraphIndex(new Float32Array(0), new Float32Array(0));
        expect(empty.nodeCount).toBe(0);
        const coords = new NodeCoordIndex();
        coords.adopt(empty);
        expect(coords.get(0)).toBeUndefined();
    });
});
