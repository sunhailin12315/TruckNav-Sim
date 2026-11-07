// Spoken turn guidance thresholds, AMap "简洁播报" style: the upcoming turn
// is announced as the distance-to-turn crosses fixed marks (far to near).
// Pure and testable; the caller owns localization and speech synthesis.

/** Distance marks (route-km) at which the upcoming turn is announced. */
export const TURN_ANNOUNCEMENT_THRESHOLDS_KM = [2, 0.5] as const;

/**
 * Picks the announcement to fire for the upcoming turn: the farthest
 * threshold that was just crossed (prev >= t > now) and not yet spoken
 * for this turn. In concise mode only the nearest mark is used.
 * Returns the threshold to add to the spoken set, or null.
 */
export function pickTurnAnnouncement(
    prevKm: number,
    nowKm: number,
    spoken: readonly number[],
    concise: boolean,
): number | null {
    const thresholds = concise
        ? [
              TURN_ANNOUNCEMENT_THRESHOLDS_KM[
                  TURN_ANNOUNCEMENT_THRESHOLDS_KM.length - 1
              ]!,
          ]
        : TURN_ANNOUNCEMENT_THRESHOLDS_KM;

    for (const threshold of thresholds) {
        if (prevKm >= threshold && nowKm < threshold) {
            if (!spoken.includes(threshold)) return threshold;
        }
    }
    return null;
}
