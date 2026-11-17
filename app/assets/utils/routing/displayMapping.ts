// Maps route nodes onto the smoothed display path (nearest point per node),
// which feeds the per-node cumulative km and the cue-timing indices shipped
// to the UI.
//
// Node i's match lies on the line somewhere between the previous node's match
// and one road segment further, so each lookup scans only an arc-length window
// anchored at the previous match instead of the whole path — amortized linear
// overall. The previous per-node full-path scan was O(nodes × points): on a
// 1000 km route (~5k nodes over ~20k smoothed points) it cost hundreds of
// millions of comparisons and ran again on every deviation reroute.

interface NodeCoordsReader {
    get(id: number): [number, number] | undefined;
}

// How far behind the previous match a node may legitimately sit (in points):
// route sequences can double back slightly at interchanges and ferries.
const BACKTRACK_PTS = 16;

// The along-path gap to the next node can exceed its straight-line gap on
// serpentine roads; the factor plus a fixed slack keeps the true nearest
// point inside the scan window even there.
const REACH_FACTOR = 4;
const REACH_SLACK_KM = 10;

// Rough degree → km for straight-line gaps; generous on longitude at our
// latitudes, which only widens the window.
const DEG_TO_KM = 111;

function distSq(p: [number, number], lng: number, lat: number): number {
    const dx = p[0] - lng;
    const dy = p[1] - lat;
    return dx * dx + dy * dy;
}

/**
 * Fills `nodeKms` and `nodeDisplayIndices` for every id in `sequence`, using
 * the stride-3 stats cache (cumulative km at offset 0 per display point).
 * Both output arrays must be pre-sized to the sequence length.
 */
export function fillNodeDisplayMapping(
    sequence: ArrayLike<number>,
    nodeCoords: NodeCoordsReader,
    displayPath: [number, number][],
    statsCache: Float32Array,
    nodeKms: Float32Array,
    nodeDisplayIndices: Int32Array,
): void {
    const pathLen = displayPath.length;
    if (pathLen === 0) return;

    // Average points per km of the final line, for turning a km-shaped reach
    // into an index window. Guarded for degenerate paths.
    const totalKm = Math.max(statsCache[(pathLen - 1) * 3]!, 0.01);
    const ptsPerKm = pathLen / totalKm;

    let cursor = 0;
    let prevPos: [number, number] | null = null;

    for (let i = 0; i < sequence.length; i++) {
        const pos = nodeCoords.get(sequence[i]!);
        if (!pos) continue;

        const lng = pos[0];
        const lat = pos[1];

        // Bounds of the scan: never behind the backtrack allowance, never
        // further ahead than the straight-line gap to the previous node,
        // inflated by factor and slack. The first node has no anchor yet, so
        // it pays one full scan of the line.
        const lo = Math.max(0, cursor - BACKTRACK_PTS);
        const hi = prevPos
            ? Math.min(
                  pathLen - 1,
                  cursor +
                      Math.ceil(
                          (Math.sqrt(distSq(prevPos, lng, lat)) *
                              DEG_TO_KM *
                              REACH_FACTOR +
                              REACH_SLACK_KM) *
                              ptsPerKm,
                      ) +
                      BACKTRACK_PTS,
              )
            : pathLen - 1;

        // Global nearest within the window, earliest index on ties — same
        // choice the full-path scan made.
        let bestIdx = lo;
        let minDistSq = distSq(displayPath[lo]!, lng, lat);
        for (let j = lo + 1; j <= hi; j++) {
            const dSq = distSq(displayPath[j]!, lng, lat);
            if (dSq < minDistSq) {
                minDistSq = dSq;
                bestIdx = j;
            }
        }

        cursor = bestIdx;
        prevPos = pos;
        nodeKms[i] = statsCache[bestIdx * 3]!;
        nodeDisplayIndices[i] = bestIdx;
    }
}
