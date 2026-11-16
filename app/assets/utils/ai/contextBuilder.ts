// ---------------------------------------------------------------
// Context builders: trim already-in-memory business data into the
// compact JSON the AI prompts consume. Pure and unit-testable; only
// aggregates and names ever leave the app — no coordinates, no raw
// telemetry streams (docs/ai-features.md §2/§5.2).
// ---------------------------------------------------------------

import type { DriveReport, TripStats } from "../gameplay/stats";
import type { TripRecord } from "../gameplay/tripLog";
import type { DirectionStep } from "../routing/directions";

/** Hard cap so a marathon session can't blow the token budget. */
const MAX_SESSION_TRIPS = 15;
const MAX_FINE_REASONS = 6;

/**
 * Normalized baseline over the trips completed BEFORE this session, for
 * trend comparisons in the drive-report narration. Averages are over
 * delivered trips only (like the session figures); finesPerTrip covers
 * every trip. Built by the caller; omitted from the context when too
 * little history exists.
 */
export interface PreviousSessionBaseline {
    trips: number;
    avgIncome: number;
    avgDistanceKm: number;
    avgCargoDamagePct: number;
    finesPerTrip: number;
}

/** Below this many earlier trips, "trend" claims would be noise. */
const MIN_PREVIOUS_TRIPS = 3;

/** Cap so a huge history can't skew the baseline toward ancient trips;
 * the most recent earlier trips are the relevant comparison. */
const MAX_PREVIOUS_TRIPS = 10;

/**
 * Derives the trend baseline from trips completed BEFORE the current
 * session. `earlierTrips` is newest-first (as stored). Income/damage/
 * distance average over delivered trips only — cancelled jobs distort the
 * money figure — while finesPerTrip counts every trip. Returns null when
 * there is too little history to compare against.
 */
export function computePreviousBaseline(
    earlierTrips: TripRecord[],
): PreviousSessionBaseline | null {
    const window = earlierTrips.slice(0, MAX_PREVIOUS_TRIPS);
    if (window.length < MIN_PREVIOUS_TRIPS) return null;

    let delivered = 0;
    let incomeSum = 0;
    let distanceSum = 0;
    let damageSum = 0;
    let finesCount = 0;

    for (const trip of window) {
        if (trip.kind === "delivered") {
            delivered++;
            incomeSum += trip.income;
            distanceSum += trip.distanceKm;
            damageSum += trip.cargoDamage;
        }
        finesCount += trip.expenses.finesCount;
    }

    const base = delivered > 0 ? delivered : 1;
    return {
        trips: window.length,
        avgIncome: incomeSum / base,
        avgDistanceKm: distanceSum / base,
        avgCargoDamagePct: damageSum / base,
        finesPerTrip: finesCount / window.length,
    };
}

/**
 * Builds the drive-report narration context: the session's aggregated
 * report, its trips in chronological order (newest-first input), and
 * lifetime stats for trend comparisons.
 *
 * `fineReasons` are recent feed fine labels; they are only included while
 * the feed doesn't know about more fines than the session report counted,
 * so labels from earlier sessions can't leak into the narration.
 *
 * `previous` is the baseline over earlier trips (docs/ai-features.md §11);
 * it is dropped when it lacks enough history to ground a comparison.
 */
export function buildDriveReportContext(
    report: DriveReport,
    sessionTrips: TripRecord[],
    lifetime: TripStats,
    fineReasons: string[],
    previous?: PreviousSessionBaseline | null,
): string {
    const sessionFineReasons =
        fineReasons.length > 0 && fineReasons.length <= report.finesCount
            ? fineReasons.slice(0, MAX_FINE_REASONS)
            : [];
    const trips = [...sessionTrips]
        .reverse()
        .slice(-MAX_SESSION_TRIPS)
        .map((trip) => ({
            from: trip.sourceCity,
            to: trip.destinationCity,
            cargo: trip.cargoName,
            massT: Math.round((trip.cargoMassKg / 1000) * 10) / 10,
            income: Math.round(trip.income),
            distanceKm: Math.round(trip.distanceKm),
            cancelled: trip.kind === "cancelled",
            cargoDamagePct: Math.round(trip.cargoDamage),
            finesCount: trip.expenses.finesCount,
        }));

    const lifetimeDelivered = Math.max(0, lifetime.deliveredCount);

    return JSON.stringify({
        session: {
            delivered: report.deliveredCount,
            cancelled: report.cancelledCount,
            distanceKm: Math.round(report.distanceKm),
            grossIncome: Math.round(report.grossIncome),
            netIncome: Math.round(report.netIncome),
            penalty: Math.round(report.penalty),
            fines: {
                count: report.finesCount,
                total: Math.round(report.fines),
                ...(sessionFineReasons.length > 0
                    ? { reasons: sessionFineReasons }
                    : {}),
            },
            tolls: Math.round(report.tolls),
            ferry: Math.round(report.ferry),
            train: Math.round(report.train),
            avgCargoDamagePct: round1(report.avgCargoDamage),
            trips,
        },
        lifetime: {
            delivered: lifetimeDelivered,
            avgIncomePerDelivered:
                lifetimeDelivered > 0
                    ? Math.round(lifetime.totalRevenue / lifetimeDelivered)
                    : 0,
            avgDistancePerDeliveredKm:
                lifetimeDelivered > 0
                    ? Math.round(
                          lifetime.totalDistanceKm / lifetimeDelivered,
                      )
                    : 0,
            avgCargoDamagePct: round1(lifetime.avgCargoDamage),
            finesTotal: Math.round(lifetime.finesTotal),
        },
        // Trend baseline only when it can carry a real comparison.
        ...(previous && previous.trips >= MIN_PREVIOUS_TRIPS
            ? {
                  previous: {
                      trips: previous.trips,
                      avgIncome: Math.round(previous.avgIncome),
                      avgDistanceKm: Math.round(previous.avgDistanceKm),
                      avgCargoDamagePct: round1(previous.avgCargoDamagePct),
                      finesPerTrip: round1(previous.finesPerTrip),
                  },
              }
            : {}),
    });
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Builds the one-sentence route-insight context for a freshly planned
 * route: distance/ETA, the cities the driver typed or the job carries,
 * and coarse route-shape counters (ferries, roundabouts). No coordinates.
 */
export function buildRouteInsightContext(
    steps: DirectionStep[],
    totalKm: number,
    etaMinutes: number | null,
    destination: string,
): string {
    let ferryCount = 0;
    let roundaboutCount = 0;
    for (const step of steps) {
        if (step.type === "ferry") ferryCount++;
        if (step.type === "roundabout") roundaboutCount++;
    }

    return JSON.stringify({
        totalKm: Math.round(totalKm),
        ...(etaMinutes !== null && etaMinutes > 0
            ? { etaMinutes: Math.round(etaMinutes) }
            : {}),
        ...(destination ? { destination } : {}),
        ...(ferryCount > 0 ? { ferryCount } : {}),
        ...(roundaboutCount > 0 ? { roundaboutCount } : {}),
        turnCount: steps.filter((step) => step.type !== "depart").length,
    });
}

export interface DeliveryNoteInput {
    income: number;
    distanceKm: number;
    cargoDamagePct: number;
    earnedXp: number;
    /** Destination city of the finished job; omitted when empty. */
    destination?: string;
    /** Cargo name; omitted when empty. */
    cargo?: string;
    /** S/A/B/C grade from computeDeliveryGrade; omitted when absent. */
    grade?: string;
    /** Fines on this trip; 0 is still sent (it proves the trip was clean). */
    finesCount: number;
    /** Signed minutes left on the deadline at delivery; null when unknown. */
    remainingMinutes?: number | null;
}

/** Session aggregates the caller computes from the trip log. */
export interface DeliveryNoteSession {
    deliveredCount: number;
    netIncome: number;
    finesCount: number;
}

/** Builds the one-sentence delivery-recap context. */
export function buildDeliveryNoteContext(
    delivery: DeliveryNoteInput,
    session: DeliveryNoteSession,
): string {
    return JSON.stringify({
        delivered: {
            income: Math.round(delivery.income),
            distanceKm: Math.round(delivery.distanceKm),
            cargoDamagePct: Math.round(delivery.cargoDamagePct),
            earnedXp: Math.round(delivery.earnedXp),
            ...(delivery.destination ? { destination: delivery.destination } : {}),
            ...(delivery.cargo ? { cargo: delivery.cargo } : {}),
            ...(delivery.grade ? { grade: delivery.grade } : {}),
            finesCount: delivery.finesCount,
            // Only meaningful when the deadline was tracked: on-time
            // minutes left, or the negative overrun.
            ...(delivery.remainingMinutes !== null &&
            delivery.remainingMinutes !== undefined
                ? { timeLeftMinutes: Math.round(delivery.remainingMinutes) }
                : {}),
        },
        session: {
            deliveredCount: session.deliveredCount,
            netIncome: Math.round(session.netIncome),
            finesCount: session.finesCount,
        },
    });
}

export interface ServiceNoteInput {
    kind: "rest" | "fuel";
    /** Route km ahead of the suggested stop. */
    kmAhead: number;
    detourKm: number;
    detourMinutes: number;
    /** Truck range in km; only sent for fuel suggestions. */
    fuelRangeKm?: number;
    /** Fuel in liters; only sent for fuel suggestions. */
    fuelAmountL?: number;
    /** Minutes of driving time left before forced rest; rest suggestions. */
    nextRestStopMinutes?: number;
}

/**
 * Builds the one-sentence "why stop now" note for a rest/fuel suggestion:
 * the stop placement the rule engine computed plus only the live numbers
 * that justify it for this kind (range/fuel vs fatigue minutes).
 */
export function buildServiceNoteContext(input: ServiceNoteInput): string {
    return JSON.stringify({
        kind: input.kind,
        kmAhead: Math.round(input.kmAhead),
        detourKm: round1(input.detourKm),
        detourMinutes: Math.round(input.detourMinutes),
        ...(input.kind === "fuel" && input.fuelRangeKm !== undefined
            ? { fuelRangeKm: Math.round(input.fuelRangeKm) }
            : {}),
        ...(input.kind === "fuel" && input.fuelAmountL !== undefined
            ? { fuelAmountL: Math.round(input.fuelAmountL) }
            : {}),
        ...(input.kind === "rest" &&
        input.nextRestStopMinutes !== undefined
            ? { nextRestStopMinutes: Math.round(input.nextRestStopMinutes) }
            : {}),
    });
}
