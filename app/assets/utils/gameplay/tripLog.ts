// Pure trip-log building blocks: a per-job expense accumulator and the
// finalization into a storable record. Kept free of Vue/localStorage so the
// logic stays unit-testable; app/composables/TripLog.ts owns persistence.

export interface TripExpenses {
    fines: number;
    tolls: number;
    ferry: number;
    train: number;
    finesCount: number;
}

export interface TripAccumulator {
    game: string;
    sourceCity: string;
    destinationCity: string;
    cargoName: string;
    cargoMassKg: number;
    expenses: TripExpenses;
}

export type TripKind = "delivered" | "cancelled";

export interface TripDeliveryData {
    kind: TripKind;
    income: number;
    penalty: number;
    cargoDamage: number;
    distanceKm: number;
    earnedXp: number;
    completedAt: string;
}

export interface TripRecord {
    id: number;
    game: string;
    kind: TripKind;
    sourceCity: string;
    destinationCity: string;
    cargoName: string;
    cargoMassKg: number;
    cargoDamage: number;
    income: number;
    penalty: number;
    distanceKm: number;
    earnedXp: number;
    expenses: TripExpenses;
    completedAt: string;
}

export function createTripAccumulator(
    game: string,
    sourceCity: string,
    destinationCity: string,
    cargoName: string,
    cargoMassKg: number,
): TripAccumulator {
    return {
        game,
        sourceCity,
        destinationCity,
        cargoName,
        cargoMassKg,
        expenses: { fines: 0, tolls: 0, ferry: 0, train: 0, finesCount: 0 },
    };
}

export function applyTripExpense(
    accumulator: TripAccumulator,
    kind: "fine" | "toll" | "ferry" | "train",
    amount: number,
) {
    const expenses = accumulator.expenses;

    switch (kind) {
        case "fine":
            expenses.fines += amount;
            expenses.finesCount++;
            break;
        case "toll":
            expenses.tolls += amount;
            break;
        case "ferry":
            expenses.ferry += amount;
            break;
        case "train":
            expenses.train += amount;
            break;
    }
}

export function finalizeTripRecord(
    accumulator: TripAccumulator,
    delivery: TripDeliveryData,
    id: number,
): TripRecord {
    return {
        id,
        game: accumulator.game,
        kind: delivery.kind,
        sourceCity: accumulator.sourceCity,
        destinationCity: accumulator.destinationCity,
        cargoName: accumulator.cargoName,
        cargoMassKg: accumulator.cargoMassKg,
        cargoDamage: delivery.cargoDamage,
        income: delivery.income,
        penalty: delivery.penalty,
        distanceKm: delivery.distanceKm,
        earnedXp: delivery.earnedXp,
        expenses: accumulator.expenses,
        completedAt: delivery.completedAt,
    };
}
