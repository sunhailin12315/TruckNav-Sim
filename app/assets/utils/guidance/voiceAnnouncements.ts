// Spoken turn guidance thresholds, AMap "简洁播报" style: the upcoming turn
// is announced as the distance-to-turn crosses fixed marks (far to near).
// Pure and testable; the caller owns localization and speech synthesis.

/**
 * Final cue: fires when the driver actually closes on the turn rather than
 * at a fixed 1 km lead — the 5 km/3 km marks keep the planning lead time,
 * the maneuver wording itself waits until the turn is right ahead.
 */
export const APPROACH_TURN_ANNOUNCEMENT_KM = 0.2;

/**
 * Distance marks (route-km) at which the upcoming turn is announced, far to
 * near. The near mark is the approach cue above, not the 1 km a truck's
 * 45 s lead would suggest.
 */
export const TURN_ANNOUNCEMENT_THRESHOLDS_KM = [
    5,
    3,
    APPROACH_TURN_ANNOUNCEMENT_KM,
] as const;

/** Concise mode's single mark: ~25 s of lead at truck speeds. */
export const CONCISE_TURN_ANNOUNCEMENT_KM = [0.5] as const;

/**
 * Picks the announcement to fire for the upcoming turn: the farthest
 * threshold that was just crossed (prev >= t > now) and not yet spoken
 * for this turn. In concise mode only the concise mark is used.
 * Returns the threshold to add to the spoken set, or null.
 */
export function pickTurnAnnouncement(
    prevKm: number,
    nowKm: number,
    spoken: readonly number[],
    concise: boolean,
): number | null {
    const thresholds = concise ? CONCISE_TURN_ANNOUNCEMENT_KM : TURN_ANNOUNCEMENT_THRESHOLDS_KM;

    for (const threshold of thresholds) {
        if (prevKm >= threshold && nowKm < threshold) {
            if (!spoken.includes(threshold)) return threshold;
        }
    }
    return null;
}
