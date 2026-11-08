<script lang="ts" setup>
import { maneuverGlyph } from "~/assets/utils/navigation/maneuverGlyph";

const props = defineProps<{
    type:
        | "depart"
        | "straight"
        | "left"
        | "right"
        | "slight-left"
        | "slight-right"
        | "sharp-left"
        | "sharp-right"
        | "u-turn"
        | "ferry"
        | "roundabout"
        | "destination"
        | "exit-highway";
    active?: boolean;
    activeColor?: string;
    exitCount?: number | undefined;
    /** The turn's own angle (signed degrees, right positive): the arrow
     * points the way the road actually goes, not the type's average. */
    angle?: number | undefined;
}>();

const paths = computed(() =>
    maneuverGlyph({ type: props.type, angle: props.angle }),
);
</script>

<template>
    <div class="icon-wrapper" :style="{ '--active-color': props.activeColor }">
        <svg
            viewBox="0 0 48 48"
            class="direction-icon"
            :class="{ 'is-active': active }"
        >
            <g
                fill="none"
                stroke="currentColor"
                stroke-width="5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="icon-content"
            >
                <path
                    v-for="(glyph, i) in paths"
                    :key="i"
                    :d="glyph.d"
                    :opacity="glyph.opacity ?? 1"
                    :fill="glyph.fill ? 'currentColor' : 'none'"
                    :stroke-width="glyph.fill ? 2 : 5"
                />
            </g>
        </svg>

        <span
            v-if="props.type === 'roundabout' && exitCount"
            class="exit-number"
            :class="{ 'is-active': active }"
        >
            {{ exitCount }}
        </span>
    </div>
</template>

<style scoped src="~/assets/scss/scoped/navigation/directionIcon.scss"></style>
