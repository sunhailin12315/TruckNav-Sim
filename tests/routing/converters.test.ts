import { describe, expect, it } from "vitest";
import {
    convertAtsToGeo,
    convertGeoToAts,
    convertEts2ToGeo,
    convertGeoToEts2,
} from "~/assets/utils/map/converters";

describe("game <-> WGS84 converters", () => {
    it("ETS2 round-trips game coords through geo", () => {
        const samples: [number, number][] = [
            [0, 0],
            [50000, -30000],
            [-120000, 80000],
            [60000, 250000],
        ];

        for (const [x, z] of samples) {
            const [lng, lat] = convertEts2ToGeo(x, z);
            const [backX, backZ] = convertGeoToEts2(lng, lat);
            expect(backX).toBeCloseTo(x, 6);
            expect(backZ).toBeCloseTo(z, 6);
        }
    });

    it("ATS round-trips game coords through geo", () => {
        const samples: [number, number][] = [
            [0, 0],
            [-45000, 120000],
            [30000, -250000],
        ];

        for (const [x, y] of samples) {
            const [lng, lat] = convertAtsToGeo(x, y);
            const [backX, backY] = convertGeoToAts(lng, lat);
            expect(backX).toBeCloseTo(x, 6);
            expect(backY).toBeCloseTo(y, 6);
        }
    });

    it("maps the origin to (0, 0)", () => {
        expect(convertEts2ToGeo(0, 0)).toEqual([0, 0]);
        expect(convertAtsToGeo(0, 0)).toEqual([0, 0]);
    });

    it("negative game Z goes north into a plausible ETS2 latitude", () => {
        const [, lat] = convertEts2ToGeo(0, -300000);
        // Web Mercator y=1 -> ~49.6 deg, matching central Europe.
        expect(lat).toBeGreaterThan(49);
        expect(lat).toBeLessThan(51);
    });

    it("preserves ordering: larger game X -> larger longitude", () => {
        const [lng1] = convertEts2ToGeo(1000, 0);
        const [lng2] = convertEts2ToGeo(2000, 0);
        expect(lng2).toBeGreaterThan(lng1);
    });
});
