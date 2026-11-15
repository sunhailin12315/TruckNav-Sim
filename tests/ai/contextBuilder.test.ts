import { describe, expect, it } from "vitest";
import { buildDriveReportContext } from "~/assets/utils/ai/contextBuilder";
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
});
