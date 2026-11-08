// The next of the route's stops still ahead of the truck: how far it is and
// how long it takes, the stop's share of the whole route's remaining time by
// distance (the stretch to it as fast as the rest). The shape follows
// WestPlay's nextStop.ts (docs/westplay-reference-study.md §2.8), in this
// map's route km instead of the game's metres. Pure and testable.

export interface NextStop {
    /** Route km to it, from the truck. */
    distanceKm: number;
    /** Minutes to it, its share of the remaining minutes by distance. */
    minutes: number;
    /** Which stop it was (an index into the `stopKms` given). */
    index: number;
}

/**
 * `stopKms`: each stop's cumulative route km (ascending); `currentKm` the
 * truck's km along the route; `remainingKm` and `remainingMinutes` what's
 * left of the whole route. `null` with no stop ahead.
 */
export function nextStopKm(
    stopKms: readonly number[],
    currentKm: number,
    remainingKm: number,
    remainingMinutes: number,
): NextStop | null {
    if (remainingKm <= 0 || remainingMinutes <= 0) return null;
    for (let index = 0; index < stopKms.length; index++) {
        const distanceKm = stopKms[index]! - currentKm;
        if (distanceKm <= 0) continue;
        return {
            distanceKm,
            minutes: remainingMinutes * (distanceKm / remainingKm),
            index,
        };
    }
    return null;
}
