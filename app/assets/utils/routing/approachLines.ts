// Endpoint wiring: making the route's two ends sit where the drive actually
// starts and ends.
//
// The road graph only knows node coordinates, so both ends of a guided route
// are really *snaps*: the destination to the nearest graph node (the 0.1° box
// alone reaches ~524 game-m — some 10 presented km at rural scale — and the
// fallback rungs widen it further), and the truck's start to the node at the
// far end of the edge it faces. The guided route therefore *ended* at that
// node rather than at the destination — "arrived" while the place was still
// visibly ahead — and *began* at the node just down the road from the truck,
// leaving the stretch under its wheels behind the drawn line (which the
// deviation check then read as a wrong turn, reroute after reroute).
//
// The fix follows OSRM (radius-limited endpoint snapping) and WestPlay's
// approachLine: keep the graph route between the snapped nodes, then wire its
// ends to the real places before the stats cache is built — inventing no
// geometry along the way:
//
// - head: slice the edge the truck stands on at the truck's projection and
//   lead the drawn line with the real road from there to the route's first
//   node. Guidance and the remaining distance begin under the wheels instead
//   of a node down the road (a yard start, off any edge, joins with a short
//   stub when the line's head is within the lot apron).
// - end: run the route to the destination's *door* — the point of the line
//   nearest the true target (the snapped node standing in for it) — and
//   finish with that turn-in as the route's last vertex. Total km, ETA, the
//   spoken approach cues and the arrival test stop at the place the driver
//   aimed at. When the line never runs near the target (a fallback snap
//   across a sparse stretch, an island behind a ferry), nothing is wired:
//   the route honestly ends at the node the truck can reach, rather than
//   claiming a straight line across country is the drive.
//
// Pure and testable. The route worker wires the path; RouteController owns the
// arrival test. Distances speak this map's degrees, like the rest of the
// geometry stack; conversions go through DEG_PER_GAME_M (game ground), and the
// bounds are stated in game-m — one game-metre is ~19 m of the driver's rural
// world.

import { DEG_PER_GAME_M } from "~/assets/utils/map/converters";
import { getSquaredDist } from "~/assets/utils/map/maths";

/** Below this a splice point is invisible: skip it rather than fold a
 * near-duplicate vertex into the line. */
const MIN_STUB_GAME_M = 2;

/** The door may cut the route only when the true destination lies this close
 * to the drawn line (game-m ≈ 2.3 presented km): a gate or a roadside click
 * sits beside the road the route runs on, so the door point is where the drive
 * turns in. A target further off the line is off the network itself; there the
 * node stays the honest end of the route. */
export const DOOR_OFFSET_MAX_GAME_M = 120;
const DOOR_OFFSET_MAX_DEG = DOOR_OFFSET_MAX_GAME_M * DEG_PER_GAME_M;

/** How far back from the path's end the door search runs (segments). The door
 * belongs at the *end* of the drive — the final node stands for this
 * destination — so a target nearest the middle of the line is a town the route
 * passes through, not the place, and must never cut the trip short. The window
 * also bounds the scan on very long routes. */
const DOOR_SEARCH_SEGMENTS = 800;

/** How far back from the line's end the door may sit, measured along the line
 * (game-m): the snapped node usually stands a little *past* the turn-in, so
 * the cut drops a short overshoot. A node far beyond the door came from a
 * widened fallback snap standing on the approach road, not beside the target
 * — cutting there would end a city route at its motorway exit, so such doors
 * stay unwired. */
const MAX_DOOR_OVERSHOOT_GAME_M = 750;

/** Chord reach of the route's end for arrival, in game-m (≈0.8 presented km):
 * standing this close, you have arrived. About the old test's reach (~37) — but
 * the old test read against the *snapped node* and nothing else, which is what
 * ended a run while the destination itself stood visibly far off. */
export const ARRIVAL_REACH_GAME_M = 40;
export const ARRIVAL_REACH_DEG = ARRIVAL_REACH_GAME_M * DEG_PER_GAME_M;

/** ...and at most this much route (presented km) may still lie along the
 * line: the trip has to be genuinely over, not merely passing beside the
 * destination on a parallel carriageway — or standing at the start of a
 * route that loops back near its own end. PARKED_REACH below is the single
 * exception, itself bounded so only the tail of the run can fire it. */
export const ARRIVAL_REMAINING_KM = 1.0;

/** Parked-on-the-destination reach (game-m): a truck standing right at the
 * place has arrived even while the line still has some road to run — cutting
 * across the lot to the door spends no route km. PARKED_REMAINING_CAP bounds
 * it so only the *end* of the run can fire it: a route that passes the
 * destination early and loops back is not arrival (that is the bug this
 * replaced). */
const PARKED_REACH_GAME_M = 15;
const PARKED_REACH_DEG = PARKED_REACH_GAME_M * DEG_PER_GAME_M;
const PARKED_REMAINING_CAP_KM = 5.0;

/** A truck with no edge geometry behind it (a yard start: standing in the lot,
 * not on a graph edge) may still lead the line with a straight stub when it
 * stands this close to the route's first point (game-m ≈ one yard apron). */
const YARD_STUB_MAX_GAME_M = 150;

const gameM = (distanceDeg: number) => distanceDeg / DEG_PER_GAME_M;

/** The point on segment `a`→`b` closest to `p`, and how far it is. */
function projectOnSegment(
    p: [number, number],
    a: [number, number],
    b: [number, number],
): { at: [number, number]; sq: number } {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    const t =
        lenSq === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
              );
    const at: [number, number] = [a[0] + dx * t, a[1] + dy * t];
    return { at, sq: getSquaredDist(p, at) };
}

/**
 * The point to lead the route with when the truck stands off any graph edge
 * (a yard start): its own position, when that is within YARD_STUB_MAX_GAME_M
 * of the route's first point — the apron of the lot it is leaving. Null
 * otherwise; the graph's own head edge (truckHeadApproach) is preferred
 * wherever there is one.
 */
export function yardJoinPoint(
    routeStart: [number, number],
    truck: [number, number] | null,
): [number, number] | null {
    if (!truck) return null;
    const game = gameM(Math.sqrt(getSquaredDist(routeStart, truck)));
    if (game < MIN_STUB_GAME_M || game > YARD_STUB_MAX_GAME_M) return null;
    return [truck[0], truck[1]];
}

/**
 * The road between the truck and the route's first point. `edgePoints` is the
 * geometry of the edge the truck snapped onto (its far end *is* the route's
 * first node — the same graph coordinates, so a fresh picture matches exactly
 * and the join check below is a staleness guard, not a tolerance); `truck` is
 * the truck's position. Returns the points to lead the drawn route with: the
 * truck's projection on that edge, then the real geometry forward to — but
 * not including — the route's first node (the path already begins there), so
 * guidance and the remaining distance begin under the wheels instead of at
 * the node ahead of them.
 *
 * Returns [] when nothing can honestly be wired: no edge given, the truck
 * already standing on the route's head, or the slice not joining the head (the
 * edge the main thread named is not the route's head edge any more).
 */
export function truckHeadApproach(
    edgePoints: [number, number][] | null,
    truck: [number, number] | null,
    routeFirstPoint: [number, number],
): [number, number][] {
    if (!truck || !edgePoints || edgePoints.length < 2) return [];

    // Where the cut lands: the edge segment nearest the truck, projected on.
    let bestSeg = -1;
    let bestSq = Infinity;
    let bestAt: [number, number] = truck;
    for (let i = 0; i < edgePoints.length - 1; i++) {
        const { at, sq } = projectOnSegment(
            truck,
            edgePoints[i]!,
            edgePoints[i + 1]!,
        );
        if (sq < bestSq) {
            bestSq = sq;
            bestAt = at;
            bestSeg = i;
        }
    }
    if (bestSeg < 0) return [];

    const head: [number, number][] = [
        bestAt,
        ...edgePoints
            .slice(bestSeg + 1)
            .map((p) => [p[0], p[1]] as [number, number]),
    ];

    // The slice's end must actually reach the route's head — anything else is
    // a stale edge (a reroute racing telemetry) and the graph's own head stays
    // the honest line.
    if (
        gameM(
            Math.sqrt(getSquaredDist(head[head.length - 1]!, routeFirstPoint)),
        ) > MIN_STUB_GAME_M * 10
    ) {
        return [];
    }

    // Already standing on the route's head: nothing to lead with.
    if (
        gameM(Math.sqrt(getSquaredDist(head[0]!, routeFirstPoint))) <
        MIN_STUB_GAME_M
    ) {
        return [];
    }

    // The route's own head comes off the tail: the path already begins at
    // that node, and the slice hands over to it rather than repeating it.
    while (
        head.length > 1 &&
        gameM(
            Math.sqrt(getSquaredDist(head[head.length - 1]!, routeFirstPoint)),
        ) < MIN_STUB_GAME_M
    ) {
        head.pop();
    }

    return head;
}

/**
 * End the route at the destination's *door* instead of at the graph node the
 * destination snapped to: find the point of the line nearest the true target,
 * drop the overshoot beyond it, and finish with the short turn-in so the
 * line's last vertex *is* the destination. The total km, the ETA, the
 * approach cues and the arrival test then stop at the place the driver aimed
 * at, which is what "arrived" must mean.
 *
 * Returns the path unchanged when no destination is known; when the door lies
 * farther off the road than DOOR_OFFSET_MAX (a place genuinely off the
 * network — its node stays the honest end of a drive that can reach it);
 * when the door is already the line's end (the snap found it); or when the
 * door sits so far back along the line that the route only passed the place
 * early — cutting there would end a city route at its motorway exit, which
 * is a rerun of the very bug this wires.
 */
export function finishRouteAtDoor(
    path: [number, number][],
    destination: [number, number] | null,
): [number, number][] {
    if (!destination || path.length < 2) return path;

    const from = Math.max(0, path.length - 1 - DOOR_SEARCH_SEGMENTS);

    let bestSeg = -1;
    let bestSq = Infinity;
    let bestAt: [number, number] = destination;
    for (let i = from; i < path.length - 1; i++) {
        const { at, sq } = projectOnSegment(
            destination,
            path[i]!,
            path[i + 1]!,
        );
        if (sq < bestSq) {
            bestSq = sq;
            bestAt = at;
            bestSeg = i;
        }
    }
    if (bestSeg < 0) return path;
    if (Math.sqrt(bestSq) > DOOR_OFFSET_MAX_DEG) return path;

    // How far back from the line's end the door lies: the remainder of the
    // cut segment plus every whole segment beyond it.
    const partial = gameM(
        Math.sqrt(getSquaredDist(bestAt, path[bestSeg + 1]!)),
    );
    let tailGameM = partial;
    for (let i = bestSeg + 1; i < path.length - 1; i++) {
        tailGameM += gameM(
            Math.sqrt(getSquaredDist(path[i]!, path[i + 1]!)),
        );
    }

    // The door already is the line's end (the snap landed on it).
    if (tailGameM < MIN_STUB_GAME_M) return path;
    // The place lies early on the line — not this drive's end.
    if (tailGameM > MAX_DOOR_OVERSHOOT_GAME_M) return path;

    // Cut at the door: everything up to the nearest road point, then the
    // turn-in stub onto the destination itself. The cut lands on the next
    // vertex when the projection sits on it, rather than folding a
    // near-duplicate point into the line.
    const cut = path.slice(0, bestSeg + 1);
    cut.push(partial < MIN_STUB_GAME_M ? path[bestSeg + 1]! : bestAt);
    cut.push(destination);
    return cut;
}

/**
 * Arrival, judged against the truth of where the drive ends: the route's last
 * point (the destination's door once one is cut, the last reachable node
 * otherwise) *and* the destination the driver aimed at. Either near the
 * line's end with the trip genuinely over along it, or parked on the
 * destination itself with only the tail of the run left — cutting across the
 * lot to the door spends no route km, but a route that merely passes the
 * place early, miles still to run, has not arrived (that is the bug this
 * replaced: the old bare-chord test to the *node*, fired on any road passing
 * it, checked nothing along the route).
 */
export function isArrived(
    truck: [number, number],
    routeEnd: [number, number],
    destination: [number, number] | null,
    remainingAlongRouteKm: number,
    reachDeg: number = ARRIVAL_REACH_DEG,
    remainingCapKm: number = ARRIVAL_REMAINING_KM,
): boolean {
    const chordToDest = destination
        ? Math.sqrt(getSquaredDist(truck, destination))
        : Infinity;
    // Parked at the door: arrival even though the line still has road to run.
    if (
        chordToDest <= PARKED_REACH_DEG &&
        remainingAlongRouteKm <= PARKED_REMAINING_CAP_KM
    ) {
        return true;
    }
    if (remainingAlongRouteKm > remainingCapKm) return false;
    if (Math.sqrt(getSquaredDist(truck, routeEnd)) <= reachDeg) return true;
    return chordToDest <= reachDeg;
}
