import { describe, expect, it } from "vitest";
import { extractUsage } from "~/assets/utils/ai/aiClient";
import {
    buildDeliveryNoteContext,
    buildRouteInsightContext,
    buildServiceNoteContext,
} from "~/assets/utils/ai/contextBuilder";
import { parseAiNote, serviceNoteMessages } from "~/assets/utils/ai/prompts";
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

    it("carries destination, cargo, grade and fines; omits unknown time", () => {
        const context = JSON.parse(
            buildDeliveryNoteContext(
                {
                    income: 9900,
                    distanceKm: 300,
                    cargoDamagePct: 0,
                    earnedXp: 120,
                    destination: "Rotterdam",
                    cargo: "Wood pellets",
                    grade: "S",
                    finesCount: 0,
                    remainingMinutes: null,
                },
                { deliveredCount: 1, netIncome: 9900, finesCount: 0 },
            ),
        ) as Record<string, Record<string, unknown>>;

        expect(context.delivered).toEqual({
            income: 9900,
            distanceKm: 300,
            cargoDamagePct: 0,
            earnedXp: 120,
            destination: "Rotterdam",
            cargo: "Wood pellets",
            grade: "S",
            finesCount: 0,
        });

        // A tracked deadline (positive or negative) is sent rounded.
        const late = JSON.parse(
            buildDeliveryNoteContext(
                {
                    income: 1,
                    distanceKm: 1,
                    cargoDamagePct: 0,
                    earnedXp: 0,
                    finesCount: 2,
                    remainingMinutes: -12.4,
                },
                { deliveredCount: 1, netIncome: 1, finesCount: 2 },
            ),
        ) as { delivered: Record<string, unknown> };
        expect(late.delivered.timeLeftMinutes).toBe(-12);
        expect(late.delivered.destination).toBeUndefined();
        expect(late.delivered.grade).toBeUndefined();
    });
});

describe("buildServiceNoteContext", () => {
    it("sends only the live numbers that justify this kind of stop", () => {
        const fuel = JSON.parse(
            buildServiceNoteContext({
                kind: "fuel",
                kmAhead: 12.4,
                detourKm: 1.05,
                detourMinutes: 4,
                fuelRangeKm: 38.6,
                fuelAmountL: 120.4,
                nextRestStopMinutes: 180,
            }),
        ) as Record<string, unknown>;

        expect(fuel).toEqual({
            kind: "fuel",
            kmAhead: 12,
            detourKm: 1.1,
            detourMinutes: 4,
            fuelRangeKm: 39,
            fuelAmountL: 120,
        });

        const rest = JSON.parse(
            buildServiceNoteContext({
                kind: "rest",
                kmAhead: 8,
                detourKm: 0.6,
                detourMinutes: 3,
                nextRestStopMinutes: 17.2,
            }),
        ) as Record<string, unknown>;

        expect(rest).toEqual({
            kind: "rest",
            kmAhead: 8,
            detourKm: 0.6,
            detourMinutes: 3,
            nextRestStopMinutes: 17,
        });
    });

    it("pins the service-note reply language like the other notes", () => {
        const [system, user] = serviceNoteMessages('{"kind":"rest"}', "de");

        expect(system.content).toContain("60 characters");
        expect(user.content).toContain("German");
        expect(user.content).toContain('{"kind":"rest"}');
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
