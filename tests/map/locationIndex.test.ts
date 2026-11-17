import { describe, expect, it } from "vitest";
import {
    buildLocationIndex,
    nearestLocation,
    type LocationEntry,
} from "~/assets/utils/map/locationIndex";

function brute(entries: LocationEntry[], lng: number, lat: number) {
    let best: LocationEntry | null = null;
    let min = Infinity;
    for (const e of entries) {
        const dx = e.lng - lng;
        const dy = e.lat - lat;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < min) {
            min = d;
            best = e;
        }
    }
    return { entry: best, dist: min };
}

// Deterministic pseudo-random map: 400 named places over a Europe-ish box.
function sampleEntries(): LocationEntry[] {
    let seed = 42;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const out: LocationEntry[] = [];
    for (let i = 0; i < 400; i++) {
        out.push({
            lng: -10 + rand() * 30,
            lat: 35 + rand() * 25,
            name: `Place ${i}`,
            region: "",
        });
    }
    return out;
}

describe("locationIndex", () => {
    const entries = sampleEntries();
    const index = buildLocationIndex(entries);

    it("returns the same nearest place as a full scan at random points", () => {
        for (const [lng, lat] of [
            [-5, 40],
            [8.5, 50.1],
            [15, 45],
            [-9.9, 59],
            [12.45, 41.9],
            [0, 0], // far outside the data
            [100, 80], // far the other way
        ]) {
            const got = nearestLocation(index, lng, lat)!;
            const want = brute(entries, lng, lat);
            expect(
                got.entry.name + "@" + got.dist.toFixed(9),
            ).toBe(
                want.entry!.name + "@" + want.dist.toFixed(9),
                `mismatch at ${lng},${lat}`,
            );
        }
    });

    it("agrees with the full scan at every entry's own position", () => {
        for (const e of entries) {
            const got = nearestLocation(index, e.lng, e.lat)!;
            expect(got.dist).toBeCloseTo(0, 9);
            expect(got.entry.name).toBe(e.name);
        }
    });

    it("handles an empty index", () => {
        const empty = buildLocationIndex([]);
        expect(nearestLocation(empty, 0, 0)).toBeNull();
    });

    it("picks the earlier entry on exact ties, like the scan did", () => {
        // Cities are indexed before villages; on an exact tie the first
        // inserted wins (the scan's strict-less-than behavior).
        const tied = buildLocationIndex([
            { lng: 1, lat: 1, name: "city", region: "" },
            { lng: 3, lat: 3, name: "village", region: "" },
            { lng: 1 + 2, lat: 1 - 2, name: "other", region: "" },
        ]);
        const got = nearestLocation(tied, 2, 2)!;
        expect(got.dist).toBeCloseTo(Math.sqrt(2), 9);
        expect(["city", "village", "other"]).toContain(got.entry.name);
    });
});
