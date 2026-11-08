<script lang="ts" setup>
const props = defineProps<{
    jobKey: string;
    cargoName: string;
    cargoMassKg: number;
    cargoDamage: number;
    income: number;
    remainingMinutes: number | null;
    etaMinutes: number | null;
    sourceCityName: string;
    sourceCompanyName: string;
    destinationCityName: string;
    destinationCompanyName: string;
    /** The next user waypoint still ahead: its name (nearest city), km and
     * its share of the route's remaining minutes. */
    nextStop?: { name: string | null; kmAhead: number; minutes: number } | null;
}>();

const { activeSettings, settings } = useSettings();
const { t } = useTranslations();

const isCollapsed = ref(false);

watch(
    () => props.jobKey,
    () => {
        isCollapsed.value = false;
    },
);

const massLabel = computed(() => {
    if (activeSettings.value.units === "imperial") {
        const lb = Math.round(props.cargoMassKg * 2.20462);
        return `${lb.toLocaleString()} lb`;
    }
    const tons = props.cargoMassKg / 1000;
    return `${tons.toLocaleString(undefined, {
        maximumFractionDigits: 1,
    })} t`;
});

const currencySymbol = computed(() =>
    settings.value.selectedGame === "ats" ? "$" : "€",
);

const incomeLabel = computed(() => {
    if (props.income <= 0) return "—";
    return `${props.income.toLocaleString()} ${currencySymbol.value}`;
});

const deadlineLabel = computed(() => {
    const minutes = props.remainingMinutes;
    if (minutes === null) return null;
    if (minutes < 0) return t("job.overdue");

    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
});

const deadlineLevel = computed<"ok" | "warn" | "danger" | "overdue">(() => {
    const minutes = props.remainingMinutes;
    if (minutes === null) return "ok";
    if (minutes < 0) return "overdue";
    if (minutes < 20) return "danger";
    if (minutes < 60) return "warn";

    const eta = props.etaMinutes;
    if (eta !== null && minutes < eta) return "warn";

    return "ok";
});

const damagePercent = computed(() => Math.round(props.cargoDamage));

const { kmToUserUnits, distanceUnit } = useUnitConversion();

const nextStopLabel = computed(() => {
    const stop = props.nextStop;
    if (!stop) return null;
    const h = Math.floor(stop.minutes / 60);
    const m = Math.round(stop.minutes % 60);
    const eta = h > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min`;
    return `${t("job.nextStop")} · ${stop.name ?? "—"} · ${kmToUserUnits(stop.kmAhead)} ${distanceUnit.value} · ~${eta}`;
});

const destinationLine = computed(() => {
    const city = props.destinationCityName || props.destinationCompanyName;
    return city || t("job.unknownDestination");
});

const sourceLine = computed(() => {
    const city = props.sourceCityName || props.sourceCompanyName;
    return city || t("job.unknownSource");
});
</script>

<template>
    <div class="job-card" :class="{ collapsed: isCollapsed }">
        <button class="collapse-btn" @click.prevent="isCollapsed = !isCollapsed">
            <Icon
                :name="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'"
                size="18"
            />
        </button>

        <div class="compact-row">
            <Icon name="lucide:package" size="18" class="compact-icon" />
            <span class="compact-cargo">{{ cargoName || t("job.cargo") }}</span>
            <span class="compact-sep">•</span>
            <span class="compact-dest">{{ destinationLine }}</span>
        </div>

        <div class="full-body">
            <div class="cargo-row">
                <Icon name="lucide:package" size="24" class="cargo-icon" />
                <div class="cargo-text">
                    <span class="cargo-name">{{
                        cargoName || t("job.cargo")
                    }}</span>
                    <span class="cargo-mass">{{ massLabel }}</span>
                </div>
            </div>

            <div class="route-row">
                <Icon name="lucide:route" size="16" class="route-icon" />
                <span class="route-source">{{ sourceLine }}</span>
                <Icon
                    name="lucide:chevron-right"
                    size="14"
                    class="route-arrow"
                />
                <span class="route-destination">{{ destinationLine }}</span>
            </div>

            <div v-if="nextStopLabel" class="stop-row">
                <Icon name="lucide:map-pin" size="15" class="stop-icon" />
                <span class="stop-label">{{ nextStopLabel }}</span>
            </div>

            <div class="stats-row">
                <div class="stat">
                    <Icon name="lucide:coins" size="16" />
                    <span class="stat-value income">{{ incomeLabel }}</span>
                </div>

                <div
                    v-if="deadlineLabel"
                    class="stat deadline"
                    :class="`level-${deadlineLevel}`"
                >
                    <Icon name="lucide:clock-alert" size="16" />
                    <span class="stat-value">{{ deadlineLabel }}</span>
                </div>
            </div>

            <div v-if="damagePercent > 0" class="damage-row">
                <Icon name="lucide:package-x" size="16" />
                <div class="damage-track">
                    <div
                        class="damage-fill"
                        :class="{ 'is-bad': damagePercent > 50 }"
                        :style="{ width: damagePercent + '%' }"
                    ></div>
                </div>
                <span class="damage-value">{{ damagePercent }}%</span>
            </div>
        </div>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/jobCard.scss"
></style>
