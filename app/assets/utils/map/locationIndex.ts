// Nearest named place from a coordinate, without the per-call full scan.
//
// getGameLocationName runs on the telemetry tick (the next-stop line looks the
// waypoint's place up every packet), and used to walk every city *and* every
// village feature — with a per-city coordinate conversion — to find the
// closest. The entries never move, so they go into a degree-grid index once;
// a lookup then expands ring by ring from the query cell and stops as soon as
// the best hit is closer than the next ring could reach, which is provably the
// same answer the full scan gave.

export interface LocationEntry {
    lng: number;
    lat: number;
    name: string;
    /** Region suffix shown after the name (country token or state). */
    region: string;
}

export interface LocationIndex {
    cellDeg: number;
    cells: Map<string, LocationEntry[]>;
    /** The occupied extent, cell coordinates: bounds the ring expansion. */
    minI: number;
    maxI: number;
    minJ: number;
    maxJ: number;
}

export interface NearestLocation {
    entry: LocationEntry;
    /** Plane degree distance (same metric the index was built in). */
    dist: number;
}

function cellKey(i: number, j: number): string {
    return `${i}|${j}`;
}

export function buildLocationIndex(
    entries: readonly LocationEntry[],
    cellDeg = 0.25,
): LocationIndex {
    const cells = new Map<string, LocationEntry[]>();
    let [minI, maxI, minJ, maxJ] = [Infinity, -Infinity, Infinity, -Infinity];

    for (const entry of entries) {
        const i = Math.floor(entry.lng / cellDeg);
        const j = Math.floor(entry.lat / cellDeg);
        const key = cellKey(i, j);
        const bucket = cells.get(key);
        if (bucket) bucket.push(entry);
        else cells.set(key, [entry]);
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
    }

    return { cellDeg, cells, minI, maxI, minJ, maxJ };
}

/**
 * The nearest indexed entry. Expands one ring of cells at a time and stops
 * when the best distance found is within the ring's guaranteed floor
 * (h · cellDeg): every unscanned point sits further away than that, so the
 * answer matches a full scan. Returns null only for an empty index.
 */
export function nearestLocation(
    index: LocationIndex,
    lng: number,
    lat: number,
): NearestLocation | null {
    const { cellDeg, cells, minI, maxI, minJ, maxJ } = index;
    if (cells.size === 0) return null;

    const ci = Math.floor(lng / cellDeg);
    const cj = Math.floor(lat / cellDeg);

    // The ring at this height surrounds the whole occupied extent from the
    // query's side, so scanning up to it always reaches every entry.
    const coverRing = Math.max(
        ci - minI,
        maxI - ci,
        cj - minJ,
        maxJ - cj,
        0,
    ) + 1;

    let bestEntry: LocationEntry | null = null;
    let bestDist = Infinity;

    // The cells making up ring h, as [i, j] pairs; ring 0 is the query cell.
    function* ring(h: number): Generator<[number, number]> {
        if (h === 0) {
            yield [ci, cj];
            return;
        }
        for (let k = ci - h; k <= ci + h; k++) {
            yield [k, cj - h];
            yield [k, cj + h];
        }
        for (let k = cj - h + 1; k <= cj + h - 1; k++) {
            yield [ci - h, k];
            yield [ci + h, k];
        }
    }

    for (let h = 0; h <= coverRing; h++) {
        for (const [i, j] of ring(h)) {
            const bucket = cells.get(cellKey(i, j));
            if (!bucket) continue;
            for (const entry of bucket) {
                const dx = entry.lng - lng;
                const dy = entry.lat - lat;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestEntry = entry;
                }
            }
        }
        // Any point beyond this ring is at least h cells away, so a hit
        // within the ring's reach is the global nearest.
        if (bestDist <= h * cellDeg) break;
    }

    return bestEntry ? { entry: bestEntry, dist: bestDist } : null;
}
