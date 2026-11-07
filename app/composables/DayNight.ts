import { computed, watchEffect } from "vue";
import {
    blendToNight,
    nightFactorFromGameTime,
    nightLandColor,
    nightRoadColor,
    nightWaterColor,
    phaseFromGameTime,
    type DayPhase,
} from "~/assets/utils/shared/dayNight";
import { mixHexColors, darkenColor } from "~/assets/utils/shared/colors";
import type { DayNightMode } from "~/assets/utils/shared/settingsSchema";

export interface DayNightMapColors {
    land: string;
    water: string;
    road: string;
}

/**
 * AMap-style day/night atmosphere. Reads the in-game clock from telemetry
 * (auto mode) or forces day/night, and exposes:
 *  - `mapColors`: the user palette blended toward the night variant, for the
 *    MapLibre layers;
 *  - theme/text CSS variables owned here so the HUD can dim at night
 *    (settings saves re-apply them through the same watcher).
 */
export const useDayNight = () => {
    const { activeSettings } = useSettings();
    const { gameTime } = useEtsTelemetry();

    const mode = computed<DayNightMode>(
        () => activeSettings.value.dayNightMode ?? "off",
    );

    const nightFactor = computed(() => {
        if (mode.value === "day") return 0;
        if (mode.value === "night") return 1;
        if (mode.value !== "auto") return 0;
        return nightFactorFromGameTime(gameTime.value) ?? 0;
    });

    const isNight = computed(
        () => mode.value !== "off" && nightFactor.value >= 0.5,
    );

    const phase = computed<DayPhase | null>(() => {
        if (mode.value === "day") return "day";
        if (mode.value === "night") return "night";
        if (mode.value !== "auto") return null;
        return phaseFromGameTime(gameTime.value);
    });

    /** Map palette mixed toward the night variant by the current factor. */
    const mapColors = computed<DayNightMapColors>(() => {
        const a = activeSettings.value;
        const land = a.landColor ?? "#272d39";
        const water = a.backgroundColor ?? "#24467b";
        const road = a.roadColor ?? "#4a5f7a";
        const f = nightFactor.value;

        return {
            land: blendToNight(land, nightLandColor(land), f),
            water: blendToNight(water, nightWaterColor(water), f),
            road: blendToNight(road, nightRoadColor(road), f),
        };
    });

    // The HUD accent + text colors are written here — in day they match the
    // plain settings values, at night they dim so the panel doesn't glare.
    if (import.meta.client) {
        watchEffect(() => {
            const root = document.documentElement;
            const theme = activeSettings.value.themeColor;
            const isLight = activeSettings.value.textColor === "light";
            const baseText = isLight ? "#f2f2f2" : "#333333";
            const f = nightFactor.value;

            if (f <= 0) {
                root.style.setProperty("--theme-color", theme);
                root.style.setProperty("--main-text-color", baseText);
                root.classList.remove("night-mode");
                return;
            }

            root.classList.add("night-mode");
            root.style.setProperty(
                "--theme-color",
                mixHexColors(theme, darkenColor(theme, 0.35), f),
            );
            root.style.setProperty(
                "--main-text-color",
                mixHexColors(baseText, "#8a94a3", f * 0.6),
            );
        });
    }

    return {
        mode,
        nightFactor,
        isNight,
        phase,
        mapColors,
    };
};
