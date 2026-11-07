import { describe, expect, it } from "vitest";
import { generateDirectionsList } from "~/assets/utils/routing/directions";

function buildInputs(
    nodeSequence: number[],
    nodeKms: number[],
    maneuvers: number[],
    exits: number[],
) {
    const nodeCoords = new Map<number, [number, number]>(
        nodeSequence.map((id) => [id, [id * 1, 0] as [number, number]]),
    );
    return [
        nodeSequence,
        Float32Array.from(nodeKms),
        Int8Array.from(maneuvers),
        Int8Array.from(exits),
        nodeCoords,
    ] as const;
}

describe("generateDirectionsList", () => {
    it("emits depart, turn and destination steps with distances", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0, 1, 2, 3], [0, 10, 20, 30], [0, 1, 2, 0], [
                0, 0, 0, 0,
            ]),
        );

        expect(steps.map((s) => s.type)).toEqual([
            "depart",
            "left",
            "right",
            "destination",
        ]);

        // Each step's distance is the km gap to the next maneuver.
        expect(steps[0]!.distance).toBeCloseTo(10, 3);
        expect(steps[1]!.distance).toBeCloseTo(10, 3);
        expect(steps[2]!.distance).toBeCloseTo(10, 3);

        expect(steps[1]!.cumulativeKm).toBeCloseTo(10, 3);
        expect(steps[1]!.exitCumulativeKm).toBeCloseTo(20, 3);
        expect(steps[2]!.cumulativeKm).toBeCloseTo(20, 3);
    });

    it("carries the node index of each maneuver", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0, 1, 2, 3], [0, 10, 20, 30], [0, 1, 2, 0], [
                0, 0, 0, 0,
            ]),
        );

        expect(steps[0]!.nodeIndex).toBe(0);
        expect(steps[1]!.nodeIndex).toBe(1);
        expect(steps[2]!.nodeIndex).toBe(2);
        expect(steps[3]!.nodeIndex).toBe(3);
    });

    it("collapses consecutive roundabout maneuvers into one step", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0, 1, 2, 3], [0, 5, 10, 15], [3, 3, 0, 0], [
                2, 0, 0, 0,
            ]),
        );

        const roundabouts = steps.filter((s) => s.type === "roundabout");
        expect(roundabouts.length).toBe(1);
        expect(roundabouts[0]!.text).toBe("2nd exit");
        expect(roundabouts[0]!.nodeIndex).toBe(0);
    });

    it("formats roundabout exit ordinals", () => {
        const cases: [number, string][] = [
            [1, "1st exit"],
            [2, "2nd exit"],
            [3, "3rd exit"],
            [5, "5th exit"],
        ];

        for (const [exitCount, expected] of cases) {
            const steps = generateDirectionsList(
                ...buildInputs([0, 1], [0, 5], [3, 0], [exitCount, 0]),
            );
            expect(steps[1]!.text).toBe(expected);
        }
    });

    it("maps highway exits and keep-left/right maneuvers", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0, 1, 2, 3], [0, 5, 10, 15], [5, 6, 7, 0], [
                0, 0, 0, 0,
            ]),
        );

        expect(steps[1]!.type).toBe("exit-highway");
        expect(steps[1]!.text).toBe("Take the exit");
        expect(steps[2]!.type).toBe("slight-left");
        expect(steps[2]!.text).toBe("Keep left");
        expect(steps[3]!.type).toBe("slight-right");
        expect(steps[3]!.text).toBe("Keep right");
    });

    it("ignores unknown maneuver type 4", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0, 1, 2], [0, 5, 10], [4, 1, 0], [0, 0, 0]),
        );

        expect(steps.map((s) => s.type)).toEqual([
            "depart",
            "left",
            "destination",
        ]);
    });

    it("returns no steps for a single-node route", () => {
        const steps = generateDirectionsList(
            ...buildInputs([0], [0], [0], [0]),
        );
        expect(steps).toEqual([]);
    });
});
