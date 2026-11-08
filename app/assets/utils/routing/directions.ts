import { getBearing } from "~/assets/utils/map/maths";

export interface DirectionStep {
    id: number;
    type:
        | "depart"
        | "straight"
        | "left"
        | "right"
        | "slight-left"
        | "slight-right"
        | "sharp-left"
        | "sharp-right"
        | "u-turn"
        | "ferry"
        | "roundabout"
        | "destination"
        | "exit-highway";
    text: string;
    distance: number;
    coords: [number, number];
    exitCoords?: [number, number];
    /** The turn's own angle at the junction (signed degrees, right
     * positive), as the way out turns from the way in — the arrow glyph is
     * drawn from it. Absent on depart / destination / roundabout. */
    angle?: number;
    exitCount?: number;
    cumulativeKm?: number;
    exitCumulativeKm?: number;
    // Index of this step's node within the route nodeSequence; lets the UI
    // resolve display-path positions through the worker's nodeDisplayIndices
    // instead of scanning the whole path by coordinates.
    nodeIndex?: number;
}

/** How sharp a left/right has to be before it reads as a U-turn. */
const U_TURN_MIN_ABS_DEG = 135;

/** The signed angle (right positive, -180..180) the way out takes from the
 * way in at the junction `curr`, or undefined where a side is unknown. */
export function turnAngle(
    prev: [number, number] | undefined,
    curr: [number, number] | undefined,
    next: [number, number] | undefined,
): number | undefined {
    if (!prev || !curr || !next) return undefined;
    const diff = getBearing(curr, next) - getBearing(prev, curr);
    return (((diff % 360) + 540) % 360) - 180;
}

export function generateDirectionsList(
    nodeSequence: number[],
    nodeKms: Float32Array,
    sequenceManeuvers: Int8Array,
    sequenceExits: Int8Array,
    nodeCoords: Map<number, [number, number]>,
): DirectionStep[] {
    const steps: DirectionStep[] = [];
    if (nodeSequence.length < 2) return steps;

    steps.push({
        id: 0,
        type: "depart",
        text: "Head on Route",
        distance: 0,
        coords: nodeCoords.get(nodeSequence[0]!) || [0, 0],
        nodeIndex: 0,
    });

    let lastStepKm = 0;
    let inRoundabout = false;

    for (let i = 0; i < nodeSequence.length - 1; i++) {
        const curr = nodeSequence[i];
        const next = nodeSequence[i + 1];
        const maneuver = sequenceManeuvers[i]!;

        if (maneuver === 3) {
            if (inRoundabout) continue;
            inRoundabout = true;
        } else {
            inRoundabout = false;
        }

        if (maneuver > 0 && maneuver !== 4) {
            let turnType: DirectionStep["type"] = "straight";
            let turnText = "";
            let exitCount = sequenceExits[i]!;

            // The junction's own angle from the geometry: the arrow is drawn
            // pointing the way the road actually goes, and a sharp enough
            // left/right reads as a U-turn.
            const angle = turnAngle(
                i > 0 ? nodeCoords.get(nodeSequence[i - 1]!) : undefined,
                nodeCoords.get(curr!),
                nodeCoords.get(next!),
            );

            switch (maneuver) {
                case 1:
                    turnType =
                        angle !== undefined &&
                        Math.abs(angle) >= U_TURN_MIN_ABS_DEG
                            ? "u-turn"
                            : "left";
                    turnText = turnType === "u-turn" ? "Make a U-turn" : "Turn left";
                    break;
                case 2:
                    turnType =
                        angle !== undefined &&
                        Math.abs(angle) >= U_TURN_MIN_ABS_DEG
                            ? "u-turn"
                            : "right";
                    turnText = turnType === "u-turn" ? "Make a U-turn" : "Turn right";
                    break;
                case 3: {
                    turnType = "roundabout";
                    if (exitCount && exitCount > 0) {
                        const suffix =
                            exitCount === 1
                                ? "st"
                                : exitCount === 2
                                  ? "nd"
                                  : exitCount === 3
                                    ? "rd"
                                    : "th";
                        turnText = `${exitCount}${suffix} exit`;
                    } else {
                        turnText = `exit at the roundabout`;
                    }
                    break;
                }
                case 5:
                    turnType = "exit-highway";
                    turnText = "Take the exit";
                    break;
                case 6:
                    turnType = "slight-left";
                    turnText = "Keep left";
                    break;
                case 7:
                    turnType = "slight-right";
                    turnText = "Keep right";
                    break;
            }

            if (turnText !== "") {
                steps[steps.length - 1]!.distance = nodeKms[i]! - lastStepKm;
                steps.push({
                    id: curr!,
                    type: turnType,
                    text: turnText,
                    distance: 0,
                    angle,
                    cumulativeKm: nodeKms[i],
                    exitCumulativeKm: nodeKms[i + 1],
                    coords: nodeCoords.get(curr!) || [0, 0],
                    exitCoords: nodeCoords.get(next!) || [0, 0],
                    exitCount: exitCount,
                    nodeIndex: i,
                });
                lastStepKm = nodeKms[i]!;
            }
        }
    }

    // Add Destination. Its km are what the card and the spoken approach
    // cues count down (map.vue's marks need `cumulativeKm` to be defined);
    // the step used to carry none, so the final cue never fired and the
    // distance read stuck at the previous turn until arrival cleared it.
    const totalKm = nodeKms[nodeSequence.length - 1];
    steps[steps.length - 1]!.distance = Math.max(0, totalKm! - lastStepKm);
    steps.push({
        id: nodeSequence[nodeSequence.length - 1]!,
        type: "destination",
        text: "Arrived",
        distance: 0,
        coords: nodeCoords.get(nodeSequence[nodeSequence.length - 1]!) || [
            0, 0,
        ],
        cumulativeKm: totalKm,
        exitCumulativeKm: totalKm,
        nodeIndex: nodeSequence.length - 1,
    });

    return steps;
}
