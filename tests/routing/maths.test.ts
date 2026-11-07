import { describe, expect, it } from "vitest";
import {
    getAngleDiff,
    getBearing,
    getSignedAngle,
    getSqDistToSegment,
    getSquaredDist,
    toDeg,
    toRad,
} from "~/assets/utils/map/maths";

describe("map maths", () => {
    it("getBearing: cardinal directions", () => {
        expect(getBearing([0, 0], [1, 0])).toBeCloseTo(90, 5); // east
        expect(getBearing([0, 0], [0, 1])).toBeCloseTo(0, 5); // north
        expect(getBearing([0, 0], [0, -1])).toBeCloseTo(180, 5); // south
        expect(getBearing([0, 0], [-1, 0])).toBeCloseTo(270, 5); // west
    });

    it("getAngleDiff: shortest angular distance in degrees", () => {
        expect(getAngleDiff(350, 10)).toBe(20);
        expect(getAngleDiff(10, 350)).toBe(20);
        expect(getAngleDiff(0, 180)).toBe(180);
        expect(getAngleDiff(45, 45)).toBe(0);
    });

    it("getSignedAngle: positive right (clockwise) turns, negative left", () => {
        // East then south = right turn.
        expect(getSignedAngle([0, 0], [1, 0], [1, -1])).toBeCloseTo(90, 5);
        // East then north = left turn.
        expect(getSignedAngle([0, 0], [1, 0], [1, 1])).toBeCloseTo(-90, 5);
        // Straight continuation.
        expect(getSignedAngle([0, 0], [1, 0], [2, 0])).toBeCloseTo(0, 5);
    });

    it("getSquaredDist", () => {
        expect(getSquaredDist([0, 0], [3, 4])).toBe(25);
        expect(getSquaredDist([-1, -1], [-1, -1])).toBe(0);
    });

    it("getSqDistToSegment: projects onto the segment and clamps at ends", () => {
        // Perpendicular to the middle of a horizontal segment.
        expect(getSqDistToSegment([1, 2], [0, 0], [2, 0])).toBe(4);
        // On the segment.
        expect(getSqDistToSegment([1, 0], [0, 0], [2, 0])).toBe(0);
        // Beyond the end clamps to the endpoint.
        expect(getSqDistToSegment([3, 0], [0, 0], [2, 0])).toBe(1);
        // Degenerate segment (both ends equal).
        expect(getSqDistToSegment([1, 1], [2, 2], [2, 2])).toBe(2);
    });

    it("toRad/toDeg round-trip", () => {
        expect(toDeg(toRad(180))).toBeCloseTo(180, 10);
        expect(toRad(90)).toBeCloseTo(Math.PI / 2, 12);
    });
});
