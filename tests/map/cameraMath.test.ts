import { describe, expect, it } from "vitest";
import {
    AUTO_RECENTRE_MS,
    bearingDelta,
    clampZoomOffset,
    damp,
    dampBearing,
    FOLLOW_DELAY_MS,
    samePose,
    truckAt,
    zoomForSpeed,
    zoomOffsetFor,
    ZOOM_OFFSET_LIMITS,
    type TruckSample,
} from "~/assets/utils/map/cameraMath";

const sample = (
    time: number,
    lng: number,
    lat: number,
    heading: number,
    speedKph = 50,
): TruckSample => ({ time, coords: [lng, lat], heading, speedKph });

describe("bearingDelta", () => {
    it("takes the short way round", () => {
        expect(bearingDelta(350, 10)).toBe(20);
        expect(bearingDelta(10, 350)).toBe(-20);
        expect(bearingDelta(0, 180)).toBe(-180);
        expect(bearingDelta(180, 0)).toBe(-180);
    });
});

describe("truckAt", () => {
    it("returns the last sample when time is past it", () => {
        const samples = [sample(0, 1, 1, 0), sample(100, 2, 2, 90)];
        expect(truckAt(samples, 150)).toEqual(samples[1]);
    });

    it("interpolates between two samples", () => {
        const samples = [sample(0, 1, 1, 0), sample(100, 2, 3, 90)];
        const at = truckAt(samples, 50)!;
        expect(at.coords[0]).toBeCloseTo(1.5);
        expect(at.coords[1]).toBeCloseTo(2);
        expect(at.heading).toBeCloseTo(45);
    });

    it("turns the heading the short way round", () => {
        const samples = [sample(0, 0, 0, 350), sample(100, 0, 0, 10)];
        expect(truckAt(samples, 50)!.heading).toBeCloseTo(0);
    });

    it("interpolates speed", () => {
        const samples = [sample(0, 0, 0, 0, 40), sample(100, 0, 0, 0, 80)];
        expect(truckAt(samples, 50)!.speedKph).toBeCloseTo(60);
    });

    it("returns null without samples", () => {
        expect(truckAt([], 0)).toBeNull();
    });
});

describe("zoomForSpeed", () => {
    it("is close in town and further out on the motorway", () => {
        const city = zoomForSpeed(0);
        const motorway = zoomForSpeed(90);
        expect(city).toBeGreaterThan(motorway);
        expect(city).toBeCloseTo(11.4);
        expect(motorway).toBeCloseTo(10.0);
    });

    it("eases smoothly, monotonic in speed", () => {
        let prev = Infinity;
        for (let kph = 0; kph <= 120; kph += 5) {
            expect(zoomForSpeed(kph)).toBeLessThanOrEqual(prev);
            prev = zoomForSpeed(kph);
        }
    });
});

describe("damp", () => {
    it("converges towards the target and is frame-rate independent", () => {
        // One 100 ms step of tau 100: 63.2% of the way.
        expect(damp(0, 100, 100, 100)).toBeCloseTo(63.21, 1);
        // Ten 10 ms steps of tau 100 reach the same place.
        let value = 0;
        for (let i = 0; i < 10; i++) value = damp(value, 100, 10, 100);
        expect(value).toBeCloseTo(63.21, 1);
    });
});

describe("dampBearing", () => {
    it("wraps the short way round", () => {
        expect(dampBearing(355, 5, 1000, 100)).toBeCloseTo(5, 1);
        expect(dampBearing(5, 355, 1000, 100)).toBeCloseTo(355, 1);
    });
});

describe("zoom offset", () => {
    it("clamps to its limits", () => {
        expect(clampZoomOffset(-99)).toBe(ZOOM_OFFSET_LIMITS[0]);
        expect(clampZoomOffset(99)).toBe(ZOOM_OFFSET_LIMITS[1]);
        expect(clampZoomOffset(0)).toBe(0);
    });

    it("recovers a chosen zoom from a speed", () => {
        // Pulled out from the 90 km/h baseline of 10.0 to 9.5.
        const offset = zoomOffsetFor(9.5, 90);
        expect(offset).toBeCloseTo(-0.5);
        expect(zoomForSpeed(90) + offset).toBeCloseTo(9.5);
        // Zoomed in from the city baseline of 11.4 to 12.4.
        expect(zoomOffsetFor(12.4, 0)).toBeCloseTo(1);
    });
});

describe("samePose", () => {
    it("tells settled poses from moved ones", () => {
        const pose = { center: [9.0, 50.0] as [number, number], zoom: 11, bearing: 45 };
        expect(samePose(pose, pose)).toBe(true);
        expect(
            samePose(pose, { center: [9.0, 50.0], zoom: 11, bearing: 45.001 }),
        ).toBe(true);
        expect(
            samePose(pose, { center: [9.0, 50.0], zoom: 11, bearing: 46 }),
        ).toBe(false);
        expect(
            samePose(pose, { center: [9.0, 50.001], zoom: 11, bearing: 45 }),
        ).toBe(false);
        expect(
            samePose(pose, { center: [9.0, 50.0], zoom: 12, bearing: 45 }),
        ).toBe(false);
    });
});

describe("constants", () => {
    it("keeps the render delay inside one telemetry tick", () => {
        // The bridge sends at roughly 10-20 Hz (50-100 ms); the delay must be
        // short enough that the buffer always holds two samples.
        expect(FOLLOW_DELAY_MS).toBeLessThan(100);
        expect(AUTO_RECENTRE_MS).toBe(15_000);
    });
});
