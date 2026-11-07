<script lang="ts" setup>
import type { RouteAlternativeSummary } from "~/assets/utils/routing/routeAlternatives";

const props = defineProps<{
    isSheetHidden: boolean;
    truckSpeed: number;
    speedLimit: number;
    destinationName: string;
    routeEta: string;
    routeDistance: number;
    isNavigating: boolean;
    alternatives?: RouteAlternativeSummary[] | null;
    primarySummary?: RouteAlternativeSummary | null;
    onStopNavigation: () => void;
    onStartNavigation: () => void;
    onSelectAlternative: (kind: string) => void;
}>();

const { kmToUserUnits, distanceUnit } = useUnitConversion();
const { t } = useTranslations();

const countdown = ref(5);
const progress = ref(100);

const routeDistanceConverted = computed(() =>
    kmToUserUnits(props.routeDistance),
);

// AMap-style comparison badges: each alternative is described only by its
// deltas against the primary route (time, toll gates, ferries, distance).
const alternativeDeltas = computed(() => {
    const primary = props.primarySummary;
    if (!primary) return [];

    return (props.alternatives ?? []).map((alt) => {
        const parts: string[] = [];

        const deltaMin = Math.round(alt.gameMinutes - primary.gameMinutes);
        if (deltaMin !== 0) {
            parts.push(
                deltaMin < 0
                    ? t("map.altFaster", { n: -deltaMin })
                    : t("map.altSlower", { n: deltaMin }),
            );
        }

        const deltaTolls = alt.tollCount - primary.tollCount;
        if (deltaTolls < 0) {
            parts.push(t("map.altFewerTollGates", { n: -deltaTolls }));
        }

        const deltaFerries = alt.ferryCount - primary.ferryCount;
        if (deltaFerries < 0) {
            parts.push(t("map.altFewerFerryCrossings", { n: -deltaFerries }));
        }

        const deltaKm = alt.km - primary.km;
        if (Math.abs(deltaKm) >= 1) {
            const converted = Math.abs(Math.round(kmToUserUnits(deltaKm)));
            parts.push(
                deltaKm < 0
                    ? t("map.altShorter", { n: converted })
                    : t("map.altLonger", { n: converted }),
            );
        }

        return {
            kind: alt.kind,
            name:
                alt.kind === "tolls"
                    ? t("map.altFewerTolls")
                    : t("map.altFewerFerries"),
            meta: parts.join(" · ") || t("map.altSameRoute"),
        };
    });
});

const onAlternativeClick = (kind: string) => {
    if (!props.isNavigating) {
        props.onSelectAlternative(kind);
    }
};

const emit = defineEmits<{
    (e: "update:isSheetHidden", value: boolean): void;
    (e: "update:isSheetExpanded", value: boolean): void;
    (e: "update:addStopClicked"): void;
}>();

const onToggleSheetHidden = () => {
    emit("update:isSheetHidden", !props.isSheetHidden);
};

const handleAddStopClick = () => {
    onToggleSheetHidden();
    emit("update:addStopClicked");
};

const cancelAutoStart = () => {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    countdown.value = 0;
    progress.value = 0;
};

let rafId: number | null = null;
const startSmoothTimer = () => {
    const duration = 5000;
    const startTime = Date.now();

    const frame = () => {
        const timePassed = Date.now() - startTime;
        const remaining = Math.max(0, duration - timePassed);

        countdown.value = Math.ceil(remaining / 1000);
        progress.value = (remaining / duration) * 100;

        if (remaining > 0) {
            rafId = requestAnimationFrame(frame);
        } else {
            cancelAutoStart();
            props.onStartNavigation();
        }
    };

    rafId = requestAnimationFrame(frame);
};

onMounted(() => {
    if (!props.isNavigating) {
        startSmoothTimer();
    }
});

watch(
    () => props.isNavigating,
    (navigating) => {
        if (navigating) cancelAutoStart();
    },
);
</script>

<template>
    <div class="bottom-sheet" :class="{ 'is-hidden': isSheetHidden }">
        <div class="sheet-body">
            <Transition name="compact-slide">
                <CompactTrip
                    v-if="isSheetHidden"
                    v-on:click="onToggleSheetHidden"
                    class="compact-trip-progress"
                    :route-distance-converted="routeDistanceConverted"
                    :distance-unit="distanceUnit"
                    :route-eta="routeEta"
                />
            </Transition>

            <div class="sheet-content">
                <div class="top-row">
                    <h2 class="dest-name">{{ destinationName }}</h2>

                    <div class="hide-sheet">
                        <button
                            v-show="!isSheetHidden"
                            @click.prevent="onToggleSheetHidden"
                            class="hide-sheet-btn nav-btn"
                        >
                            <Icon
                                name="lucide:chevron-down"
                                class="chevron-icon"
                                size="20"
                            />
                            {{ t("common.hide") }}
                        </button>
                    </div>
                </div>

                <div class="separator"></div>

                <div class="full-stats">
                    <div class="stat-block">
                        <Icon
                            name="lucide:clock-check"
                            size="26"
                            class="icon-eta"
                        />
                        <div>
                            <div class="value">{{ routeEta }}</div>
                            <div class="label route-distance">
                                {{ routeDistanceConverted }} {{ distanceUnit }}
                            </div>
                        </div>
                    </div>

                    <HudButton
                        type="text-btn"
                        class="darker"
                        v-on:click="handleAddStopClick"
                    >
                        <Icon name="lucide:map-pin-plus" size="22" />
                        <span>{{ t("map.addStop") }}</span>
                    </HudButton>
                </div>

                <div
                    v-if="!isNavigating && alternativeDeltas.length > 0"
                    class="alt-row"
                >
                    <button
                        class="alt-chip alt-chip-primary"
                        @click.prevent="onAlternativeClick('primary')"
                    >
                        <span class="alt-name">{{
                            t("map.altRecommended")
                        }}</span>
                    </button>
                    <button
                        v-for="alt in alternativeDeltas"
                        :key="alt.kind"
                        class="alt-chip"
                        @click.prevent="onAlternativeClick(alt.kind)"
                    >
                        <span class="alt-name">{{ alt.name }}</span>
                        <span class="alt-meta">{{ alt.meta }}</span>
                    </button>
                </div>

                <div class="action-buttons">
                    <button
                        v-show="isNavigating"
                        class="stop-btn nav-btn"
                        @click.prevent="onStopNavigation"
                    >
                        <span>{{ t("common.stop") }}</span>
                    </button>

                    <button
                        class="start-btn nav-btn"
                        :style="{ '--progress': progress + `%` }"
                        @click.prevent="onStartNavigation"
                    >
                        <Icon name="lucide:map-pin-check" size="24" />
                        <span>{{
                            isNavigating
                                ? t("common.resume")
                                : t("common.startNavigation")
                        }}</span>
                        <span
                            v-if="countdown > 0 && !isNavigating"
                            style="margin-left: 5px; opacity: 0.8"
                        >
                            ({{ countdown }}s)
                        </span>
                    </button>

                    <button v-show="countdown > 0" @click="cancelAutoStart">
                        <Icon
                            name="lucide:x"
                            size="28"
                            class="cancel-timer-icon"
                        />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/sheetSlide.scss"
></style>
