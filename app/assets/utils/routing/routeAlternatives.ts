// Route alternative summaries, compared against the primary route the way
// real car navigation does: as deltas in time, distance, toll gates and
// ferry crossings. Pure and worker-agnostic: the caller feeds in the numbers
// produced by the routing worker.

export type RouteAlternativeKind = "primary" | "tolls" | "ferries";

export interface RouteAlternativeFlags {
    avoidTolls: boolean;
    avoidFerries: boolean;
}

export interface RouteAlternativeSummary {
    kind: RouteAlternativeKind;
    /** Preference flags this route was calculated with. */
    flags: RouteAlternativeFlags;
    km: number;
    gameMinutes: number;
    tollCount: number;
    ferryCount: number;
}

/** Two routes count as "the same road" when km matches within 0.5%. */
const DUPLICATE_EPSILON_PCT = 0.005;

/**
 * Builds a summary from a worker route result. `stats` is the per-point
 * [km, gameHours, realHours] cache laid out as 3 floats per path point.
 */
export function summarizeRouteResult(
    kind: RouteAlternativeKind,
    flags: RouteAlternativeFlags,
    stats: Float32Array,
    pathPointCount: number,
    tollCount: number,
    ferryCount: number,
): RouteAlternativeSummary | null {
    if (pathPointCount < 1) return null;

    const lastIdx = (pathPointCount - 1) * 3;
    const km = stats[lastIdx];
    const gameHours = stats[lastIdx + 1];
    if (km === undefined || gameHours === undefined) return null;

    return {
        kind,
        flags,
        km,
        gameMinutes: gameHours * 60,
        tollCount,
        ferryCount,
    };
}

/**
 * Drops variants that are effectively the same road as the primary route:
 * the session toll cache only covers visited tiles, so toll counts can
 * under-report for far-out variants — distance is the reliable identity
 * signal, gate counts only tighten the match.
 */
export function buildRouteAlternatives(
    primary: RouteAlternativeSummary,
    variants: RouteAlternativeSummary[],
): RouteAlternativeSummary[] {
    return variants.filter((variant) => {
        const kmDeltaPct =
            primary.km > 0
                ? Math.abs(variant.km - primary.km) / primary.km
                : Math.abs(variant.km - primary.km);
        const sameRoad =
            kmDeltaPct <= DUPLICATE_EPSILON_PCT &&
            variant.tollCount === primary.tollCount &&
            variant.ferryCount === primary.ferryCount;
        return !sameRoad;
    });
}
