import { describe, expect, it } from "vitest";

import {
    GUARD_TO_DLC,
    bearingRad,
    mapGuardToDlc,
    toWgs84,
} from "../../scripts/scan-worker/convert";
import { convertEts2ToGeo } from "~/assets/utils/map/converters";

describe("scan-worker/convert", () => {
    it("projects game coordinates exactly like the app's convertEts2ToGeo", () => {
        // Reykjavik (from 1.62 scan data) and a couple of arbitrary points.
        const samples: Array<[number, number]> = [
            [-73763, -99867],
            [0, 0],
            [12345, -5432],
            [-60000, 60000],
        ];
        for (const [x, y] of samples) {
            expect(toWgs84(x, y)).toEqual(convertEts2ToGeo(x, y));
        }
    });

    it("keeps the bearing formula in radians within [-Pi, Pi]", () => {
        const a = toWgs84(0, 0);
        const b = toWgs84(1000, 0); // due east (lng grows, lat constant)
        const brng = bearingRad(a, b);
        // east on WGS84 = +Pi/2 rad
        expect(brng).toBeCloseTo(Math.PI / 2, 2);
    });

    it("maps the Iceland dlc guard to the Iceland expansion id", () => {
        expect(GUARD_TO_DLC[27]).toBe(11);
        expect(mapGuardToDlc(27)).toEqual({ dlc: 11, unknown: false });
    });

    it("treats every base-game/known guard as known and factory guards as base", () => {
        expect(mapGuardToDlc(0)).toEqual({ dlc: 0, unknown: false });
        expect(mapGuardToDlc(15)).toEqual({ dlc: 0, unknown: false }); // Krone factory
        expect(mapGuardToDlc(23)).toEqual({ dlc: 10, unknown: false }); // Nordic Horizons
    });

    it("flags unknown guards instead of guessing", () => {
        expect(mapGuardToDlc(999).unknown).toBe(true);
        expect(mapGuardToDlc(999).dlc).toBe(0);
        expect(mapGuardToDlc(undefined).unknown).toBe(false);
    });
});
