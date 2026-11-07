import { describe, expect, it } from "vitest";
import {
    blendToNight,
    nightFactorForHour,
    nightFactorFromGameTime,
    nightLandColor,
    nightRoadColor,
    nightWaterColor,
    phaseForHour,
    phaseFromGameTime,
} from "~/assets/utils/shared/dayNight";

describe("nightFactorForHour", () => {
    it("is full day between 06:00 and 18:00", () => {
        expect(nightFactorForHour(6)).toBe(0);
        expect(nightFactorForHour(12)).toBe(0);
        expect(nightFactorForHour(17.99)).toBe(0);
    });

    it("is full night between 20:00 and 04:00", () => {
        expect(nightFactorForHour(20)).toBe(1);
        expect(nightFactorForHour(23)).toBe(1);
        expect(nightFactorForHour(2)).toBe(1);
        expect(nightFactorForHour(3.99)).toBe(1);
    });

    it("ramps linearly through dawn (04–06) and dusk (18–20)", () => {
        expect(nightFactorForHour(4)).toBe(1);
        expect(nightFactorForHour(5)).toBe(0.5);
        expect(nightFactorForHour(6)).toBe(0);
        expect(nightFactorForHour(18)).toBe(0);
        expect(nightFactorForHour(19)).toBe(0.5);
        expect(nightFactorForHour(20)).toBe(1);
    });

    it("wraps out-of-range hours", () => {
        expect(nightFactorForHour(30)).toBe(nightFactorForHour(6));
        expect(nightFactorForHour(-3)).toBe(1);
    });
});

describe("phaseForHour", () => {
    it("names the four phases", () => {
        expect(phaseForHour(3)).toBe("night");
        expect(phaseForHour(5)).toBe("dawn");
        expect(phaseForHour(12)).toBe("day");
        expect(phaseForHour(19)).toBe("dusk");
        expect(phaseForHour(22)).toBe("night");
    });
});

describe("game time parsing", () => {
    it("reads the telemetry clock string", () => {
        expect(nightFactorFromGameTime("Wed 21:30")).toBe(1);
        expect(nightFactorFromGameTime("Wed 12:00")).toBe(0);
        expect(nightFactorFromGameTime("Thu 05:00")).toBe(0.5);
        expect(nightFactorFromGameTime("Thu 19:00")).toBe(0.5);
    });

    it("returns null without a clock", () => {
        expect(nightFactorFromGameTime("")).toBeNull();
        expect(nightFactorFromGameTime("no clock here")).toBeNull();
        expect(phaseFromGameTime("Wed 21:30")).toBe("night");
        expect(phaseFromGameTime("")).toBeNull();
    });
});

describe("night palette transforms", () => {
    it("darkens every surface at night", () => {
        for (const night of [
            nightLandColor("#272d39"),
            nightWaterColor("#24467b"),
            nightRoadColor("#4a5f7a"),
        ]) {
            expect(night).toMatch(/^#[0-9a-f]{6}$/);
            expect(night).not.toBe("#000000");
            expect(night).not.toBe("#ffffff");
        }
    });

    it("keeps roads brighter than land at night", () => {
        // Same base tone: the road variant must stay lighter so night maps
        // stay readable (dark land, lighter roads — real night-nav style).
        const road = nightRoadColor("#3d4a5c");
        const land = nightLandColor("#3d4a5c");

        expect(road).toBe("#313b4a");
        expect(land).toBe("#161d28");

        const luminance = (hex: string) =>
            parseInt(hex.slice(1, 3), 16) +
            parseInt(hex.slice(3, 5), 16) +
            parseInt(hex.slice(5, 7), 16);
        expect(luminance(road)).toBeGreaterThan(luminance(land));
    });
});

describe("blendToNight", () => {
    it("interpolates between the day and night color", () => {
        expect(blendToNight("#204060", "#102030", 0)).toBe("#204060");
        expect(blendToNight("#204060", "#102030", 1)).toBe("#102030");
        expect(blendToNight("#204060", "#102030", 0.5)).toBe("#183048");
    });

    it("clamps out-of-range factors", () => {
        expect(blendToNight("#204060", "#102030", 2)).toBe("#102030");
        expect(blendToNight("#204060", "#102030", -1)).toBe("#204060");
    });
});
