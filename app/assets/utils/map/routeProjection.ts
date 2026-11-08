// Route projection: where the truck sits along the drawn route path, and how
// its marker eases onto the line. Pure and map-agnostic; RouteController owns
// the live path and index window. Design follows WestPlay's route.ts
// progressOf / snapToRoute (docs/westplay-reference-study.md §2.2).

import { AGAINST_COS, toRad } from "~/assets/utils/map/maths";
import { DEG_PER_GAME_M } from "~/assets/utils/map/converters";

/** Where the truck was found on the path: the winning segment `index`, the
 * closest point `at` on it, and the distance to it in degrees. */
export interface Projection {
    index: number;
    at: [number, number];
    distanceDeg: number;
}

/** Nearest segment to `truck` among `[startSearch, searchLimit)`, running the
 * truck's way: a segment heading more than ~120° against `headingDeg` is the
 * route's own way back (a U-turn round a roundabout lies right on its way
 * there) and never wins — unless nothing in the window runs the truck's way
 * (reversing into a dock), when the raw nearest is returned instead.
 * `headingDeg: null` skips the filter entirely (whole-route lookups, where
 * the truck's heading says nothing about the segment it seeks).
 * A tie goes to the later point: the truck is past a node it stands on. */
export function projectAlongPath(
    path: readonly [number, number][],
    startSearch: number,
    searchLimit: number,
    truck: [number, number],
    headingDeg: number | null,
): Projection | null {
    // The truck's way as a unit vector in degree space: this map's Mercator
    // frame is conformal to within ~5% at the latitudes it lives at, far
    // inside the filter's 120°.
    const truckDirX =
        headingDeg === null ? 0 : Math.sin(toRad(headingDeg));
    const truckDirY =
        headingDeg === null ? 0 : Math.cos(toRad(headingDeg));

    let alongIndex = -1;
    let alongSqDist = Infinity;
    let alongAt: [number, number] = [0, 0];
    let anyIndex = -1;
    let anySqDist = Infinity;
    let anyAt: [number, number] = [0, 0];

    const last = Math.min(searchLimit, path.length - 1);
    for (let i = Math.max(0, startSearch); i < last; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        let ax = a[0];
        let ay = a[1];
        const dx = b[0] - ax;
        const dy = b[1] - ay;
        const lenSq = dx * dx + dy * dy;
        const t =
            lenSq === 0
                ? 0
                : Math.max(
                      0,
                      Math.min(
                          1,
                          ((truck[0] - ax) * dx + (truck[1] - ay) * dy) /
                              lenSq,
                      ),
                  );
        if (t >= 1) {
            ax = b[0];
            ay = b[1];
        } else if (t > 0) {
            ax += dx * t;
            ay += dy * t;
        }
        const ex = truck[0] - ax;
        const ey = truck[1] - ay;
        const distSq = ex * ex + ey * ey;

        if (distSq <= anySqDist) {
            anyIndex = i;
            anySqDist = distSq;
            anyAt = [ax, ay];
        }
        if (
            lenSq > 0 &&
            headingDeg !== null &&
            (dx * truckDirX + dy * truckDirY) / Math.sqrt(lenSq) >
                AGAINST_COS &&
            distSq <= alongSqDist
        ) {
            alongIndex = i;
            alongSqDist = distSq;
            alongAt = [ax, ay];
        }
    }

    if (alongIndex >= 0) {
        return { index: alongIndex, at: alongAt, distanceDeg: Math.sqrt(alongSqDist) };
    }
    if (anyIndex >= 0) {
        return { index: anyIndex, at: anyAt, distanceDeg: Math.sqrt(anySqDist) };
    }
    return null;
}

/** The snap reach (game ground metres): full snap within 10 m of the line,
 * none beyond 18 m, easing between — leaving (or joining) never jumps. */
const SNAP_FULL_GAME_M = 10;
const SNAP_NONE_GAME_M = 18;

const SNAP_FULL_DEG = SNAP_FULL_GAME_M * DEG_PER_GAME_M;
const SNAP_NONE_DEG = SNAP_NONE_GAME_M * DEG_PER_GAME_M;

/** 0..1: how far the marker at `distanceDeg` glides onto the line. */
export function snapWeightOf(distanceDeg: number): number {
    return Math.max(
        0,
        Math.min(1, (SNAP_NONE_DEG - distanceDeg) / (SNAP_NONE_DEG - SNAP_FULL_DEG)),
    );
}

/** The truck's display place while it's on the route: eased onto the line by
 * the snap weight, so the marker never jumps on or off it. */
export function snapCoords(
    truck: [number, number],
    at: [number, number],
    weight: number,
): [number, number] {
    return [
        truck[0] + (at[0] - truck[0]) * weight,
        truck[1] + (at[1] - truck[1]) * weight,
    ];
}
