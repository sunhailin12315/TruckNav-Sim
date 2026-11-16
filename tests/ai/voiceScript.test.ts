import { describe, expect, it } from "vitest";
import {
    VOICE_SCRIPT_MAX_TURNS,
    buildVoiceScriptContext,
    parseVoiceScript,
    planVoiceScriptBatch,
    routeKeyOf,
    routeTotalKm,
} from "~/assets/utils/guidance/voiceScript";
import type { DirectionStep } from "~/assets/utils/routing/directions";

function makeStep(
    id: number,
    type: DirectionStep["type"],
    overrides: Partial<DirectionStep> = {},
): DirectionStep {
    return {
        id,
        type,
        text: "Turn",
        distance: 1.2,
        coords: [10, 20],
        ...overrides,
    };
}

describe("routeKeyOf / routeTotalKm", () => {
    it("is stable for the same list and differs per plan", () => {
        const steps = [
            makeStep(0, "depart"),
            makeStep(5, "left", { cumulativeKm: 12.4 }),
        ];

        const key = routeKeyOf(steps);
        expect(routeKeyOf([...steps])).toBe(key);
        expect(
            routeKeyOf([makeStep(0, "depart"), makeStep(5, "right")]),
        ).not.toBe(key);
        // Steps without cumulative km still get a stable slot.
        expect(routeKeyOf([makeStep(0, "depart")])).toBe("0@-1");
    });

    it("reads the route total from the destination step", () => {
        expect(
            routeTotalKm([
                makeStep(0, "depart"),
                makeStep(9, "destination", { cumulativeKm: 412.6 }),
            ]),
        ).toBe(413);
        expect(routeTotalKm([])).toBe(0);
    });
});

describe("buildVoiceScriptContext", () => {
    it("keeps maneuver steps, drops depart/destination, caps the list", () => {
        const steps = [
            makeStep(0, "depart"),
            makeStep(3, "left", { cumulativeKm: 1.25, exitCount: 0 }),
            makeStep(7, "roundabout", {
                cumulativeKm: 9.83,
                exitCount: 2,
            }),
            makeStep(9, "destination", { cumulativeKm: 20 }),
        ];
        // Pad past the cap to prove the limit applies.
        for (let i = 10; i < 10 + VOICE_SCRIPT_MAX_TURNS + 5; i++) {
            steps.push(makeStep(i, "straight", { cumulativeKm: i }));
        }

        const context = JSON.parse(buildVoiceScriptContext(steps)) as {
            turns: Array<{ i: number; type: string; km?: number; exit?: number }>;
            totalKm: number;
        };

        expect(context.totalKm).toBe(VOICE_SCRIPT_MAX_TURNS + 14);
        expect(context.turns[0]).toEqual({ i: 3, type: "left", km: 1.3 });
        expect(context.turns[1]).toEqual({
            i: 7,
            type: "roundabout",
            km: 9.8,
            exit: 2,
        });
        // depart/destination never sent; the cap bounds the payload.
        expect(context.turns).toHaveLength(VOICE_SCRIPT_MAX_TURNS);
        expect(
            context.turns.some((turn) => turn.type === "destination"),
        ).toBe(false);
    });
});

describe("planVoiceScriptBatch", () => {
    /** depart + 40 straight turns + destination. */
    function longRoute(): DirectionStep[] {
        const steps = [makeStep(0, "depart", { cumulativeKm: 0 })];
        for (let i = 1; i <= 40; i++) {
            steps.push(makeStep(i, "straight", { cumulativeKm: i * 2 }));
        }
        steps.push(makeStep(99, "destination", { cumulativeKm: 82 }));
        return steps;
    }

    it("plans the first batch and reports it incomplete", () => {
        const batch = planVoiceScriptBatch(longRoute());

        expect(batch.coveredIds).toHaveLength(VOICE_SCRIPT_MAX_TURNS);
        expect(batch.lastCoveredKm).toBe(60); // turn 30 sits at 30*2 km
        expect(batch.exhausted).toBe(false);

        const turns = (JSON.parse(batch.context) as {
            turns: Array<{ i: number }>;
        }).turns;
        expect(turns[0].i).toBe(1);
        expect(turns).toHaveLength(VOICE_SCRIPT_MAX_TURNS);
    });

    it("continues after the excluded ids and finishes the route", () => {
        const first = planVoiceScriptBatch(longRoute());
        const covered = new Set(first.coveredIds);

        // Driving shifted the window: depart is gone from the prompt but the
        // covered ids carry over.
        const second = planVoiceScriptBatch(longRoute(), covered);

        expect(second.coveredIds).toHaveLength(10); // 40 total turns - 30
        expect(second.coveredIds[0]).toBe(31);
        expect(second.exhausted).toBe(true);
        expect(second.lastCoveredKm).toBe(80);

        // A third pass has nothing left: the caller marks the script complete.
        const third = planVoiceScriptBatch(
            longRoute(),
            new Set([...covered, ...second.coveredIds]),
        );
        expect(third.coveredIds).toEqual([]);
        expect(third.exhausted).toBe(true);
        expect(third.lastCoveredKm).toBeNull();
    });

    it("reports an exhausted batch for a short route", () => {
        const batch = planVoiceScriptBatch([
            makeStep(0, "depart"),
            makeStep(3, "left", { cumulativeKm: 5 }),
            makeStep(9, "destination", { cumulativeKm: 12 }),
        ]);

        expect(batch.coveredIds).toEqual([3]);
        expect(batch.exhausted).toBe(true);
    });
});

describe("parseVoiceScript", () => {
    it("maps turn ids to phrases from a plain reply", () => {
        const phrases = parseVoiceScript(
            '{"cues":[{"i":3,"text":"Left ahead"},{"i":7,"text":"Take the second exit"}]}',
        );
        expect(phrases?.get(3)).toBe("Left ahead");
        expect(phrases?.get(7)).toBe("Take the second exit");
    });

    it("recovers from fences and surrounding prose", () => {
        const phrases = parseVoiceScript(
            '```json\n{"cues":[{"i":1,"text":"Keep left"}]}\n``` extra remark',
        );
        expect(phrases?.get(1)).toBe("Keep left");
    });

    it("drops unusable cues but keeps the rest", () => {
        const phrases = parseVoiceScript(
            '{"cues":[{"i":"bad","text":"no"},{"i":2},{"i":3,"text":""},{"i":4,"text":"x".repeat(200)},{"i":5,"text":"Good"}]}'.replace(
                '"x".repeat(200)',
                '"' + "x".repeat(200) + '"',
            ),
        );
        expect(phrases?.size).toBe(1);
        expect(phrases?.get(5)).toBe("Good");
    });

    it("returns null when no usable cue survives", () => {
        expect(parseVoiceScript("no json")).toBeNull();
        expect(parseVoiceScript('{"cues":[]}')).toBeNull();
        expect(parseVoiceScript('{"cues":[{"i":"x","text":"y"}]}')).toBeNull();
        expect(parseVoiceScript('{"cues":"junk"}')).toBeNull();
    });
});
