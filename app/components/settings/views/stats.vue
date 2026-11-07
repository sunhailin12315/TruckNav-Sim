<script lang="ts" setup>
import { computeTripStats } from "~/assets/utils/gameplay/stats";
import { ACHIEVEMENTS } from "~/assets/utils/gameplay/achievements";
import {
    currencySymbolFor,
    formatMoney,
} from "~/assets/utils/shared/format";

const { trips, totals, unlocked, clearAll } = useTripLog();
const { activeSettings, settings } = useSettings();
const { t } = useTranslations();
const { kmToUserUnits, distanceUnit } = useUnitConversion();

const CONFIRM_WINDOW_MS = 3000;

const stats = computed(() => computeTripStats(trips.value));

const currencySymbol = computed(() =>
    currencySymbolFor(settings.value.selectedGame),
);

const money = (amount: number) => formatMoney(amount, currencySymbol.value);

const distanceLabel = computed(() => {
    const value = kmToUserUnits(Math.round(stats.value.totalDistanceKm));
    return `${value.toLocaleString()} ${distanceUnit.value}`;
});

const avgDamageLabel = computed(() =>
    `${stats.value.avgCargoDamage.toFixed(1)}%`,
);

const netIncome = computed(
    () =>
        stats.value.totalRevenue -
        stats.value.totalPenalty -
        stats.value.finesTotal -
        stats.value.tollsTotal -
        stats.value.ferryTotal -
        stats.value.trainTotal,
);

const achievementRows = computed(() =>
    ACHIEVEMENTS.map((def) => ({
        id: def.id,
        icon: def.icon,
        title: t(def.titleKey),
        description: t(def.descKey),
        unlocked: def.id in unlocked.value,
    })),
);

const recentTrips = computed(() =>
    trips.value.slice(0, 20).map((trip) => ({
        id: trip.id,
        title:
            trip.kind === "delivered"
                ? `${trip.sourceCity} → ${trip.destinationCity}`
                : `${trip.sourceCity} → ${trip.destinationCity} (${t(
                      "events.cancelled",
                  )})`,
        amount:
            trip.kind === "delivered"
                ? `+${money(trip.income)}`
                : `-${money(trip.penalty)}`,
        good: trip.kind === "delivered",
        damage: trip.cargoDamage > 0 ? `${Math.round(trip.cargoDamage)}%` : "",
        distance: trip.distanceKm
            ? `${kmToUserUnits(Math.round(trip.distanceKm))} ${distanceUnit.value}`
            : "",
        time: trip.completedAt,
    })),
);

// Two-tap confirm so a stray click cannot wipe months of history.
const isClearArmed = ref(false);
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function onClearClicked() {
    if (isClearArmed.value) {
        clearAll();
        isClearArmed.value = false;
        if (clearTimer) clearTimeout(clearTimer);
        return;
    }

    isClearArmed.value = true;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
        isClearArmed.value = false;
    }, CONFIRM_WINDOW_MS);
}

onUnmounted(() => {
    if (clearTimer) clearTimeout(clearTimer);
});
</script>

<template>
    <div class="stats-view">
        <div class="stats-grid">
            <div class="stat-cell">
                <span class="stat-value">{{
                    stats.deliveredCount.toLocaleString()
                }}</span>
                <span class="stat-label">{{ t("stats.delivered") }}</span>
            </div>

            <div class="stat-cell">
                <span class="stat-value">{{
                    stats.cancelledCount.toLocaleString()
                }}</span>
                <span class="stat-label">{{ t("stats.cancelled") }}</span>
            </div>

            <div class="stat-cell">
                <span class="stat-value">{{ distanceLabel }}</span>
                <span class="stat-label">{{ t("stats.distance") }}</span>
            </div>

            <div class="stat-cell">
                <span class="stat-value good">{{
                    money(stats.totalRevenue)
                }}</span>
                <span class="stat-label">{{ t("stats.revenue") }}</span>
            </div>

            <div class="stat-cell">
                <span class="stat-value bad">{{
                    money(
                        stats.finesTotal +
                            stats.tollsTotal +
                            stats.ferryTotal +
                            stats.trainTotal,
                    )
                }}</span>
                <span class="stat-label">{{ t("stats.expenses") }}</span>
            </div>

            <div class="stat-cell">
                <span
                    class="stat-value"
                    :class="netIncome >= 0 ? 'good' : 'bad'"
                    >{{ money(netIncome) }}</span
                >
                <span class="stat-label">{{ t("stats.net") }}</span>
            </div>

            <div class="stat-cell">
                <span class="stat-value">{{ avgDamageLabel }}</span>
                <span class="stat-label">{{ t("stats.avgDamage") }}</span>
            </div>
        </div>

        <div class="section-title">
            <Icon name="lucide:trophy" size="18" />
            <span>{{ t("stats.achievements") }}</span>
        </div>

        <div class="achievement-list">
            <div
                v-for="achievement in achievementRows"
                :key="achievement.id"
                class="achievement-row"
                :class="{ unlocked: achievement.unlocked }"
            >
                <Icon
                    :name="achievement.unlocked ? achievement.icon : 'lucide:lock'"
                    size="20"
                    class="achievement-icon"
                />
                <div class="achievement-text">
                    <span class="achievement-title">{{
                        achievement.title
                    }}</span>
                    <span class="achievement-desc">{{
                        achievement.description
                    }}</span>
                </div>
            </div>
        </div>

        <div class="section-title">
            <Icon name="lucide:history" size="18" />
            <span>{{ t("stats.trips") }}</span>
        </div>

        <p v-if="recentTrips.length === 0" class="stats-empty">
            {{ t("stats.empty") }}
        </p>

        <div v-else class="trip-list">
            <div v-for="trip in recentTrips" :key="trip.id" class="trip-row">
                <div class="trip-main">
                    <span class="trip-title">{{ trip.title }}</span>
                    <span class="trip-meta">
                        {{ trip.distance }}
                        <template v-if="trip.damage">
                            · {{ t("stats.cargoDamageShort") }} {{ trip.damage }}
                        </template>
                        <template v-if="trip.time"> · {{ trip.time }}</template>
                    </span>
                </div>
                <span class="trip-amount" :class="{ good: trip.good }">{{
                    trip.amount
                }}</span>
            </div>
        </div>

        <button
            class="clear-btn"
            :class="{ armed: isClearArmed }"
            @click.prevent="onClearClicked"
        >
            <Icon name="lucide:rotate-ccw" size="16" />
            {{
                isClearArmed ? t("stats.clearConfirm") : t("stats.clear")
            }}
        </button>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/settings/statsView.scss"
></style>
