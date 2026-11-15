import { describe, expect, it } from "vitest";
import { extractUsage } from "~/assets/utils/ai/aiClient";
import {
    buildDeliveryNoteContext,
    buildRouteInsightContext,
} from "~/assets/utils/ai/contextBuilder";
import { parseAiNote } from "~/assets/utils/ai/prompts";
import type { DirectionStep } from "~/assets/utils/routing/directions";

function makeStep(
    id: number,
    type: DirectionStep["type"],
): DirectionStep {
    return { id, type, text: "Turn", distance: 1, coords: [0, 0] };
}

describe("buildRouteInsightContext", () => {
    it("summarizes shape counters and skips empty optional fields", () => {
        const context = JSON.parse(
            buildRouteInsightContext(
                [
                    makeStep(0, "depart"),
                    makeStep(3, "ferry"),
                    makeStep(5, "roundabout"),
                    makeStep(7, "ferry"),
                    makeStep(9, "destination"),
                ],
                812.4,
                612,
                "Duisburg",
            ),
        ) as Record<string, unknown>;

        expect(context).toEqual({
            totalKm: 812,
            etaMinutes: 612,
            destination: "Duisburg",
            ferryCount: 2,
            roundaboutCount: 1,
            turnCount: 4,
        });

        // Zero ETA / no destination are omitted rather than sent as junk.
        const minimal = JSON.parse(
            buildRouteInsightContext([makeStep(1, "left")], 5.2, null, ""),
        ) as Record<string, unknown>;
        expect(minimal.etaMinutes).toBeUndefined();
        expect(minimal.destination).toBeUndefined();
        expect(minimal.turnCount).toBe(1);
    });
});

describe("buildDeliveryNoteContext", () => {
    it("rounds the delivery and session figures", () => {
        const context = JSON.parse(
            buildDeliveryNoteContext(
                {
                    income: 15200.4,
                    distanceKm: 412.6,
                    cargoDamagePct: 2.4,
                    earnedXp: 120,
                },
                { deliveredCount: 5, netIncome: 68000.2, finesCount: 1 },
            ),
        ) as Record<string, { income: number; netIncome: number }>;

        expect(context.delivered.income).toBe(15200);
        expect(context.session.netIncome).toBe(68000);
    });
});

describe("parseAiNote", () => {
    it("parses the note, tolerating fences and prose", () => {
        expect(parseAiNote('{"note":"Have a good run."}')?.note).toBe(
            "Have a good run.",
        );
        expect(
            parseAiNote('```json\n{"note":"Two ferries ahead."}\n```')?.note,
        ).toBe("Two ferries ahead.");
    });

    it("rejects unusable replies", () => {
        expect(parseAiNote("no json")).toBeNull();
        expect(parseAiNote('{"summary":"wrong key"}')).toBeNull();
        expect(parseAiNote('{"note":"   "}')).toBeNull();
        expect(parseAiNote('{"note":"' + "x".repeat(201) + '"}')).toBeNull();
    });
});

describe("extractUsage", () => {
    it("reads the OpenAI-style usage block when present", () => {
        expect(
            extractUsage({
                usage: { prompt_tokens: 120, completion_tokens: 45 },
            }),
        ).toEqual({ promptTokens: 120, completionTokens: 45 });

        expect(extractUsage({})).toBeUndefined();
        expect(extractUsage({ usage: { prompt_tokens: "1" } })).toBeUndefined();
    });
});
