// Aggregates trip records into the numbers the stats view and achievement
// checks read. Trips are ordered newest-first (as stored by TripLog).
import type { TripRecord } from "./tripLog";

export interface TripStats {
    deliveredCount: number;
    cancelledCount: number;
    totalDistanceKm: number;
    totalRevenue: number;
    totalPenalty: number;
    finesTotal: number;
    tollsTotal: number;
    ferryTotal: number;
    trainTotal: number;
    avgCargoDamage: number;
    /** Consecutive newest-first deliveries with zero cargo damage. */
    zeroDamageStreak: number;
    /** Consecutive newest-first jobs without any fine. */
    noFineStreak: number;
}

export interface DriveReport {
    deliveredCount: number;
    cancelledCount: number;
    distanceKm: number;
    grossIncome: number;
    penalty: number;
    fines: number;
    finesCount: number;
    tolls: number;
    ferry: number;
    train: number;
    avgCargoDamage: number;
    /** grossIncome minus every expense (penalty, fines, tolls, ferry, train). */
    netIncome: number;
}

/**
 * Aggregates the trips completed after `sinceTripId` (exclusive) into a
 * per-session drive report, AMap DriveReport style. Trips are ordered
 * newest-first; ids are monotonic, so the id filter survives the
 * ring-buffer trim of the trip log.
 */
export function computeDriveReport(
    trips: TripRecord[],
    sinceTripId: number,
): DriveReport {
    let deliveredCount = 0;
    let cancelledCount = 0;
    let distanceKm = 0;
    let grossIncome = 0;
    let penalty = 0;
    let fines = 0;
    let finesCount = 0;
    let tolls = 0;
    let ferry = 0;
    let train = 0;
    let damageSum = 0;

    for (const trip of trips) {
        if (trip.id <= sinceTripId) continue;

        if (trip.kind === "delivered") {
            deliveredCount++;
            damageSum += trip.cargoDamage;
        } else {
            cancelledCount++;
        }

        distanceKm += trip.distanceKm;
        grossIncome += trip.income;
        penalty += trip.penalty;
        fines += trip.expenses.fines;
        finesCount += trip.expenses.finesCount;
        tolls += trip.expenses.tolls;
        ferry += trip.expenses.ferry;
        train += trip.expenses.train;
    }

    return {
        deliveredCount,
        cancelledCount,
        distanceKm,
        grossIncome,
        penalty,
        fines,
        finesCount,
        tolls,
        ferry,
        train,
        avgCargoDamage: deliveredCount > 0 ? damageSum / deliveredCount : 0,
        netIncome:
            grossIncome - penalty - fines - tolls - ferry - train,
    };
}

export function computeTripStats(trips: TripRecord[]): TripStats {
    let deliveredCount = 0;
    let cancelledCount = 0;
    let totalDistanceKm = 0;
    let totalRevenue = 0;
    let totalPenalty = 0;
    let finesTotal = 0;
    let tollsTotal = 0;
    let ferryTotal = 0;
    let trainTotal = 0;
    let damageSum = 0;

    let zeroDamageStreak = 0;
    let noFineStreak = 0;
    let zeroDamageBroken = false;
    let noFineBroken = false;

    for (const trip of trips) {
        if (trip.kind === "delivered") deliveredCount++;
        else cancelledCount++;

        totalDistanceKm += trip.distanceKm;
        totalRevenue += trip.income;
        totalPenalty += trip.penalty;
        finesTotal += trip.expenses.fines;
        tollsTotal += trip.expenses.tolls;
        ferryTotal += trip.expenses.ferry;
        trainTotal += trip.expenses.train;

        if (trip.kind === "delivered") {
            damageSum += trip.cargoDamage;
        }

        if (!zeroDamageBroken) {
            if (trip.kind === "delivered" && trip.cargoDamage === 0) {
                zeroDamageStreak++;
            } else {
                zeroDamageBroken = true;
            }
        }

        if (!noFineBroken) {
            if (trip.expenses.finesCount === 0) {
                noFineStreak++;
            } else {
                noFineBroken = true;
            }
        }
    }

    return {
        deliveredCount,
        cancelledCount,
        totalDistanceKm,
        totalRevenue,
        totalPenalty,
        finesTotal,
        tollsTotal,
        ferryTotal,
        trainTotal,
        avgCargoDamage:
            deliveredCount > 0 ? damageSum / deliveredCount : 0,
        zeroDamageStreak,
        noFineStreak,
    };
}
