import { describe, expect, it } from "vitest";
import { turnAngle } from "~/assets/utils/routing/directions";
import { maneuverGlyph } from "~/assets/utils/navigation/maneuverGlyph";

/** The first x coordinate of a path (an arrowhead's tip, say). */
function headX(paths: { d: string }[]): number {
    const head = paths[paths.length - 1]!.d;
    return Number(head.match(/^M([\d.]+)/)![1]);
}

describe("turnAngle", () => {
    it("is right positive and 0 straight on", () => {
        // Heading north (lat rising), then out to the east: +90.
        expect(turnAngle([0, 0], [0, 0.001], [0.001, 0.001])).toBeCloseTo(90);
        // Out to the west: -90.
        expect(turnAngle([0, 0], [0, 0.001], [-0.001, 0.001])).toBeCloseTo(-90);
        // Straight on through a widened junction.
        expect(turnAngle([0, 0], [0, 0.001], [0, 0.002])).toBeCloseTo(0);
    });

    it("wraps the short way round", () => {
        // In at bearing 350°, out at 10°: a +20° turn (through north), not
        // +340°. The points sit on those exact bearings around the junction.
        const at = (deg: number): [number, number] => {
            const r = (deg * Math.PI) / 180;
            return [Math.sin(r) * 0.001, Math.cos(r) * 0.001];
        };
        const prev: [number, number] = [-at(350)[0], -at(350)[1]];
        expect(turnAngle(prev, [0, 0], at(10))).toBeCloseTo(20);
    });

    it("is undefined where a side is missing", () => {
        expect(turnAngle(undefined, [0, 0], [1, 1])).toBeUndefined();
        expect(turnAngle([0, 0], [0, 0], undefined)).toBeUndefined();
    });
});

describe("maneuverGlyph", () => {
    it("turns the arrow by the step's angle", () => {
        // 90° right: the head's tip sits at 24 + 18 along east.
        expect(headX(maneuverGlyph({ type: "right", angle: 90 }))).toBeCloseTo(42);
        // 90° left: mirrored.
        expect(headX(maneuverGlyph({ type: "left", angle: -90 }))).toBeCloseTo(6);
    });

    it("falls back to the type's side without an angle", () => {
        // 45° right: tip at 24 + 18·sin45.
        expect(headX(maneuverGlyph({ type: "right" }))).toBeCloseTo(
            24 + 18 * Math.sin(Math.PI / 4),
        );
    });

    it("draws the way not taken faintly on an exit", () => {
        const paths = maneuverGlyph({ type: "exit-highway", angle: 45 });
        expect(paths.some((p) => p.opacity === 0.35)).toBe(true);
        expect(paths.some((p) => p.opacity === undefined)).toBe(true);
    });

    it("gives the roundabout a ring and an arm", () => {
        const paths = maneuverGlyph({ type: "roundabout", exitCount: 2 });
        expect(paths.some((p) => p.d.includes("A8.5"))).toBe(true);
        expect(paths.length).toBeGreaterThanOrEqual(3);
    });

    it("classifies a sharp left/right as a u-turn loop", () => {
        const paths = maneuverGlyph({ type: "u-turn" });
        expect(paths[0]!.d).toContain("a7 7");
    });

    it("arrives with a flag", () => {
        const paths = maneuverGlyph({ type: "destination" });
        expect(paths[1]!.fill).toBe(true);
    });

    it("covers every turn type with at least a stroke", () => {
        const types = [
            "depart",
            "straight",
            "ferry",
            "slight-left",
            "slight-right",
            "sharp-left",
            "sharp-right",
        ] as const;
        for (const type of types) {
            const paths = maneuverGlyph({ type });
            expect(paths.length).toBeGreaterThanOrEqual(2);
            for (const p of paths) {
                expect(p.d.length).toBeGreaterThan(0);
            }
        }
    });
});
