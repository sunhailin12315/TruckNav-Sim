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
 * Builds the drive-report narration context: the session's aggregated
 * report, its trips in chronological order (newest-first input), and
 * lifetime stats for trend comparisons.
 *
 * `fineReasons` are recent feed fine labels; they are only included while
 * the feed doesn't know about more fines than the session report counted,
 * so labels from earlier sessions can't leak into the narration.
 */
export function buildDriveReportContext(
    report: DriveReport,
    sessionTrips: TripRecord[],
    lifetime: TripStats,
    fineReasons: string[],
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
        },
        session: {
            deliveredCount: session.deliveredCount,
            netIncome: Math.round(session.netIncome),
            finesCount: session.finesCount,
        },
    });
}
