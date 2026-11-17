/**
 * Telemetry freshness watchdog (pure, testable state machine).
 *
 * The WebSocket `onclose` event is not a sufficient liveness signal:
 *
 *  1. Silence-while-open — the game exits cleanly (or the bridge stops
 *     producing), the bridge goes quiet, but the socket stays open. Without a
 *     timeout the UI keeps showing the last truck position forever.
 *  2. Zombie frames — the game crashes, the shared-memory keeps the last
 *     frame, and the bridge happily re-broadcasts that byte-identical packet
 *     at ~30 Hz. `onclose` never fires and each packet looks connected.
 *
 * Detection, fed by (a) every received packet and (b) a ~1 Hz tick:
 *
 *  - no packet for SILENCE_TIMEOUT_MS            -> disconnect
 *  - renderTimestamp not advancing for FROZEN_TIMEOUT_MS while the newest
 *    packet reports paused === false             -> disconnect (crash/freeze)
 *
 * The frozen check needs the bridge's `common.renderTimestamp` (µs game
 * render clock); packets from an older bridge omit it and the check stays
 * inert. The paused gate is deliberate: we never disconnect while the game
 * itself claims to be paused, even if its render clock stands still — a
 * paused game with a dead renderer is indistinguishable from a crash and
 * false-positive-free liveness beats catching that rare double fault.
 *
 * Modeled on ETS2LA's provider-loop defenses (docs/ets2la-reference-study.md
 * §2.2): cheap periodic revalidation instead of trusting one failure signal.
 */

/** No packet within this window while open -> treat as disconnected. */
export const SILENCE_TIMEOUT_MS = 2000;

/** Render clock this long without advancing (unpaused) -> frozen frame. */
export const FROZEN_TIMEOUT_MS = 5000;

export interface FreshnessState {
    /** Wall-clock ms of the most recent received packet (null: none yet). */
    lastMessageAt: number | null;
    /** Wall-clock ms when renderTimestamp last advanced (null: never seen). */
    lastAdvanceAt: number | null;
    /** Last observed renderTimestamp (null when bridge predates the field). */
    lastRenderTimestamp: number | null;
    /** `paused` of the most recent packet; gates the frozen check. */
    lastPaused: boolean;
}

export const initialFreshnessState: FreshnessState = {
    lastMessageAt: null,
    lastAdvanceAt: null,
    lastRenderTimestamp: null,
    lastPaused: false,
};

export interface FreshnessInput {
    /** Wall-clock ms for this evaluation (packet arrival or watchdog tick). */
    nowMs: number;
    /** True when a packet arrived now; false for a periodic tick. */
    received: boolean;
    /** packet.common.renderTimestamp when received, else undefined/null. */
    renderTimestamp?: number | null;
    /** packet.paused when received. */
    paused?: boolean;
}

export interface FreshnessResult {
    state: FreshnessState;
    /** True when the session must be torn down as disconnected. */
    disconnect: boolean;
}

/**
 * Feeds one observation (packet or tick) into the tracker.
 *
 * `disconnect` may fire on consecutive calls; the caller is expected to tear
 * the socket down synchronously, after which it resets to
 * `initialFreshnessState` for the next connection.
 */
export function observeFreshness(
    state: FreshnessState,
    input: FreshnessInput,
): FreshnessResult {
    let next: FreshnessState = state;

    if (input.received) {
        // Resuming from a truthful pause re-arms the frozen timer: the render
        // clock legitimately stood still while paused, so that stretch must
        // not count against the stall window.
        const resuming = next.lastPaused === true && input.paused === false;

        next = {
            ...next,
            lastMessageAt: input.nowMs,
            lastPaused: input.paused === true,
            ...(resuming ? { lastAdvanceAt: input.nowMs } : null),
        };

        const rt = input.renderTimestamp;
        if (typeof rt === "number" && Number.isFinite(rt)) {
            // Compare for *change*, not increase: the clock restarts from 0
            // on a game restart, and either direction proves liveness.
            if (rt !== next.lastRenderTimestamp) {
                next = {
                    ...next,
                    lastRenderTimestamp: rt,
                    lastAdvanceAt: input.nowMs,
                };
            }
        }
    }

    const silenced =
        next.lastMessageAt !== null &&
        input.nowMs - next.lastMessageAt > SILENCE_TIMEOUT_MS;

    const frozen =
        next.lastAdvanceAt !== null &&
        next.lastPaused === false &&
        input.nowMs - next.lastAdvanceAt > FROZEN_TIMEOUT_MS;

    return { state: next, disconnect: silenced || frozen };
}
