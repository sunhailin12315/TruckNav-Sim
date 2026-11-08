/**
 * Recovering the SIGNED remaining delivery time.
 *
 * The shipped bridge (TruckNavTelemetry.exe) encodes the delivery window as
 * `Math.Abs(deadline - gameTime)` minutes anchored at the .NET DateTime
 * epoch, e.g. "385 minutes" arrives as "0001-01-01T06:25:00Z". The absolute
 * sign is destroyed in the packet — but the game clock (`common.gameTime`,
 * same epoch anchoring) only ever moves forward, and the bridge recomputes
 * the absolute delta on every frame. So across two samples more than a
 * game minute apart:
 *
 *   remaining decreases  ->  deadline is ahead  (sign +)
 *   remaining increases  ->  deadline is behind (sign -)
 *
 * Once the direction is known, latch the absolute deadline (in game minutes)
 * and derive the signed value for every later frame from it. Until then,
 * report the unsigned value as positive: a job must never look overdue on
 * incomplete evidence.
 *
 * Newer bridges additionally send `job.remainingDeliveryMinutes` already
 * signed; that field short-circuits all of this when present.
 */

/** Milliseconds between the JS epoch and 0001-01-01T00:00:00Z. */
const YEAR_ONE_MS = -62135596800000;

/**
 * Decodes the bridge's epoch-anchored fake date (gameTime or
 * remainingDeliveryTime) back into its minute count.
 */
export function decodeBridgeMinutes(isoTime: string): number | null {
    const ms = new Date(isoTime).getTime();
    if (Number.isNaN(ms)) return null;
    return (ms - YEAR_ONE_MS) / 60000;
}

export interface DeliveryDeadlineState {
    /** Identity of the job the latch belongs to; any change resets it. */
    jobSignature: string | null;
    /** Latched absolute deadline in game minutes since year 1. */
    deadlineAbs: number | null;
    /** Previous sample, kept for the one-step direction test. */
    lastSample: { remaining: number; game: number } | null;
}

export const initialDeliveryDeadlineState: DeliveryDeadlineState = {
    jobSignature: null,
    deadlineAbs: null,
    lastSample: null,
};

/**
 * Feeds one telemetry packet into the tracker and returns the updated state
 * plus the signed remaining minutes (negative = overdue) when known.
 *
 * `remainingAbs` is the unsigned |deadline - game| in game minutes (null
 * when the packet carries no usable window), `gameAbs` the absolute game
 * clock in game minutes.
 */
export function observeDeliveryDeadline(
    state: DeliveryDeadlineState,
    jobSignature: string,
    remainingAbs: number | null,
    gameAbs: number | null,
): { state: DeliveryDeadlineState; signedMinutes: number | null } {
    // A new job, a save reload (clock going backwards) or a rewind invalidates
    // anything latched from before.
    const clockRewound =
        state.lastSample !== null &&
        gameAbs !== null &&
        gameAbs < state.lastSample.game;

    if (jobSignature !== state.jobSignature || clockRewound) {
        state = { ...initialDeliveryDeadlineState, jobSignature };
    }

    // Latched: the deadline is known, so every later frame is exact from the
    // clock alone — even a frame that fails to report the window.
    if (state.deadlineAbs !== null) {
        if (gameAbs === null) {
            return { state, signedMinutes: null };
        }
        return {
            state: {
                ...state,
                lastSample:
                    remainingAbs !== null
                        ? { remaining: remainingAbs, game: gameAbs }
                        : state.lastSample,
            },
            signedMinutes: state.deadlineAbs - gameAbs,
        };
    }

    // Not yet latched: we need both the window and the clock to reason.
    if (remainingAbs === null || gameAbs === null) {
        return { state, signedMinutes: null };
    }

    const next = (deadlineAbs: number | null, signedMinutes: number | null) => ({
        state: {
            jobSignature,
            deadlineAbs,
            lastSample: { remaining: remainingAbs, game: gameAbs },
        } as DeliveryDeadlineState,
        signedMinutes,
    });

    const prev = state.lastSample;

    // First usable sample of this job: no direction evidence yet.
    if (prev === null) {
        return next(null, remainingAbs);
    }

    const dGame = gameAbs - prev.game;
    if (dGame <= 0) {
        // Clock hasn't advanced a whole minute (paused or dense packets):
        // still no direction evidence, report unsigned-positive.
        return next(null, remainingAbs);
    }

    if (remainingAbs < prev.remaining) {
        // Counting down: the deadline sits ahead of the game clock.
        return next(prev.game + prev.remaining, remainingAbs);
    }
    if (remainingAbs > prev.remaining) {
        // Counting up: the window already passed and the bridge is echoing the
        // overdue distance back as a positive number — latch as overdue.
        return next(prev.game - prev.remaining, -remainingAbs);
    }

    // Unchanged across a whole game minute — cannot tell yet; hold unsigned.
    return next(null, remainingAbs);
}

/** Stable identity of the active job for latch resets. */
export function jobSignatureOf(packet: {
    job: {
        citySourceId: string;
        companySourceId: string;
        cityDestinationId: string;
        companyDestinationId: string;
        income: number;
    };
}): string {
    const j = packet.job;
    return [
        j.citySourceId,
        j.companySourceId,
        j.cityDestinationId,
        j.companyDestinationId,
        j.income,
    ].join("|");
}
