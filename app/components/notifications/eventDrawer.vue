<script lang="ts" setup>
import { currencySymbolFor, formatMoney } from "~/assets/utils/shared/format";
import type { FeedEventKind } from "~/composables/EventFeed";

const emit = defineEmits<{
    (e: "close"): void;
}>();

const { settings } = useSettings();
const { events, markEventsRead, clearEventFeed } = useEventFeed();
const { t } = useTranslations();

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

// Kinds that took money away from the driver.
const SPENT_KINDS: FeedEventKind[] = ["fine", "toll", "cancelled"];

const rows = computed(() =>
    events.value.map((event) => ({
        ...event,
        icon: KIND_ICONS[event.kind],
        title: t(KIND_TITLE_KEYS[event.kind]),
        amount: formatMoney(
            event.amount,
            currencySymbolFor(settings.value.selectedGame),
        ),
        spent: SPENT_KINDS.includes(event.kind),
    })),
);

onMounted(() => {
    markEventsRead();
});

const onClear = () => {
    clearEventFeed();
};
</script>

<template>
    <div class="event-drawer">
        <div class="drawer-header">
            <Icon name="lucide:history" size="18" />
            <span class="drawer-title">{{ t("events.history") }}</span>

            <button class="drawer-btn" @click.prevent="onClear">
                <Icon name="lucide:trash-2" size="16" />
            </button>

            <button class="drawer-btn" @click.prevent="emit('close')">
                <Icon name="lucide:x" size="16" />
            </button>
        </div>

        <Transition name="fade">
            <p v-if="rows.length === 0" class="drawer-empty">
                {{ t("events.noEvents") }}
            </p>
        </Transition>

        <div class="drawer-list">
            <TransitionGroup name="feed-item">
                <div v-for="event in rows" :key="event.id" class="event-row">
                    <Icon :name="event.icon" size="18" class="row-icon" />

                    <div class="row-text">
                        <span class="row-title">{{ event.title }}</span>
                        <span
                            v-if="event.label"
                            class="row-label"
                            :title="event.label"
                            >{{ event.label }}</span
                        >
                    </div>

                    <div class="row-right">
                        <span
                            class="row-amount"
                            :class="{ spent: event.spent }"
                            >{{ event.spent ? "-" : "+" }}{{ event.amount }}</span
                        >
                        <span class="row-time">{{ event.gameTime }}</span>
                    </div>
                </div>
            </TransitionGroup>
        </div>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/eventDrawer.scss"
></style>
