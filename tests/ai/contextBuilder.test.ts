import { describe, expect, it } from "vitest";
import {
    buildDriveReportContext,
    computePreviousBaseline,
} from "~/assets/utils/ai/contextBuilder";
import type { DriveReport, TripStats } from "~/assets/utils/gameplay/stats";
import type { TripRecord } from "~/assets/utils/gameplay/tripLog";

const REPORT: DriveReport = {
    deliveredCount: 4,
    cancelledCount: 1,
    distanceKm: 812.4,
    grossIncome: 96500.6,
    penalty: 500,
    fines: 1250,
    finesCount: 3,
    tolls: 860,
    ferry: 120,
    train: 0,
    avgCargoDamage: 2.14,
    netIncome: 78120,
};

const LIFETIME: TripStats = {
    deliveredCount: 132,
    cancelledCount: 7,
    totalDistanceKm: 41200,
    totalRevenue: 2772000,
    totalPenalty: 4000,
    finesTotal: 5300,
    tollsTotal: 12000,
    ferryTotal: 2000,
    trainTotal: 900,
    avgCargoDamage: 4.02,
    zeroDamageStreak: 3,
    noFineStreak: 5,
};

function makeTrip(id: number, overrides: Partial<TripRecord> = {}): TripRecord {
    return {
        id,
        game: "ets2",
        kind: "delivered",
        sourceCity: "Calais",
        destinationCity: "Duisburg",
        cargoName: "Construction pieces",
        cargoMassKg: 18000,
        cargoDamage: 3,
        income: 15200,
        penalty: 0,
        distanceKm: 412,
        earnedXp: 120,
        expenses: { fines: 0, tolls: 120, ferry: 0, train: 0, finesCount: 0 },
        completedAt: "2026-11-15T10:00:00.000Z",
        ...overrides,
    };
}

describe("buildDriveReportContext", () => {
    it("builds compact session + lifetime JSON with chronological trips", () => {
        // TripLog stores newest-first; the context flips to reading order.
        const context = JSON.parse(
            buildDriveReportContext(
                REPORT,
                [
                    makeTrip(6, { destinationCity: "Rotterdam", income: 9900 }),
                    makeTrip(5, { kind: "cancelled" }),
                ],
                LIFETIME,
                ["Speeding"],
            ),
        ) as {
            session: Record<string, unknown> & {
                trips: Array<Record<string, unknown>>;
                fines: Record<string, unknown>;
            };
            lifetime: Record<string, unknown>;
        };

        expect(context.session.delivered).toBe(4);
        expect(context.session.distanceKm).toBe(812);
        expect(context.session.avgCargoDamagePct).toBe(2.1);
        expect(context.session.fines).toEqual({
            count: 3,
            total: 1250,
            reasons: ["Speeding"],
        });

        expect(context.session.trips).toHaveLength(2);
        // Newest-first input becomes chronological output: id 5 first.
        expect(context.session.trips[0]).toMatchObject({
            from: "Calais",
            to: "Duisburg",
            massT: 18,
            cancelled: true,
        });
        expect(context.session.trips[1]).toMatchObject({
            to: "Rotterdam",
            cancelled: false,
        });

        expect(context.lifetime.delivered).toBe(132);
        expect(context.lifetime.avgIncomePerDelivered).toBe(21000);
        expect(context.lifetime.avgDistancePerDeliveredKm).toBe(312);
    });

    it("caps the trip list so a marathon session stays in budget", () => {
        const manyTrips = Array.from({ length: 40 }, (_, i) => makeTrip(i + 1));
        const context = JSON.parse(
            buildDriveReportContext(REPORT, manyTrips, LIFETIME, []),
        ) as { session: { trips: unknown[] } };

        expect(context.session.trips).toHaveLength(15);
    });

    it("omits fine reasons when the feed knows more fines than the session", () => {
        // Labels from older sessions would leak; the guard drops them.
        const context = JSON.parse(
            buildDriveReportContext(
                REPORT,
                [makeTrip(6)],
                LIFETIME,
                ["Speeding", "Red light", "Collision", "Overload"],
            ),
        ) as { session: { fines: Record<string, unknown> } };

        expect(context.session.fines.reasons).toBeUndefined();
        expect(context.session.fines).toEqual({ count: 3, total: 1250 });
    });

    it("includes the previous baseline when history backs it", () => {
        const previous = computePreviousBaseline([
            makeTrip(4, { income: 14000, distanceKm: 380, cargoDamage: 6 }),
            makeTrip(3, {
                kind: "cancelled",
                expenses: {
                    fines: 250,
                    tolls: 0,
                    ferry: 0,
                    train: 0,
                    finesCount: 1,
                },
            }),
            makeTrip(2, { income: 16000, distanceKm: 420, cargoDamage: 4 }),
            makeTrip(1, { income: 18000, distanceKm: 400, cargoDamage: 2 }),
        ]);
        expect(previous).not.toBeNull();

        const context = JSON.parse(
            buildDriveReportContext(REPORT, [makeTrip(6)], LIFETIME, [], previous),
        ) as { previous?: Record<string, unknown> };

        // Averages over the 3 delivered trips; fines per trip over all 4.
        expect(context.previous).toEqual({
            trips: 4,
            avgIncome: 16000,
            avgDistanceKm: 400,
            avgCargoDamagePct: 4,
            finesPerTrip: 0.3,
        });
    });

    it("omits the previous block below the minimum history", () => {
        const short = computePreviousBaseline([
            makeTrip(2),
            makeTrip(1),
        ]);
        expect(short).toBeNull();

        const context = JSON.parse(
            buildDriveReportContext(REPORT, [makeTrip(6)], LIFETIME, [], short),
        ) as { previous?: unknown };
        expect(context.previous).toBeUndefined();
    });
});

describe("computePreviousBaseline", () => {
    it("caps the window at the 10 most recent earlier trips", () => {
        const many = Array.from({ length: 14 }, (_, i) =>
            makeTrip(14 - i, { income: 10000 + i, cargoDamage: 0 }),
        );
        const baseline = computePreviousBaseline(many);

        expect(baseline?.trips).toBe(10);
        // The slice takes the 10 newest entries first: incomes 10000..10009
        // average to 10004.5 (the four oldest are excluded).
        expect(baseline?.avgIncome).toBeCloseTo(10004.5);
    });

    it("averages money over delivered trips only while fines span all", () => {
        const baseline = computePreviousBaseline([
            makeTrip(3),
            makeTrip(2, {
                kind: "cancelled",
                income: 0,
                expenses: {
                    fines: 0,
                    tolls: 0,
                    ferry: 0,
                    train: 0,
                    finesCount: 2,
                },
            }),
            makeTrip(1, { income: 5000 }),
        ]);

        // (15200 + 5000) / 2 delivered…
        expect(baseline?.avgIncome).toBe(10100);
        // …2 fines across 3 trips.
        expect(baseline?.finesPerTrip).toBeCloseTo(2 / 3);
    });

    it("survives an all-cancelled window without dividing by zero", () => {
        const baseline = computePreviousBaseline([
            makeTrip(3, { kind: "cancelled" }),
            makeTrip(2, { kind: "cancelled" }),
            makeTrip(1, { kind: "cancelled" }),
        ]);

        expect(baseline?.trips).toBe(3);
        expect(baseline?.avgIncome).toBe(0);
        expect(baseline?.avgCargoDamagePct).toBe(0);
    });
});
