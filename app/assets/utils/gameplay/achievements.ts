// Local, offline achievement definitions. Checks run against aggregated
// trip stats plus the global economy totals; no accounts, no network.
import type { TripStats } from "./stats";

export interface EconomyTotals {
    fines: { count: number; amount: number };
    tolls: { count: number; amount: number };
    ferry: { count: number; amount: number };
    train: { count: number; amount: number };
}

export function defaultEconomyTotals(): EconomyTotals {
    return {
        fines: { count: 0, amount: 0 },
        tolls: { count: 0, amount: 0 },
        ferry: { count: 0, amount: 0 },
        train: { count: 0, amount: 0 },
    };
}

export interface AchievementDef {
    id: string;
    icon: string;
    titleKey: string;
    descKey: string;
    check: (stats: TripStats, totals: EconomyTotals) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
    {
        id: "first-delivery",
        icon: "lucide:trophy",
        titleKey: "achievements.firstDelivery.title",
        descKey: "achievements.firstDelivery.desc",
        check: (stats) => stats.deliveredCount >= 1,
    },
    {
        id: "road-warrior",
        icon: "lucide:milestone",
        titleKey: "achievements.roadWarrior.title",
        descKey: "achievements.roadWarrior.desc",
        check: (stats) => stats.totalDistanceKm >= 1000,
    },
    {
        id: "trucking-tycoon",
        icon: "lucide:banknote",
        titleKey: "achievements.truckingTycoon.title",
        descKey: "achievements.truckingTycoon.desc",
        check: (stats) => stats.totalRevenue >= 100000,
    },
    {
        id: "glass-transporter",
        icon: "lucide:package-check",
        titleKey: "achievements.glassTransporter.title",
        descKey: "achievements.glassTransporter.desc",
        check: (stats) => stats.zeroDamageStreak >= 10,
    },
    {
        id: "law-abiding",
        icon: "lucide:shield-check",
        titleKey: "achievements.lawAbiding.title",
        descKey: "achievements.lawAbiding.desc",
        check: (stats) => stats.noFineStreak >= 10,
    },
    {
        id: "old-salt",
        icon: "lucide:ship",
        titleKey: "achievements.oldSalt.title",
        descKey: "achievements.oldSalt.desc",
        check: (_stats, totals) => totals.ferry.count >= 10,
    },
];

/** Returns the definitions that just unlocked (were not unlocked before). */
export function evaluateNewAchievements(
    stats: TripStats,
    totals: EconomyTotals,
    unlocked: Record<string, number>,
): AchievementDef[] {
    return ACHIEVEMENTS.filter(
        (def) => !(def.id in unlocked) && def.check(stats, totals),
    );
}
