<script lang="ts" setup>
import type { DirectionStep } from "~/assets/utils/routing/directions";

const { activeSettings } = useSettings();
const { t } = useTranslations();

const props = defineProps<{
    upcomingTurns: DirectionStep[];
    distanceToNextTurn: number;
    nextInstruction: string;
    active?: boolean;
    exit?: number | undefined;
}>();

// [1] is the turn being approached, [2] the one after it ("then" row).
const currentTurn = computed(() => props.upcomingTurns[1]);
const nextTurn = computed(() => props.upcomingTurns[2]);

const { kmToUserUnits, distanceUnit } = useUnitConversion();

const routeDistanceConverted = computed(() =>
    kmToUserUnits(props.distanceToNextTurn),
);

// Route km between the upcoming turn and the one after it.
const nextLegDistance = computed(() => {
    const current = currentTurn.value;
    const next = nextTurn.value;
    if (!current || !next || current.cumulativeKm === undefined) return null;
    if (next.cumulativeKm === undefined) return null;
    return Math.max(0, next.cumulativeKm - current.cumulativeKm);
});

const nextLegConverted = computed(() =>
    nextLegDistance.value === null
        ? null
        : kmToUserUnits(nextLegDistance.value),
);
</script>

<template>
    <div class="card">
        <div class="maneuver-main">
            <div
                v-if="currentTurn"
                class="main-arrow"
            >
                <DirectionIcon
                    :type="currentTurn.type"
                    :exit-count="
                        currentTurn.type === 'roundabout'
                            ? currentTurn.exitCount
                            : undefined
                    "
                    :active="true"
                    :active-color="activeSettings.routeColor"
                />
            </div>

            <div class="maneuver-text">
                <div class="maneuver-distance">
                    {{ routeDistanceConverted }}
                    <span class="unit">{{ distanceUnit }}</span>
                </div>
                <div class="maneuver-instruction">
                    {{ nextInstruction }}
                </div>
            </div>
        </div>

        <div
            v-if="nextTurn && nextLegConverted !== null"
            class="maneuver-next"
        >
            <span class="then-label">{{ t("directions.then") }}</span>
            <div class="next-arrow">
                <DirectionIcon
                    :type="nextTurn.type"
                    :exit-count="
                        nextTurn.type === 'roundabout'
                            ? nextTurn.exitCount
                            : undefined
                    "
                />
            </div>
            <span class="next-distance">
                {{ nextLegConverted }} {{ distanceUnit }}
            </span>
        </div>
    </div>
</template>

<style scoped src="~/assets/scss/scoped/navigation/maneuverCard.scss"></style>
