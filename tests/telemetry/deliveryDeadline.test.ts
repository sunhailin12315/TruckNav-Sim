import { describe, expect, it } from "vitest";
import {
    decodeBridgeMinutes,
    initialDeliveryDeadlineState,
    jobSignatureOf,
    observeDeliveryDeadline,
} from "~/assets/utils/telemetry/deliveryDeadline";

// Bridge anchors minute counts at the .NET DateTime epoch (year 1).
const Y1 = -62135596800000;
const iso = (minutesSinceYear1: number) =>
    new Date(Y1 + minutesSinceYear1 * 60000).toISOString();

const JOB = "A|B|C|D|100";

/** Feed a stream of (remaining, game) samples, returning each signed result. */
function feed(samples: Array<[number | null, number | null]>) {
    let state = initialDeliveryDeadlineState;
    const out: (number | null)[] = [];
    for (const [remaining, game] of samples) {
        const r = observeDeliveryDeadline(state, JOB, remaining, game);
        state = r.state;
        out.push(r.signedMinutes);
    }
    return out;
}

describe("decodeBridgeMinutes", () => {
    it("reads back the epoch-anchored minute count", () => {
        expect(decodeBridgeMinutes(iso(385))).toBeCloseTo(385, 6);
        expect(decodeBridgeMinutes(iso(0))).toBeCloseTo(0, 6);
    });

    it("returns null on malformed input", () => {
        expect(decodeBridgeMinutes("")).toBeNull();
        expect(decodeBridgeMinutes("nope")).toBeNull();
    });
});

describe("observeDeliveryDeadline", () => {
    it("reports unsigned-positive on the first sample (no evidence yet)", () => {
        expect(feed([[660, 18000]])).toEqual([660]);
    });

    it("latches a forward deadline once the count is seen decreasing", () => {
        // 660 left at game 18000 -> deadline at 18660.
        const out = feed([
            [660, 18000],
            [659, 18001],
        ]);
        expect(out[1]).toBe(659);
        // Later frames derive exactly from the clock, still counting down.
        expect(
            observeDeliveryDeadline(
                {
                    jobSignature: JOB,
                    deadlineAbs: 18660,
                    lastSample: { remaining: 659, game: 18001 },
                },
                JOB,
                658,
                18002,
            ).signedMinutes,
        ).toBe(658);
    });

    it("detects an overdue window from an increasing absolute count", () => {
        // 30 "minutes" at game 18000, then 31 at 18001: it's counting up,
        // so the deadline passed at 17970.
        const out = feed([
            [30, 18000],
            [31, 18001],
        ]);
        expect(out[1]).toBe(-31);
    });

    it("keeps an overdue job negative across later frames", () => {
        let state = initialDeliveryDeadlineState;
        [
            [30, 18000],
            [31, 18001],
            [32, 18002],
        ].forEach(([r, g]) => {
            state = observeDeliveryDeadline(state, JOB, r, g).state;
        });
        expect(
            observeDeliveryDeadline(state, JOB, 40, 18010).signedMinutes,
        ).toBe(-40);
    });

    it("holds unsigned when the whole count is unchanged across a minute", () => {
        expect(
            feed([
                [660, 18000],
                [660, 18001],
            ]),
        ).toEqual([660, 660]);
    });

    it("does not latch while the clock is frozen (paused)", () => {
        // Same game minute: no direction evidence, stays unsigned-positive.
        const out = feed([
            [660, 18000],
            [659, 18000],
        ]);
        expect(out[1]).toBe(659);
    });

    it("returns null when there is no usable window", () => {
        expect(feed([[null, 18000]])).toEqual([null]);
        expect(feed([[660, null]])).toEqual([null]);
    });

    it("resets on a new job signature", () => {
        let state = observeDeliveryDeadline(
            initialDeliveryDeadlineState,
            JOB,
            660,
            18000,
        ).state;
        state = observeDeliveryDeadline(state, JOB, 659, 18001).state; // latched forward
        expect(state.deadlineAbs).not.toBeNull();

        // A different job resets the latch: first sample is unsigned again.
        const r = observeDeliveryDeadline(state, "OTHER", 10, 18002);
        expect(r.signedMinutes).toBe(10);
        expect(r.state.jobSignature).toBe("OTHER");
    });

    it("resets when the game clock rewinds (save reload)", () => {
        let state = observeDeliveryDeadline(
            initialDeliveryDeadlineState,
            JOB,
            660,
            18000,
        ).state;
        state = observeDeliveryDeadline(state, JOB, 659, 18001).state;
        // Clock jumps backwards: latch discarded, re-evaluate from scratch.
        const r = observeDeliveryDeadline(state, JOB, 500, 100);
        expect(r.signedMinutes).toBe(500); // unsigned first sample of fresh window
    });
});

describe("jobSignatureOf", () => {
    it("is stable for the same job and differs across jobs", () => {
        const packet = (income: number) =>
            ({
                job: {
                    citySourceId: "paris",
                    companySourceId: "agriloop",
                    cityDestinationId: "berlin",
                    companyDestinationId: "spedition",
                    income,
                },
            }) as never;
        expect(jobSignatureOf(packet(100))).toBe(jobSignatureOf(packet(100)));
        expect(jobSignatureOf(packet(100))).not.toBe(jobSignatureOf(packet(200)));
    });
});
