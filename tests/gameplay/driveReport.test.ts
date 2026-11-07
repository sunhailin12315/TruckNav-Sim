import { describe, expect, it } from "vitest";
import { computeDriveReport } from "~/assets/utils/gameplay/stats";
import type { TripRecord } from "~/assets/utils/gameplay/tripLog";

let nextId = 100;

function makeTrip(overrides: Partial<TripRecord> = {}): TripRecord {
    const id = overrides.id ?? nextId++;
    return {
        id,
        game: "ets2",
        kind: "delivered",
        sourceCity: "Calais",
        destinationCity: "Duisburg",
        cargoName: "Steel",
        cargoMassKg: 20000,
        cargoDamage: 0,
        income: 5000,
        penalty: 0,
        distanceKm: 400,
        earnedXp: 120,
        expenses: { fines: 0, tolls: 100, ferry: 0, train: 0, finesCount: 0 },
        completedAt: "Wed 21:30",
        ...overrides,
    };
}

describe("computeDriveReport", () => {
    it("ignores trips at or below the session anchor", () => {
        const trips = [
            makeTrip({ id: 105 }),
            makeTrip({ id: 104 }),
            makeTrip({ id: 103 }),
        ];

        const report = computeDriveReport(trips, 104);

        expect(report.deliveredCount).toBe(1);
        expect(report.distanceKm).toBe(trips[0]!.distanceKm);
    });

    it("sums income, expenses and distance across the session", () => {
        const trips = [
            makeTrip({
                id: 2,
                income: 6000,
                distanceKm: 300,
                expenses: {
                    fines: 250,
                    tolls: 120,
                    ferry: 90,
                    train: 0,
                    finesCount: 1,
                },
            }),
            makeTrip({
                id: 3,
                kind: "cancelled",
                income: 0,
                penalty: 800,
                distanceKm: 50,
                expenses: {
                    fines: 0,
                    tolls: 0,
                    ferry: 0,
                    train: 0,
                    finesCount: 0,
                },
            }),
        ];

        const report = computeDriveReport(trips, 1);

        expect(report.deliveredCount).toBe(1);
        expect(report.cancelledCount).toBe(1);
        expect(report.distanceKm).toBe(350);
        expect(report.grossIncome).toBe(6000);
        expect(report.penalty).toBe(800);
        expect(report.fines).toBe(250);
        expect(report.finesCount).toBe(1);
        expect(report.tolls).toBe(120);
        expect(report.ferry).toBe(90);
    });

    it("derives net income from every expense bucket", () => {
        const trips = [
            makeTrip({
                id: 2,
                income: 6000,
                penalty: 500,
                expenses: {
                    fines: 250,
                    tolls: 120,
                    ferry: 90,
                    train: 40,
                    finesCount: 1,
                },
            }),
        ];

        const report = computeDriveReport(trips, 1);

        expect(report.netIncome).toBe(6000 - 500 - 250 - 120 - 90 - 40);
    });

    it("averages cargo damage over deliveries only", () => {
        const trips = [
            makeTrip({ id: 2, cargoDamage: 10 }),
            makeTrip({ id: 3, cargoDamage: 0 }),
            makeTrip({ id: 4, kind: "cancelled", cargoDamage: 100 }),
        ];

        const report = computeDriveReport(trips, 1);

        expect(report.avgCargoDamage).toBe(5);
    });

    it("returns zeros for an empty session", () => {
        const report = computeDriveReport([makeTrip({ id: 1 })], 1);

        expect(report.deliveredCount).toBe(0);
        expect(report.netIncome).toBe(0);
        expect(report.avgCargoDamage).toBe(0);
    });
});
