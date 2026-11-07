import { computeTripStats } from "~/assets/utils/gameplay/stats";
import {
    defaultEconomyTotals,
    evaluateNewAchievements,
    type AchievementDef,
    type EconomyTotals,
} from "~/assets/utils/gameplay/achievements";
import {
    applyTripExpense,
    createTripAccumulator,
    finalizeTripRecord,
    type TripAccumulator,
    type TripDeliveryData,
    type TripRecord,
} from "~/assets/utils/gameplay/tripLog";

const TRIP_LOG_KEY = "truck-nav-triplog";
const ACHIEVEMENTS_KEY = "truck-nav-achievements";
const MAX_TRIPS = 500;

interface TripLogState {
    trips: TripRecord[];
    totals: EconomyTotals;
    unlocked: Record<string, number>;
    nextId: number;
    loaded: boolean;
}

const tripLogState = reactive<TripLogState>({
    trips: [],
    totals: defaultEconomyTotals(),
    unlocked: {},
    nextId: 1,
    loaded: false,
});

// Memory-only: the trip being accumulated right now (lost on app restart).
let activeTrip: TripAccumulator | null = null;

function isTripRecord(value: unknown): value is TripRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as TripRecord;
    return (
        (record.kind === "delivered" || record.kind === "cancelled") &&
        typeof record.income === "number" &&
        !!record.expenses
    );
}

function normalizeTotals(raw: unknown): EconomyTotals {
    const defaults = defaultEconomyTotals();
    if (!raw || typeof raw !== "object") return defaults;

    const source = raw as Record<string, unknown>;
    const result = defaults;

    for (const key of ["fines", "tolls", "ferry", "train"] as const) {
        const bucket = source[key];
        if (
            bucket &&
            typeof bucket === "object" &&
            typeof (bucket as any).count === "number" &&
            typeof (bucket as any).amount === "number"
        ) {
            result[key] = {
                count: (bucket as any).count,
                amount: (bucket as any).amount,
            };
        }
    }

    return result;
}

function persist() {
    if (typeof localStorage === "undefined") return;

    try {
        localStorage.setItem(
            TRIP_LOG_KEY,
            JSON.stringify({
                trips: tripLogState.trips,
                totals: tripLogState.totals,
                nextId: tripLogState.nextId,
            }),
        );
        localStorage.setItem(
            ACHIEVEMENTS_KEY,
            JSON.stringify(tripLogState.unlocked),
        );
    } catch {
        // Storage full or unavailable: stats stay in memory for this session.
    }
}

function ensureLoaded() {
    if (tripLogState.loaded || typeof localStorage === "undefined") return;
    tripLogState.loaded = true;

    try {
        const raw = localStorage.getItem(TRIP_LOG_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.trips)) {
                tripLogState.trips = parsed.trips.filter(isTripRecord);
            }
            tripLogState.totals = normalizeTotals(parsed?.totals);
            if (typeof parsed?.nextId === "number") {
                tripLogState.nextId = parsed.nextId;
            }
        }

        const unlockedRaw = localStorage.getItem(ACHIEVEMENTS_KEY);
        if (unlockedRaw) {
            const parsed = JSON.parse(unlockedRaw);
            if (parsed && typeof parsed === "object") {
                tripLogState.unlocked = parsed;
            }
        }
    } catch {
        // Corrupt storage: fall back to the in-memory defaults.
    }
}

export function useTripLog() {
    ensureLoaded();

    /**
     * Starts accumulating the current job if none is active; otherwise a
     * no-op (called on every telemetry packet while a job is running).
     */
    function beginTripIfIdle(snapshot: {
        game: string;
        sourceCity: string;
        destinationCity: string;
        cargoName: string;
        cargoMassKg: number;
    }) {
        if (activeTrip) return;
        activeTrip = createTripAccumulator(
            snapshot.game,
            snapshot.sourceCity,
            snapshot.destinationCity,
            snapshot.cargoName,
            snapshot.cargoMassKg,
        );
    }

    function hasActiveTrip() {
        return activeTrip !== null;
    }

    /**
     * Attributes one economy event: always into the global totals, and into
     * the active trip's expenses when the job is running. Returns any
     * achievements that just unlocked so the caller can announce them.
     */
    function recordEconomyEvent(
        kind: "fine" | "toll" | "ferry" | "train",
        amount: number,
        isOnJob: boolean,
    ): AchievementDef[] {
        const bucket =
            kind === "fine"
                ? tripLogState.totals.fines
                : kind === "toll"
                  ? tripLogState.totals.tolls
                  : tripLogState.totals[kind];
        bucket.count++;
        bucket.amount += amount;

        if (isOnJob && activeTrip) {
            applyTripExpense(activeTrip, kind, amount);
        }

        const unlockedNow = evaluateNewAchievements(
            computeTripStats(tripLogState.trips),
            tripLogState.totals,
            tripLogState.unlocked,
        );
        for (const def of unlockedNow) {
            tripLogState.unlocked[def.id] = Date.now();
        }

        persist();
        return unlockedNow;
    }

    /**
     * Closes the active trip: stores the record when delivery data exists,
     * otherwise discards the accumulator. Returns any newly unlocked
     * achievements.
     */
    function endTrip(delivery: TripDeliveryData | null): AchievementDef[] {
        const accumulator = activeTrip;
        activeTrip = null;

        if (!accumulator || !delivery) return [];

        const record = finalizeTripRecord(
            accumulator,
            delivery,
            tripLogState.nextId++,
        );
        tripLogState.trips.unshift(record);
        if (tripLogState.trips.length > MAX_TRIPS) {
            tripLogState.trips.splice(MAX_TRIPS);
        }

        const unlockedNow = evaluateNewAchievements(
            computeTripStats(tripLogState.trips),
            tripLogState.totals,
            tripLogState.unlocked,
        );
        for (const def of unlockedNow) {
            tripLogState.unlocked[def.id] = Date.now();
        }

        persist();
        return unlockedNow;
    }

    function clearAll() {
        tripLogState.trips = [];
        tripLogState.totals = defaultEconomyTotals();
        tripLogState.unlocked = {};
        tripLogState.nextId = 1;
        persist();
    }

    return {
        trips: toRef(tripLogState, "trips"),
        totals: toRef(tripLogState, "totals"),
        unlocked: toRef(tripLogState, "unlocked"),
        beginTripIfIdle,
        hasActiveTrip,
        recordEconomyEvent,
        endTrip,
        clearAll,
        computeStats: () => computeTripStats(tripLogState.trips),
    };
}
