import { describe, expect, it } from "vitest";
import {
    applyTripExpense,
    createTripAccumulator,
    finalizeTripRecord,
    type TripDeliveryData,
} from "~/assets/utils/gameplay/tripLog";
import { computeTripStats, type TripStats } from "~/assets/utils/gameplay/stats";
import {
    evaluateNewAchievements,
    defaultEconomyTotals,
    ACHIEVEMENTS,
    type EconomyTotals,
} from "~/assets/utils/gameplay/achievements";
import { computeDeliveryGrade } from "~/assets/utils/gameplay/score";
import type { TripRecord } from "~/assets/utils/gameplay/tripLog";

const DELIVERY: TripDeliveryData = {
    kind: "delivered",
    income: 5000,
    penalty: 0,
    cargoDamage: 0,
    distanceKm: 120,
    earnedXp: 120,
    completedAt: "Tue 14:32",
};

function makeRecord(overrides: Partial<TripRecord>): TripRecord {
    return {
        id: 1,
        game: "ets2",
        kind: "delivered",
        sourceCity: "Calais",
        destinationCity: "Duisburg",
        cargoName: "Tools",
        cargoMassKg: 10000,
        cargoDamage: 0,
        income: 5000,
        penalty: 0,
        distanceKm: 100,
        earnedXp: 100,
        expenses: { fines: 0, tolls: 0, ferry: 0, train: 0, finesCount: 0 },
        completedAt: "Tue 14:32",
        ...overrides,
    };
}

describe("tripLog accumulator", () => {
    it("accumulates expenses and counts fines", () => {
        const acc = createTripAccumulator("ets2", "Calais", "Duisburg", "Tools", 10000);

        applyTripExpense(acc, "fine", 250);
        applyTripExpense(acc, "fine", 100);
        applyTripExpense(acc, "toll", 40);
        applyTripExpense(acc, "ferry", 95);
        applyTripExpense(acc, "train", 30);

        expect(acc.expenses).toEqual({
            fines: 350,
            tolls: 40,
            ferry: 95,
            train: 30,
            finesCount: 2,
        });
    });

    it("finalizes a record carrying accumulator context", () => {
        const acc = createTripAccumulator("ats", "Seattle", "Olympia", "Glass", 8000);
        applyTripExpense(acc, "toll", 12);

        const record = finalizeTripRecord(acc, DELIVERY, 7);

        expect(record.id).toBe(7);
        expect(record.game).toBe("ats");
        expect(record.sourceCity).toBe("Seattle");
        expect(record.cargoMassKg).toBe(8000);
        expect(record.income).toBe(5000);
        expect(record.expenses.tolls).toBe(12);
    });
});

describe("computeTripStats", () => {
    it("sums counts, money and distance; averages damage over deliveries", () => {
        const trips = [
            makeRecord({ id: 2, income: 6000, distanceKm: 200, cargoDamage: 20 }),
            makeRecord({ id: 1, income: 4000, distanceKm: 100, cargoDamage: 0 }),
            makeRecord({
                id: 0,
                kind: "cancelled",
                income: 0,
                penalty: 700,
                distanceKm: 0,
            }),
        ];

        const stats = computeTripStats(trips);

        expect(stats.deliveredCount).toBe(2);
        expect(stats.cancelledCount).toBe(1);
        expect(stats.totalDistanceKm).toBe(300);
        expect(stats.totalRevenue).toBe(10000);
        expect(stats.totalPenalty).toBe(700);
        expect(stats.avgCargoDamage).toBe(10);
    });

    it("breaks streaks on damage, cancellation and fines", () => {
        const trips = [
            makeRecord({ id: 4, cargoDamage: 0 }),
            makeRecord({ id: 3, cargoDamage: 0 }),
            makeRecord({ id: 2, cargoDamage: 5 }), // breaks zero-damage at 2
            makeRecord({ id: 1, cargoDamage: 0 }),
            makeRecord({
                id: 0,
                kind: "cancelled",
                expenses: { fines: 0, tolls: 0, ferry: 0, train: 0, finesCount: 0 },
            }),
            makeRecord({
                id: -1,
                expenses: { fines: 300, tolls: 0, ferry: 0, train: 0, finesCount: 1 },
            }),
        ];

        const stats = computeTripStats(trips);

        // Newest-first: two clean deliveries, then the damaged one stops it.
        expect(stats.zeroDamageStreak).toBe(2);
        // Newer fines-free run spans ids 4..0 (cancelled has no fines too).
        expect(stats.noFineStreak).toBe(5);
    });
});

describe("achievements", () => {
    function baseStats(overrides: Partial<TripStats>): TripStats {
        return {
            deliveredCount: 0,
            cancelledCount: 0,
            totalDistanceKm: 0,
            totalRevenue: 0,
            totalPenalty: 0,
            finesTotal: 0,
            tollsTotal: 0,
            ferryTotal: 0,
            trainTotal: 0,
            avgCargoDamage: 0,
            zeroDamageStreak: 0,
            noFineStreak: 0,
            ...overrides,
        };
    }

    it("has six stable definitions", () => {
        expect(ACHIEVEMENTS).toHaveLength(6);
        expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(6);
    });

    it("unlocks on thresholds and never re-unlocks", () => {
        const totals: EconomyTotals = defaultEconomyTotals();
        const stats = baseStats({ deliveredCount: 1 });

        const first = evaluateNewAchievements(stats, totals, {});
        expect(first.map((a) => a.id)).toEqual(["first-delivery"]);

        const unlocked = { "first-delivery": Date.now() };
        expect(evaluateNewAchievements(stats, totals, unlocked)).toEqual([]);
    });

    it("checks distance, revenue, streaks and ferry totals", () => {
        const unlocked: Record<string, number> = {};

        const stats = baseStats({
            totalDistanceKm: 1500,
            totalRevenue: 150000,
            zeroDamageStreak: 10,
            noFineStreak: 10,
        });
        const totals = defaultEconomyTotals();
        totals.ferry.count = 10;

        const ids = evaluateNewAchievements(stats, totals, unlocked).map(
            (a) => a.id,
        );

        expect(ids).toContain("road-warrior");
        expect(ids).toContain("trucking-tycoon");
        expect(ids).toContain("glass-transporter");
        expect(ids).toContain("law-abiding");
        expect(ids).toContain("old-salt");
        // first-delivery still locked: deliveredCount is 0 here.
        expect(ids).not.toContain("first-delivery");
    });
});

describe("computeDeliveryGrade", () => {
    it("ranks damage and fines into S/A/B/C", () => {
        expect(computeDeliveryGrade(0, 0)).toBe("S");
        expect(computeDeliveryGrade(3, 0)).toBe("A");
        expect(computeDeliveryGrade(10, 0)).toBe("B");
        expect(computeDeliveryGrade(0, 1)).toBe("B");
        expect(computeDeliveryGrade(10, 2)).toBe("C");
        expect(computeDeliveryGrade(25, 0)).toBe("C");
        expect(computeDeliveryGrade(0, 2)).toBe("C");
    });
});
