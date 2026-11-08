// Finds POIs reachable from the route ahead. Pure and map-agnostic: the
// caller feeds in POI points (e.g. queried from the spritelocations PMTiles
// layer) and the active route path + km cache.
//
// The forward slice of the route is indexed once per (path, start, horizon)
// into ~1 km grid cells (WestPlay alongRoute.ts's way,
// docs/westplay-reference-study.md §2.4), so each POI costs a handful of
// cell lookups instead of a walk over the whole path — and the nearest
// projection is exact (the old scan sampled every 10th vertex and could
// miss between samples). Hits come back sorted by km ahead.

export interface PoiHit {
    coords: [number, number];
    /** Actual POI coordinates — where a marker or bubble should sit. */
    poiCoords: [number, number];
    /** Distance from the search start, in route km. */
    kmAhead: number;
    /** Off-route spur distance from the route to the POI, in km. */
    detourKm: number;
}

/** The sprite kinds' reach: how far off the route a stop of each kind may
 * sit (route km). Roadside stops (filling stations, rest areas, toll gates)
 * sit beside the road; everything else (companies, dealers) may be a town
 * away. */
const POI_REACH_KM: Record<string, number> = {
    gas_ico: 1,
    service_ico: 1,
    toll_ico: 0.3,
};

/** The reach of kinds without an entry of their own. */
export const POI_REACH_DEFAULT_KM = 3;

/** How far off the route a POI of this sprite kind may sit. */
export function reachFor(sprite: string): number {
    return POI_REACH_KM[sprite] ?? POI_REACH_DEFAULT_KM;
}

/** How many route km one degree is, by the fast metric below. */
const KM_PER_DEG_LAT = 111.0;
const KM_PER_DEG_LNG = 111.0 * 0.65;

function fastDistKm(lng1: number, lat1: number, lng2: number, lat2: number) {
    const dy = (lat1 - lat2) * KM_PER_DEG_LAT;
    const dx = (lng1 - lng2) * KM_PER_DEG_LNG;

    return Math.sqrt(dx * dx + dy * dy);
}

/** Off-route spur time in minutes. When no plausible average speed is known
 * (telemetry not connected yet), assume a 60 km/h truck crawl. */
export function estimateDetourMinutes(
    detourKm: number,
    avgSpeedKmh: number,
): number {
    const speed = avgSpeedKmh > 5 ? avgSpeedKmh : 60;
    return Math.max(1, Math.round((detourKm / speed) * 60));
}

/** The side of a grid cell, degrees (~1 km of the fast metric). */
const CELL_DEG = 0.01;

interface RouteCellIndex {
    /** Segment start indices by the cell their middle sits in. */
    cells: Map<string, number[]>;
    points: readonly [number, number][];
    /** The slice's extent, widened by the widest reach, for POI prefiltering. */
    bbox: [number, number, number, number];
}

let cachedIndex: {
    path: readonly [number, number][];
    fromIndex: number;
    maxKmAhead: number;
    statsCache: Float32Array | null;
    index: RouteCellIndex;
} | null = null;

/** The forward slice of `path` from `fromIndex` (up to `maxKmAhead` when the
 * km cache says so), its segments cell-indexed. One index serves every
 * sprite query of a tick: the cells only depend on the route slice. */
function routeCellsFor(
    path: readonly [number, number][],
    statsCache: Float32Array | null,
    fromIndex: number,
    maxKmAhead: number,
): RouteCellIndex {
    if (
        cachedIndex &&
        cachedIndex.path === path &&
        cachedIndex.fromIndex === fromIndex &&
        cachedIndex.maxKmAhead === maxKmAhead &&
        cachedIndex.statsCache === statsCache
    ) {
        return cachedIndex.index;
    }

    const cells = new Map<string, number[]>();
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];

    const startKm = statsCache ? statsCache[fromIndex * 3]! : 0;
    for (let i = fromIndex; i < path.length - 1; i++) {
        const [ax, ay] = path[i]!;
        const [bx, by] = path[i + 1]!;
        if (
            statsCache &&
            statsCache[i * 3]! - startKm > maxKmAhead &&
            // One segment may straddle the horizon; keep it, stop after.
            i > fromIndex
        ) {
            // Widen the bbox with this last segment before stopping.
            x0 = Math.min(x0, ax, bx);
            x1 = Math.max(x1, ax, bx);
            y0 = Math.min(y0, ay, by);
            y1 = Math.max(y1, ay, by);
            break;
        }

        const key = `${Math.floor(((ax + bx) / 2) / CELL_DEG)},${Math.floor(((ay + by) / 2) / CELL_DEG)}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);

        x0 = Math.min(x0, ax, bx);
        x1 = Math.max(x1, ax, bx);
        y0 = Math.min(y0, ay, by);
        y1 = Math.max(y1, ay, by);
    }

    // A segment in reach has its middle within a cell more than the reach:
    // widen the prefilter box by a cell so nothing at the edge slips out.
    const index: RouteCellIndex = {
        cells,
        points: path,
        bbox: [x0 - CELL_DEG, x1 + CELL_DEG, y0 - CELL_DEG, y1 + CELL_DEG],
    };
    cachedIndex = { path, fromIndex, maxKmAhead, statsCache, index };
    return index;
}

/** Where `poi` sits nearest the indexed slice, within `reachKm`: how far
 * along (route km) and how far off (km). The along figure interpolates the
 * km cache's own span of the winning segment, so it agrees with the route's
 * cumulative km whether or not that cache is geometric. */
function nearestOnCells(
    index: RouteCellIndex,
    statsCache: Float32Array | null,
    startKm: number,
    startPoint: [number, number],
    poi: [number, number],
    reachKm: number,
): { along: number; off: number } | null {
    const spanLng = Math.ceil(reachKm / (KM_PER_DEG_LNG * CELL_DEG)) + 1;
    const spanLat = Math.ceil(reachKm / (KM_PER_DEG_LAT * CELL_DEG)) + 1;
    const [cx, cy] = [Math.floor(poi[0] / CELL_DEG), Math.floor(poi[1] / CELL_DEG)];

    let best: { along: number; off: number } | null = null;

    for (let dx = -spanLng; dx <= spanLng; dx++) {
        for (let dy = -spanLat; dy <= spanLat; dy++) {
            const list = index.cells.get(`${cx + dx},${cy + dy}`);
            if (!list) continue;
            for (const i of list) {
                const [ax, ay] = index.points[i]!;
                const [bx, by] = index.points[i + 1]!;
                const ex = bx - ax;
                const ey = by - ay;
                const lenSq = ex * ex + ey * ey;
                const t =
                    lenSq === 0
                        ? 0
                        : Math.max(
                              0,
                              Math.min(
                                  1,
                                  ((poi[0] - ax) * ex + (poi[1] - ay) * ey) /
                                      lenSq,
                              ),
                          );
                const off = fastDistKm(
                    ax + ex * t,
                    ay + ey * t,
                    poi[0],
                    poi[1],
                );
                if (off <= reachKm && (!best || off < best.off)) {
                    const segSpanKm = statsCache
                        ? statsCache[(i + 1) * 3]! - statsCache[i * 3]!
                        : fastDistKm(ax, ay, bx, by);
                    const baseKm = statsCache
                        ? statsCache[i * 3]! - startKm
                        : fastDistKm(startPoint[0], startPoint[1], ax, ay);
                    best = {
                        along: baseKm + segSpanKm * t,
                        off,
                    };
                }
            }
        }
    }
    return best;
}

/**
 * Of `poiPoints`, those within `maxKmAhead` of the slice and within
 * `maxDetourKm` of the path still to drive from `fromIndex`, nearest along
 * the route first. A stop right at the truck isn't one to stop at.
 */
export function findPoisAlongRoute(
    path: readonly [number, number][],
    statsCache: Float32Array | null,
    fromIndex: number,
    poiPoints: readonly [number, number][],
    maxKmAhead: number,
    maxDetourKm: number,
): PoiHit[] {
    if (
        path.length < 2 ||
        poiPoints.length === 0 ||
        fromIndex < 0 ||
        fromIndex >= path.length - 1
    ) {
        return [];
    }

    const startKm = statsCache ? statsCache[fromIndex * 3]! : 0;
    const index = routeCellsFor(path, statsCache, fromIndex, maxKmAhead);
    const [minLng, maxLng, minLat, maxLat] = index.bbox;

    const found: PoiHit[] = [];
    for (const poi of poiPoints) {
        if (
            poi[0] < minLng ||
            poi[0] > maxLng ||
            poi[1] < minLat ||
            poi[1] > maxLat
        ) {
            continue;
        }
        const at = nearestOnCells(
            index,
            statsCache,
            startKm,
            path[fromIndex]!,
            poi,
            maxDetourKm,
        );
        if (at && at.along > 0.001 && at.along <= maxKmAhead) {
            found.push({
                coords: [poi[0], poi[1]],
                poiCoords: [poi[0], poi[1]],
                kmAhead: Math.max(0, at.along),
                detourKm: at.off,
            });
        }
    }

    return found.sort((a, b) => a.kmAhead - b.kmAhead);
}

/**
 * Scans the route forward from `fromIndex` up to `maxKmAhead` and returns
 * the first POI within `maxDetourKm` of the path (null when none) — the
 * head of `findPoisAlongRoute`'s list, kept for the single-stop callers.
 */
export function findNearestPoiAhead(
    path: readonly [number, number][],
    statsCache: Float32Array | null,
    fromIndex: number,
    poiPoints: readonly [number, number][],
    maxKmAhead: number,
    maxDetourKm: number,
): PoiHit | null {
    return (
        findPoisAlongRoute(
            path,
            statsCache,
            fromIndex,
            poiPoints,
            maxKmAhead,
            maxDetourKm,
        )[0] ?? null
    );
}
