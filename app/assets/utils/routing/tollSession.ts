// The session's toll-gate POI cache, shared shape between the UI thread and
// the routing worker.
//
// The map only exposes POIs from tiles loaded so far, so the cache sweeps
// `querySourceFeatures` every few seconds and grows as the viewport travels.
// Both halves of that growth used to be rebuilt from scratch per sweep: a Set
// of string keys over every point already known, and — on any growth — the
// full array cloned across the worker boundary. The session now owns the
// dedup keys, so a sweep touches only the points it just found, and the
// worker receives just the delta (a full replace when it (re)starts).

export type TollPoint = [number, number];

function pointKey([lng, lat]: TollPoint): string {
    return `${lng.toFixed(4)}:${lat.toFixed(4)}`;
}

export interface TollSession {
    /** All points gathered so far, in discovery order. */
    readonly points: TollPoint[];
    /**
     * Folds freshly found points in, skipping ones already keyed; returns
     * only the new points, which is what the worker needs as a delta.
     */
    absorb(found: Iterable<TollPoint>): TollPoint[];
}

export function createTollSession(): TollSession {
    const keys = new Set<string>();
    const points: TollPoint[] = [];

    return {
        get points() {
            return points;
        },
        absorb(found: Iterable<TollPoint>): TollPoint[] {
            const added: TollPoint[] = [];
            for (const point of found) {
                const key = pointKey(point);
                if (keys.has(key)) continue;
                keys.add(key);
                points.push(point);
                added.push(point);
            }
            return added;
        },
    };
}
