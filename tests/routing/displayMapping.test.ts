import { describe, expect, it } from "vitest";
import { fillNodeDisplayMapping } from "~/assets/utils/routing/displayMapping";

type Pt = [number, number];

// The original per-node full-path scan, kept here as the reference.
function bruteForce(
    sequence: number[],
    coords: Map<number, Pt>,
    path: Pt[],
    stats: Float32Array,
) {
    const kms = new Float32Array(sequence.length);
    const idxs = new Int32Array(sequence.length);
    for (let i = 0; i < sequence.length; i++) {
        const pos = coords.get(sequence[i]!);
        if (!pos) continue;
        let min = Infinity;
        let best = 0;
        for (let j = 0; j < path.length; j++) {
            const p = path[j]!;
            const d =
                (p[0] - pos[0]) * (p[0] - pos[0]) +
                (p[1] - pos[1]) * (p[1] - pos[1]);
            if (d < min) {
                min = d;
                best = j;
            }
        }
        kms[i] = stats[best * 3]!;
        idxs[i] = best;
    }
    return { kms, idxs };
}

function buildCase(path: Pt[]) {
    // Cumulative km in the stride-3 stats layout the worker ships.
    const stats = new Float32Array(path.length * 3);
    let acc = 0;
    for (let j = 0; j < path.length; j++) {
        if (j > 0) {
            const dx = path[j]![0] - path[j - 1]![0];
            const dy = path[j]![1] - path[j - 1]![1];
            acc += Math.sqrt(dx * dx + dy * dy) * 111;
        }
        stats[j * 3] = acc;
    }
    return stats;
}

function runFill(
    sequence: number[],
    coords: Map<number, Pt>,
    path: Pt[],
    stats: Float32Array,
) {
    const kms = new Float32Array(sequence.length);
    const idxs = new Int32Array(sequence.length);
    fillNodeDisplayMapping(
        sequence,
        { get: (id) => coords.get(id) },
        path,
        stats,
        kms,
        idxs,
    );
    return { kms, idxs };
}

describe("fillNodeDisplayMapping", () => {
    it("matches the full-scan reference on a straight long route", () => {
        const path: Pt[] = [];
        for (let i = 0; i < 20000; i++)
            path.push([i * 0.0001, Math.sin(i * 0.001) * 0.0002]);
        const coords = new Map<number, Pt>();
        const sequence: number[] = [];
        for (let n = 0; n < 500; n++) {
            const j = Math.floor((n / 500) * path.length);
            sequence.push(n);
            // Node sits near its pass-by point with a small offset.
            coords.set(n, [
                path[j]![0] + 0.00003,
                path[j]![1] + 0.00003,
            ]);
        }
        const stats = buildCase(path);
        const got = runFill(sequence, coords, path, stats);
        const want = bruteForce(sequence, coords, path, stats);
        expect(Array.from(got.idxs)).toEqual(Array.from(want.idxs));
        expect(Array.from(got.kms)).toEqual(Array.from(want.kms));
    });

    it("matches on a serpentine path where arc gaps exceed straight gaps", () => {
        const path: Pt[] = [];
        for (let i = 0; i < 8000; i++)
            path.push([i * 0.0002, Math.sin(i * 0.05) * 0.01]); // tight folds
        const coords = new Map<number, Pt>();
        const sequence: number[] = [];
        for (let n = 0, count = 300; n < count; n++) {
            const j = Math.floor((n / count) * path.length);
            sequence.push(n);
            coords.set(n, [path[j]![0], path[j]![1] + 0.0001]);
        }
        const stats = buildCase(path);
        const got = runFill(sequence, coords, path, stats);
        const want = bruteForce(sequence, coords, path, stats);
        expect(Array.from(got.idxs)).toEqual(Array.from(want.idxs));
    });

    it("skips unknown nodes without shifting the others", () => {
        const path: Pt[] = [];
        for (let i = 0; i < 1000; i++) path.push([i * 0.001, 0]);
        const coords = new Map<number, Pt>([
            [7, [0.5, 0]],
            [9, [0.9, 0]],
        ]);
        const stats = buildCase(path);
        const got = runFill([7, 8, 9], coords, path, stats);
        expect(got.idxs[0]).toBe(500);
        expect(got.idxs[1]).toBe(0); // untouched slot for the unknown node
        expect(got.idxs[2]).toBe(900);
    });

    it("handles an empty path without writing", () => {
        const kms = new Float32Array(2);
        const idxs = new Int32Array(2);
        fillNodeDisplayMapping(
            [1, 2],
            { get: () => [1, 1] },
            [],
            new Float32Array(0),
            kms,
            idxs,
        );
        expect(Array.from(idxs)).toEqual([0, 0]);
    });
});
