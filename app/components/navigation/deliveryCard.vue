<script lang="ts" setup>
import type { DeliveryInfo } from "~/types";

const props = defineProps<{
    info: DeliveryInfo;
}>();

const emit = defineEmits<{
    (e: "dismiss"): void;
}>();

const { t } = useTranslations();
const { settings, activeSettings } = useSettings();
const { kmToUserUnits } = useUnitConversion();

const AUTO_DISMISS_MS = 10000;

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

const isDelivered = computed(() => props.info.kind === "delivered");

const currencySymbol = computed(() =>
    settings.value.selectedGame === "ats" ? "$" : "€",
);

const revenueLabel = computed(
    () =>
        `+${props.info.revenue.toLocaleString()} ${currencySymbol.value}`,
);

const penaltyLabel = computed(
    () =>
        `-${props.info.penalty.toLocaleString()} ${currencySymbol.value}`,
);

const distanceLabel = computed(() => {
    if (!props.info.distanceKm) return null;
    return `${kmToUserUnits(props.info.distanceKm)} ${
        activeSettings.value.units === "imperial" ? "mi" : "km"
    }`;
});

const cargoDamagePercent = computed(() =>
    Math.round(props.info.cargoDamage),
);

function onDismiss() {
    if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
    }
    emit("dismiss");
}

onMounted(() => {
    dismissTimer = setTimeout(onDismiss, AUTO_DISMISS_MS);
});

onUnmounted(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
});
</script>

<template>
    <div class="delivery-card" :class="{ cancelled: !isDelivered }">
        <button class="close-btn" @click.prevent="onDismiss">
            <Icon name="lucide:x" size="18" />
        </button>

        <div class="header">
            <div class="header-icon" :class="isDelivered ? 'ok' : 'bad'">
                <Icon
                    :name="isDelivered ? 'lucide:check' : 'lucide:triangle-alert'"
                    size="26"
                />
            </div>

            <div class="header-text">
                <h3>{{ isDelivered ? t("job.deliveryComplete") : t("job.jobCancelled") }}</h3>
                <span v-if="isDelivered && info.deliveredAt" class="delivered-at">
                    {{ t("job.deliveredAt") }} {{ info.deliveredAt }}
                </span>
            </div>
        </div>

        <div class="amount" :class="isDelivered ? 'ok' : 'bad'">
            {{ isDelivered ? revenueLabel : penaltyLabel }}
        </div>

        <div v-if="isDelivered" class="chips">
            <span v-if="info.earnedXp > 0" class="chip xp">
                <Icon name="lucide:sparkles" size="14" />
                {{ info.earnedXp }} {{ t("job.xp") }}
            </span>

            <span v-if="distanceLabel" class="chip">
                <Icon name="lucide:route" size="14" />
                {{ distanceLabel }}
            </span>

            <span class="chip" :class="{ bad: cargoDamagePercent > 0 }">
                <Icon
                    :name="cargoDamagePercent > 0 ? 'lucide:package-x' : 'lucide:package-check'"
                    size="14"
                />
                {{ t("job.cargoDamage") }} {{ cargoDamagePercent }}%
            </span>

            <span v-if="info.autoParker" class="chip bonus">
                <Icon name="lucide:car-front" size="14" />
                {{ t("job.autoParker") }}
            </span>

            <span v-if="info.autoLoaded" class="chip bonus">
                <Icon name="lucide:forklift" size="14" />
                {{ t("job.autoLoaded") }}
            </span>
        </div>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/deliveryCard.scss"
></style>
