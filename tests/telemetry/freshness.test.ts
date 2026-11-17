import { describe, expect, it } from "vitest";
import {
    FROZEN_TIMEOUT_MS,
    initialFreshnessState,
    observeFreshness,
    SILENCE_TIMEOUT_MS,
} from "~/assets/utils/telemetry/freshness";

/** Drive a scripted stream of packets/ticks through the tracker. */
function feed(
    events: Array<{
        at: number;
        received?: boolean;
        renderTimestamp?: number | null;
        paused?: boolean;
    }>,
) {
    let state = initialFreshnessState;
    const out: boolean[] = [];
    for (const e of events) {
        const { at, ...rest } = e;
        const r = observeFreshness(state, { nowMs: at, ...rest });
        state = r.state;
        out.push(r.disconnect);
    }
    return out;
}

describe("observeFreshness — silence", () => {
    it("stays healthy while packets keep arriving", () => {
        const out = feed([
            { at: 0, received: true, renderTimestamp: 100 },
            { at: 1000, received: true, renderTimestamp: 200 },
            { at: 1900, received: true, renderTimestamp: 300 },
        ]);
        expect(out).toEqual([false, false, false]);
    });

    it("disconnects once no packet arrives within the silence window", () => {
        const out = feed([
            { at: 0, received: true, renderTimestamp: 100 },
            // Ticks only — the bridge went quiet while the socket stayed open.
            { at: 1000 },
            { at: SILENCE_TIMEOUT_MS }, // exactly at the boundary: not yet
            { at: SILENCE_TIMEOUT_MS + 50 },
        ]);
        expect(out).toEqual([false, false, false, true]);
    });

    it("a received packet resets the silence timer", () => {
        let state = observeFreshness(initialFreshnessState, {
            nowMs: 0,
            received: true,
            renderTimestamp: 100,
        }).state;
        state = observeFreshness(state, { nowMs: 500, received: true, renderTimestamp: 150 }).state;
        const r = observeFreshness(state, { nowMs: 2400, received: false });
        // Last message at 500; tick at 2400 is 1900 ms later — inside window.
        expect(r.disconnect).toBe(false);
    });
});

describe("observeFreshness — frozen frames (game crash)", () => {
    const frozenStream = (endAt: number) => {
        const events: Array<{ at: number; received: boolean; renderTimestamp: number; paused?: boolean }> = [
            { at: 0, received: true, renderTimestamp: 1000 },
            { at: 1000, received: true, renderTimestamp: 2000 },
        ];
        // Byte-identical zombie re-broadcast from here on.
        for (let t = 2000; t <= endAt; t += 1000) {
            events.push({ at: t, received: true, renderTimestamp: 2000 });
        }
        return feed(events);
    };

    it("does not react before the frozen window elapses", () => {
        // Last advance at t=1000; the t=6000 packet sits exactly on the
        // boundary (not past it).
        const out = frozenStream(FROZEN_TIMEOUT_MS + 1000);
        expect(out.every((d) => !d)).toBe(true);
    });

    it("disconnects when the render clock stalls beyond the window", () => {
        const out = frozenStream(FROZEN_TIMEOUT_MS + 2000);
        expect(out[out.length - 1]).toBe(true);
    });

    it("holds off while the game truthfully reports paused", () => {
        const out = feed([
            { at: 0, received: true, renderTimestamp: 1000 },
            { at: 1000, received: true, renderTimestamp: 2000, paused: true },
            ...Array.from({ length: 7 }, (_, i) => ({
                at: 2000 + i * 1000,
                received: true,
                renderTimestamp: 2000,
                paused: true,
            })),
        ]);
        expect(out.every((d) => !d)).toBe(true);
    });

    it("arms the check again when the game unpauses but frames stay frozen", () => {
        const out = feed([
            { at: 0, received: true, renderTimestamp: 1000 },
            // Paused for a long stretch, clock legitimately standing still.
            { at: 30000, received: true, renderTimestamp: 1000, paused: true },
            { at: 60000, received: true, renderTimestamp: 1000, paused: true },
            // User resumes — paused false again, the stall window re-arms
            // from this moment (61000), and frames never resume.
            { at: 61000, received: true, renderTimestamp: 1000, paused: false },
            // 4999 ms after the resume: still inside the window...
            { at: 65999, received: true, renderTimestamp: 1000, paused: false },
            // ...past it: the crash signature is confirmed.
            { at: 66001, received: true, renderTimestamp: 1000, paused: false },
        ]);
        expect(out.slice(0, 5)).toEqual([false, false, false, false, false]);
        expect(out[5]).toBe(true);
    });

    it("a game restart (clock going backwards) counts as liveness", () => {
        const out = feed([
            { at: 0, received: true, renderTimestamp: 9_000_000 },
            { at: 1000, received: true, renderTimestamp: 100 }, // new session
            { at: 2000, received: true, renderTimestamp: 200 },
        ]);
        expect(out).toEqual([false, false, false]);
    });
});

describe("observeFreshness — bridges without renderTimestamp", () => {
    it("frozen check stays inert, silence check still works", () => {
        const events = [
            { at: 0, received: true },
            ...Array.from({ length: 10 }, (_, i) => ({ at: 1000 + i * 1000, received: true })),
            { at: 12000 + SILENCE_TIMEOUT_MS + 50 },
        ];
        const out = feed(events);
        // No renderTimestamp ever -> never "frozen"...
        expect(out.slice(0, -1).every((d) => !d)).toBe(true);
        // ...but the final tick is far beyond the silence window.
        expect(out[out.length - 1]).toBe(true);
    });
});
