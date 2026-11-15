<script lang="ts" setup>
import { computeDriveReport } from "~/assets/utils/gameplay/stats";

const emit = defineEmits<{
    (e: "close"): void;
}>();

const { t } = useTranslations();
const { settings, activeSettings } = useSettings();
const { kmToUserUnits } = useUnitConversion();
const { trips, unlocked, sessionStart } = useTripLog();
const {
    driveReportAiEnabled,
    driveReportAiState,
    ensureDriveReportNarration,
    cancelDriveReportNarration,
} = useAI();

// AMap DriveReport-style summary of the current app session ("this drive"):
// every trip whose id is above the session anchor, plus achievements that
// unlocked after the session started.
const report = computed(() =>
    computeDriveReport(trips.value, sessionStart.maxTripId),
);

const newAchievements = computed(
    () =>
        Object.values(unlocked.value).filter(
            (unlockedAt) => unlockedAt > sessionStart.wallMs,
        ).length,
);

const hasActivity = computed(
    () => report.value.deliveredCount + report.value.cancelledCount > 0,
);

const currencySymbol = computed(() =>
    settings.value.selectedGame === "ats" ? "$" : "€",
);

const money = (value: number) =>
    `${value.toLocaleString()} ${currencySymbol.value}`;

const distanceLabel = computed(() =>
    `${kmToUserUnits(report.value.distanceKm)} ${
        activeSettings.value.units === "imperial" ? "mi" : "km"
    }`,
);

// Wall-clock duration of the session, refreshed every 30 s while open.
const now = ref(Date.now());
let durationTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    durationTimer = setInterval(() => {
        now.value = Date.now();
    }, 30000);
});
onUnmounted(() => {
    if (durationTimer) clearInterval(durationTimer);
});

// AI notes: generate once per session anchor while the card is open; a
// newly completed trip bumps the anchor and refreshes the narration.
// ensureDriveReportNarration() guards availability itself, so the card
// just requests it and hides the block on any failure.
const aiNotesVisible = computed(
    () =>
        hasActivity.value &&
        driveReportAiEnabled.value &&
        (driveReportAiState.status === "loading" ||
            driveReportAiState.status === "ready"),
);

onMounted(ensureDriveReportNarration);
watch(() => sessionStart.maxTripId, ensureDriveReportNarration);
onUnmounted(cancelDriveReportNarration);

const sessionDurationLabel = computed(() => {
    const minutes = Math.max(
        1,
        Math.round((now.value - sessionStart.wallMs) / 60000),
    );
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
});
</script>

<template>
    <div class="drive-report-card">
        <button class="close-btn" @click.prevent="emit('close')">
            <Icon name="lucide:x" size="18" />
        </button>

        <div class="header">
            <div class="header-icon">
                <Icon name="lucide:clipboard-list" size="26" />
            </div>

            <div class="header-text">
                <h3>{{ t("driveReport.title") }}</h3>
                <span class="session-line">
                    {{ t("driveReport.sessionDuration") }} {{ sessionDurationLabel }}
                </span>
            </div>
        </div>

        <template v-if="hasActivity">
            <div
                class="amount"
                :class="report.netIncome >= 0 ? 'ok' : 'bad'"
            >
                {{ report.netIncome >= 0 ? "+" : "-" }}{{ money(Math.abs(report.netIncome)) }}
            </div>

            <div class="chips">
                <span class="chip">
                    <Icon name="lucide:truck" size="14" />
                    {{ t("driveReport.deliveredJobs") }} {{ report.deliveredCount
                    }}<template v-if="report.cancelledCount > 0">
                        · {{ t("driveReport.cancelledJobs") }}
                        {{ report.cancelledCount }}</template
                    >
                </span>

                <span class="chip">
                    <Icon name="lucide:route" size="14" />
                    {{ t("driveReport.distance") }} {{ distanceLabel }}
                </span>

                <span class="chip">
                    <Icon name="lucide:coins" size="14" />
                    {{ t("driveReport.income") }} {{ money(report.grossIncome) }}
                </span>

                <span
                    v-if="report.penalty + report.fines > 0"
                    class="chip bad"
                >
                    <Icon name="lucide:receipt" size="14" />
                    {{ t("driveReport.fines") }} {{ report.finesCount }} ·
                    {{ money(report.fines) }}
                </span>

                <span
                    v-if="report.tolls + report.ferry + report.train > 0"
                    class="chip"
                >
                    <Icon name="lucide:receipt" size="14" />
                    {{ t("driveReport.expenses") }}
                    {{ money(report.tolls + report.ferry + report.train) }}
                </span>

                <span
                    class="chip"
                    :class="{ bad: report.avgCargoDamage > 0 }"
                >
                    <Icon
                        :name="
                            report.avgCargoDamage > 0
                                ? 'lucide:package-x'
                                : 'lucide:package-check'
                        "
                        size="14"
                    />
                    {{ t("driveReport.avgCargoDamage") }}
                    {{ Math.round(report.avgCargoDamage) }}%
                </span>

                <span v-if="newAchievements > 0" class="chip bonus">
                    <Icon name="lucide:sparkles" size="14" />
                    {{ t("driveReport.newAchievements") }} {{ newAchievements }}
                </span>
            </div>

            <div v-if="aiNotesVisible" class="ai-notes">
                <div class="ai-notes-header">
                    <Icon name="lucide:sparkles" size="14" />
                    <span>{{ t("driveReport.aiTitle") }}</span>
                </div>

                <p
                    v-if="driveReportAiState.status === 'loading'"
                    class="ai-notes-loading"
                >
                    {{ t("driveReport.aiLoading") }}
                </p>

                <template v-else-if="driveReportAiState.narration">
                    <p class="ai-notes-summary">
                        {{ driveReportAiState.narration.summary }}
                    </p>

                    <p
                        v-for="(tip, index) in driveReportAiState.narration.tips"
                        :key="index"
                        class="ai-notes-tip"
                    >
                        <Icon name="lucide:lightbulb" size="14" />
                        <span>{{ tip }}</span>
                    </p>
                </template>
            </div>
        </template>

        <p v-else class="empty">{{ t("driveReport.empty") }}</p>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/driveReportCard.scss"
></style>
