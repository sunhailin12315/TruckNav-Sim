// The display thread's view of the road graph.
//
// The routing worker owns the full per-edge data (weights, headings,
// ferry/DLC/maneuver flags) and builds its adjacency from the binary graph
// itself. What the map thread still needs locally is far smaller: nearest-
// node lookups, the truck's snap-to-segment search (which asks only "where
// does node u's edge lead"), and node positions for the directions list.
// The old code rebuilt the worker's entire object adjacency here too —
// hundreds of thousands of heap objects, a duplicate graph, and a visible
// freeze at startup. This keeps the same answers in typed arrays: a CSR
// neighbour layout and one stride-2 coordinate buffer, built in three
// allocation-light passes that take milliseconds instead of hundreds.

const EDGE_STRIDE = 12;

export interface GraphIndex {
    /** Distinct nodes seen on any edge. */
    nodeCount: number;
    maxNodeId: number;
    /** lng/lat per node id, stride 2; absent nodes read as (0, 0). */
    coords: Float64Array;
    /** Node u's neighbours live in toFlat[offsets[u] .. offsets[u+1]). */
    offsets: Int32Array;
    toFlat: Int32Array;
}

/**
 * Builds the display index from the raw graph/geometry buffers. graphF32 is
 * the stride-12 edge record: [u, v, weight, hIn, hOut, isFerry, dlc,
 * prefab, startIndex, pointCount, maneuverType, exitNumber]. A node's
 * position is its edge's first point when it appears as u and the last
 * point as v — matching what the old object-graph build stored.
 */
export function buildGraphIndex(
    graphF32: Float32Array,
    geometryF32: Float32Array,
): GraphIndex {
    const edgeCount = Math.floor(graphF32.length / EDGE_STRIDE);

    // Pass 1: id bounds and per-source-node out-degrees.
    let maxId = -1;
    for (let e = 0; e < edgeCount; e++) {
        const u = graphF32[e * EDGE_STRIDE]!;
        const v = graphF32[e * EDGE_STRIDE + 1]!;
        if (u > maxId) maxId = u;
        if (v > maxId) maxId = v;
    }

    const offsets = new Int32Array(maxId + 2);
    for (let e = 0; e < edgeCount; e++) {
        const slot = graphF32[e * EDGE_STRIDE]! + 1;
        offsets[slot] = offsets[slot]! + 1;
    }
    for (let i = 0; i <= maxId; i++) {
        offsets[i + 1] = offsets[i + 1]! + offsets[i]!;
    }

    // Pass 2: scatter neighbour ids into the CSR layout, and take each
    // node's position the first time it shows up.
    const cursor = offsets.slice(0, maxId + 1);
    const toFlat = new Int32Array(offsets[maxId + 1]!);
    const coords = new Float64Array((maxId + 1) * 2);
    const filled = new Uint8Array(maxId + 1);
    let nodeCount = 0;

    for (let e = 0; e < edgeCount; e++) {
        const base = e * EDGE_STRIDE;
        const u = graphF32[base]!;
        const v = graphF32[base + 1]!;
        const startIndex = graphF32[base + 8]!;
        const pointCount = graphF32[base + 9]!;

        const place = cursor[u]!;
        toFlat[place] = v;
        cursor[u] = place + 1;

        if (!filled[u]!) {
            filled[u] = 1;
            coords[u * 2] = geometryF32[startIndex]!;
            coords[u * 2 + 1] = geometryF32[startIndex + 1]!;
            nodeCount++;
        }
        if (!filled[v]!) {
            filled[v] = 1;
            const lastIdx = startIndex + (pointCount - 1) * 2;
            coords[v * 2] = geometryF32[lastIdx]!;
            coords[v * 2 + 1] = geometryF32[lastIdx + 1]!;
            nodeCount++;
        }
    }

    return { nodeCount, maxNodeId: maxId, coords, offsets, toFlat };
}

/** Structural stand-in for `Map<number, number[]>` (edge destinations). */
export class NeighborIndex {
    private index: GraphIndex | null = null;

    adopt(index: GraphIndex | null): void {
        this.index = index;
    }

    get size(): number {
        return this.index?.nodeCount ?? 0;
    }

    /** Node u's edge destinations; empty array for sinks and unknowns. */
    get(u: number): number[] {
        const idx = this.index;
        if (!idx || u < 0 || u > idx.maxNodeId) return [];
        const start = idx.offsets[u]!;
        const end = idx.offsets[u + 1]!;
        if (start === end) return [];
        return Array.prototype.slice.call(idx.toFlat, start, end) as number[];
    }
}

/** Structural stand-in for `Map<number, [number, number]>`. */
export class NodeCoordIndex {
    private index: GraphIndex | null = null;

    adopt(index: GraphIndex | null): void {
        this.index = index;
    }

    get size(): number {
        return this.index?.nodeCount ?? 0;
    }

    get(id: number): [number, number] | undefined {
        const idx = this.index;
        if (!idx || id < 0 || id > idx.maxNodeId) return undefined;
        const lng = idx.coords[id * 2]!;
        const lat = idx.coords[id * 2 + 1]!;
        // Untouched buffer holes read (0, 0) — not a real place; the
        // worker's node-coords map treats them the same way.
        if (lng === 0 && lat === 0) return undefined;
        return [lng, lat];
    }
}
