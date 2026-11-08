<script lang="ts" setup>
import type { DirectionStep } from "~/assets/utils/routing/directions";

// Step-change timing mirrors WestPlay's GuidanceCard (560 ms spring for the
// step swap, 320 ms for the card's going); the matching keyframes live in
// maneuverCard.scss.
const STEP_CHANGE_MS = 560;
const CLOSE_MS = 320;
/** A second step this close behind the first rides along in the then row
 * (route km; WestPlay's THEN_WITHIN). */
const THEN_WITHIN_KM = 0.4;
/** Within this of the next turn the distance reads "now" (route km;
 * WestPlay's NOW_WITHIN, above the 0.1 km display rounding). */
const NOW_WITHIN_KM = 0.05;

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

// Route km between the upcoming turn and the one after it.
const nextLegDistance = computed(() => {
    const current = currentTurn.value;
    const next = nextTurn.value;
    if (!current || !next || current.cumulativeKm === undefined) return null;
    if (next.cumulativeKm === undefined) return null;
    return Math.max(0, next.cumulativeKm - current.cumulativeKm);
});

// The then row only opens when the turn after this one is close behind it.
const thenTurn = computed(() =>
    nextLegDistance.value !== null && nextLegDistance.value <= THEN_WITHIN_KM
        ? nextTurn.value
        : null,
);

/** The step as shown: what (already worded), how far, and what follows. */
interface Shown {
    key: string;
    turn: DirectionStep;
    distance: string;
    unit: string;
    instruction: string;
    then: DirectionStep | null;
}

const current = computed<Shown | null>(() => {
    const turn = currentTurn.value;
    if (!turn) return null;
    const now_ = props.distanceToNextTurn < NOW_WITHIN_KM;
    return {
        key: `${turn.type}:${turn.id}`,
        turn,
        distance: now_ ? t("directions.now") : String(kmToUserUnits(props.distanceToNextTurn)),
        unit: now_ ? "" : distanceUnit.value,
        instruction: props.nextInstruction,
        then: thenTurn.value ?? null,
    };
});

/**
 * The steps on show as the route goes on (WestPlay's useStepChange): the
 * current one, the one it replaced while that slides away, and the card
 * closing (the route ended: the last step stays while it goes).
 */
const shown = ref<Shown | null>(null);
const leaving = ref<Shown | null>(null);
const closing = ref(false);

const timers: ReturnType<typeof setTimeout>[] = [];
onUnmounted(() => timers.forEach(clearTimeout));

watch(
    current,
    (now, before) => {
        if (now) {
            if (shown.value && now.key !== shown.value.key) {
                leaving.value = shown.value;
                timers.push(
                    setTimeout(() => (leaving.value = null), STEP_CHANGE_MS),
                );
            }
            shown.value = now;
            closing.value = false;
        } else if (shown.value && !closing.value) {
            closing.value = true;
            timers.push(
                setTimeout(() => {
                    shown.value = null;
                    leaving.value = null;
                    closing.value = false;
                }, CLOSE_MS),
            );
        }
    },
    { immediate: true },
);

/** The then row's content, kept one beat while it closes (WestPlay's
 * useKept): a row that vanishes instantly reads as a flicker. */
const keptThen = ref<DirectionStep | null>(null);
watch(thenTurn, (turn) => {
    if (turn) keptThen.value = turn;
});
</script>

<template>
    <div class="card" :class="{ closing }">
        <div class="maneuver-steps">
            <div
                v-if="leaving"
                :key="`out:${leaving.key}`"
                class="maneuver-step leaving"
                aria-hidden="true"
            >
                <div class="maneuver-main">
                    <div class="main-arrow">
                        <DirectionIcon
                            :type="leaving.turn.type"
                            :angle="leaving.turn.angle"
                            :exit-count="
                                leaving.turn.type === 'roundabout'
                                    ? leaving.turn.exitCount
                                    : undefined
                            "
                            :active="true"
                            :active-color="activeSettings.routeColor"
                        />
                    </div>
                    <div class="maneuver-text">
                        <div class="maneuver-distance">
                            {{ leaving.distance }}
                            <span
                                v-if="leaving.unit"
                                class="unit"
                            >{{ leaving.unit }}</span>
                        </div>
                        <div class="maneuver-instruction">
                            {{ leaving.instruction }}
                        </div>
                    </div>
                </div>
            </div>

            <div
                v-if="shown"
                :key="shown.key"
                class="maneuver-step"
                :class="{ entering: !!leaving }"
            >
                <div class="maneuver-main">
                    <div
                        v-if="shown.turn"
                        class="main-arrow"
                    >
                        <DirectionIcon
                            :type="shown.turn.type"
                            :angle="shown.turn.angle"
                            :exit-count="
                                shown.turn.type === 'roundabout'
                                    ? shown.turn.exitCount
                                    : undefined
                            "
                            :active="true"
                            :active-color="activeSettings.routeColor"
                        />
                    </div>

                    <div class="maneuver-text">
                        <div class="maneuver-distance">
                            {{ shown.distance }}
                            <span
                                v-if="shown.unit"
                                class="unit"
                            >{{ shown.unit }}</span>
                        </div>
                        <div class="maneuver-instruction">
                            {{ shown.instruction }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div
            class="maneuver-then-slot"
            :class="{ open: shown?.then && keptThen }"
        >
            <div
                v-if="keptThen"
                class="maneuver-next"
            >
                <span class="then-label">{{ t("directions.then") }}</span>
                <div class="next-arrow">
                    <DirectionIcon
                        :type="keptThen.type"
                        :angle="keptThen.angle"
                        :exit-count="
                            keptThen.type === 'roundabout'
                                ? keptThen.exitCount
                                : undefined
                        "
                    />
                </div>
                <span
                    v-if="nextLegDistance !== null"
                    class="next-distance"
                >
                    {{ kmToUserUnits(nextLegDistance) }} {{ distanceUnit }}
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss" src="~/assets/scss/scoped/navigation/maneuverCard.scss"></style>
