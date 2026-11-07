// Finds the nearest POI reachable from the route ahead. Pure and
// map-agnostic: the caller feeds in POI points (e.g. queried from the
// spritelocations PMTiles layer) and the active route path + km cache.

export interface PoiHit {
    coords: [number, number];
    /** Distance from the search start, in route km. */
    kmAhead: number;
}

const SAMPLE_STEP = 10;

function fastDistKm(lng1: number, lat1: number, lng2: number, lat2: number) {
    const ky = 111.0;
    const kx = 111.0 * 0.65;

    const dy = (lat1 - lat2) * ky;
    const dx = (lng1 - lng2) * kx;

    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Scans the route forward from `fromIndex` up to `maxKmAhead` and returns
 * the first POI within `maxDetourKm` of the path (null when none).
 */
export function findNearestPoiAhead(
    path: [number, number][],
    statsCache: Float32Array | null,
    fromIndex: number,
    poiPoints: [number, number][],
    maxKmAhead: number,
    maxDetourKm: number,
): PoiHit | null {
    if (
        path.length < 2 ||
        poiPoints.length === 0 ||
        fromIndex < 0 ||
        fromIndex >= path.length - 1
    ) {
        return null;
    }

    const startKm = statsCache ? statsCache[fromIndex * 3]! : 0;

    // Prefilter: bounding box of the scanned route slice, widened by the
    // detour allowance, so per-point checks stay cheap on long routes.
    let minLng = Infinity,
        maxLng = -Infinity,
        minLat = Infinity,
        maxLat = -Infinity;
    for (let i = fromIndex; i < path.length; i += SAMPLE_STEP) {
        const [lng, lat] = path[i]!;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    const tail = path[path.length - 1]!;
    if (tail[0] < minLng) minLng = tail[0];
    if (tail[0] > maxLng) maxLng = tail[0];
    if (tail[1] < minLat) minLat = tail[1];
    if (tail[1] > maxLat) maxLat = tail[1];

    const detourDegLat = maxDetourKm / 111.0;
    const detourDegLng = maxDetourKm / (111.0 * 0.65);
    const candidates = poiPoints.filter(
        ([lng, lat]) =>
            lng >= minLng - detourDegLng &&
            lng <= maxLng + detourDegLng &&
            lat >= minLat - detourDegLat &&
            lat <= maxLat + detourDegLat,
    );
    if (candidates.length === 0) return null;

    let best: PoiHit | null = null;

    for (
        let i = fromIndex;
        i < path.length && best === null;
        i += SAMPLE_STEP
    ) {
        const [lng, lat] = path[i]!;
        const kmAtPoint = statsCache
            ? statsCache[i * 3]! - startKm
            : fastDistKm(path[fromIndex]![0], path[fromIndex]![1], lng, lat);

        if (kmAtPoint > maxKmAhead) break;

        let nearestSqDist = Infinity;
        for (const [poiLng, poiLat] of candidates) {
            // Degree deltas converted to km before squaring: the detour
            // threshold is in km, so comparing degree² would false-match.
            const dxKm = (poiLng - lng) * 111.0 * 0.65;
            const dyKm = (poiLat - lat) * 111.0;
            const sq = dxKm * dxKm + dyKm * dyKm;
            if (sq < nearestSqDist) nearestSqDist = sq;
        }

        if (nearestSqDist <= maxDetourKm * maxDetourKm) {
            best = { coords: [lng, lat], kmAhead: Math.max(0, kmAtPoint) };
        }
    }

    return best;
}
