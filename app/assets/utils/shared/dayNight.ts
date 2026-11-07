// Day/night atmosphere, AMap Auto style: every surface has a day and a
// night variant and the clock interpolates between them. The night palette
// is derived from the user's own colors, so any custom theme keeps working.
// Pure and Vue-free; app/composables/DayNight.ts wires it to telemetry.

import { darkenColor, mixHexColors } from "~/assets/utils/shared/colors";

export type DayPhase = "night" | "dawn" | "day" | "dusk";

/**
 * Continuous night factor for an in-game hour (0–24): 0 = full day palette,
 * 1 = full night palette. Dawn (04–06) and dusk (18–20) ramp smoothly,
 * mirroring the six-phase sky of the real car unit.
 */
export function nightFactorForHour(hour: number): number {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 6 && h < 18) return 0; // day
    if (h >= 20 || h < 4) return 1; // night
    if (h < 6) return 1 - (h - 4) / 2; // dawn ramp: 04:00 → 06:00
    return (h - 18) / 2; // dusk ramp: 18:00 → 20:00
}

export function phaseForHour(hour: number): DayPhase {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 4 && h < 6) return "dawn";
    if (h >= 6 && h < 18) return "day";
    if (h >= 18 && h < 20) return "dusk";
    return "night";
}

/**
 * Reads the in-game clock as published by telemetry ("Wed 21:30", UTC).
 * Returns null when the string carries no HH:MM pair.
 */
export function nightFactorFromGameTime(gameTime: string): number | null {
    const match = /(\d{1,2}):(\d{2})/.exec(gameTime ?? "");
    if (!match) return null;
    return nightFactorForHour(Number(match[1]) + Number(match[2]) / 60);
}

export function phaseFromGameTime(gameTime: string): DayPhase | null {
    const match = /(\d{1,2}):(\d{2})/.exec(gameTime ?? "");
    if (!match) return null;
    return phaseForHour(Number(match[1]) + Number(match[2]) / 60);
}

// Deep blue-black tints keep the night map readable instead of merely dark.
const NIGHT_LAND_TINT = "#101826";
const NIGHT_WATER_TINT = "#0a101a";

/** Night variant of the user's land color. */
export function nightLandColor(land: string): string {
    return mixHexColors(darkenColor(land, 0.55), NIGHT_LAND_TINT, 0.45);
}

/** Night variant of the user's water/background color. */
export function nightWaterColor(water: string): string {
    return mixHexColors(darkenColor(water, 0.6), NIGHT_WATER_TINT, 0.5);
}

/** Night variant of the user's road color — roads stay relatively bright. */
export function nightRoadColor(road: string): string {
    return darkenColor(road, 0.2);
}

/** Blends a day color toward its night variant by the current factor. */
export function blendToNight(
    base: string,
    night: string,
    factor: number,
): string {
    return mixHexColors(base, night, Math.max(0, Math.min(1, factor)));
}
