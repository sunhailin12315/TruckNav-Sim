<script lang="ts" setup>
import { currencySymbolFor, formatMoney } from "~/assets/utils/shared/format";
import type { FeedEventKind } from "~/composables/EventFeed";

const { settings } = useSettings();
const { latest } = useEventFeed();
const { t } = useTranslations();

const SHOW_MS = 4000;

const isVisible = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

const KIND_ICONS: Record<FeedEventKind, string> = {
    fine: "lucide:gavel",
    toll: "lucide:receipt",
    ferry: "lucide:ship",
    train: "lucide:train-front",
    delivered: "lucide:package-check",
    cancelled: "lucide:triangle-alert",
    achievement: "lucide:trophy",
};

const KIND_TITLE_KEYS: Record<FeedEventKind, string> = {
    fine: "events.fine",
    toll: "events.toll",
    ferry: "events.ferry",
    train: "events.train",
    delivered: "events.delivered",
    cancelled: "events.cancelled",
    achievement: "events.achievement",
};

const icon = computed(() =>
    latest.value ? KIND_ICONS[latest.value.kind] : "lucide:bell",
);

const title = computed(() =>
    latest.value ? t(KIND_TITLE_KEYS[latest.value.kind]) : "",
);

const amountLabel = computed(() => {
    if (!latest.value || latest.value.amount <= 0) return "";
    return formatMoney(latest.value.amount, currencySymbolFor(settings.value.selectedGame));
});

watch(latest, (event) => {
    if (!event || !settings.value.gameplay.eventFeed) return;

    isVisible.value = true;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        isVisible.value = false;
    }, SHOW_MS);
});
</script>

<template>
    <Transition name="notification-slide">
        <div v-if="isVisible && latest" class="event-toast">
            <Icon :name="icon" size="20" class="toast-icon" />
            <span class="toast-title">{{ title }}</span>
            <span v-if="amountLabel" class="toast-amount">{{
                amountLabel
            }}</span>
        </div>
    </Transition>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/eventToast.scss"
></style>
