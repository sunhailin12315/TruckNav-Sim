import { describe, expect, it } from "vitest";
import { DEG_PER_GAME_M } from "~/assets/utils/map/converters";
import {
    ARRIVAL_REACH_DEG,
    DOOR_OFFSET_MAX_GAME_M,
    finishRouteAtDoor,
    isArrived,
    truckHeadApproach,
    yardJoinPoint,
} from "~/assets/utils/routing/approachLines";

const deg = (gameM: number) => gameM * DEG_PER_GAME_M;

// A route running north along lng 10 with one point every 100 game-m, its
// last point the graph node the destination snapped to.
const node = (i: number): [number, number] => [10, deg(i * 100)];
const route = () => Array.from({ length: 11 }, (_, i) => node(i));

describe("truckHeadApproach", () => {
    it("slices the truck's edge at its position", () => {
        // Truck mid-edge (edge runs (0,0)→(0,400)→route head (0,800)→node).
        const edge: [number, number][] = [
            [10, 0],
            [10, deg(400)],
            node(8),
        ];
        const truck: [number, number] = [10, deg(300)];
        const head = truckHeadApproach(edge, truck, node(8));
        // Leads at the truck's projection, follows real geometry, and hands
        // over to the route's head without repeating it.
        expect(head[0]).toEqual(truck);
        expect(head[head.length - 1]).toEqual(node(4));
        expect(head).not.toContainEqual(node(8));
    });

    it("wires nothing when the truck already stands on the route's head", () => {
        const edge: [number, number][] = [[10, deg(500)], node(8)];
        expect(truckHeadApproach(edge, node(8), node(8))).toEqual([]);
    });

    it("wires nothing when the edge no longer joins the head (stale)", () => {
        const stale: [number, number][] = [
            [10, deg(100)],
            [10, deg(500)],
        ];
        expect(truckHeadApproach(stale, [10, deg(300)], node(8))).toEqual([]);
    });

    it("wires nothing without an edge (no position to slice from)", () => {
        expect(truckHeadApproach(null, [10, deg(300)], node(8))).toEqual([]);
    });
});

describe("yardJoinPoint", () => {
    it("joins a truck standing in the lot to the line's head", () => {
        const truck: [number, number] = [10.001, deg(760)];
        expect(yardJoinPoint(node(8), truck)).toEqual(truck);
    });

    it("leaves a far-away truck to the edge geometry", () => {
        expect(yardJoinPoint(node(8), [10, deg(100)])).toBeNull();
    });
});

describe("finishRouteAtDoor", () => {
    it("ends the line at the destination, dropping the node overshoot", () => {
        const path = route(); // ends at node(10)
        // The true destination beside the road, 120 game-m short of the node.
        const destination: [number, number] = [10 + deg(10), deg(980)];
        const cut = finishRouteAtDoor(path, destination);
        expect(cut[cut.length - 1]).toEqual(destination);
        expect(cut.length).toBeLessThan(path.length + 2);
        expect(cut[0]).toEqual(path[0]);
    });

    it("refuses to cut where the line only passed the place early", () => {
        const path = route();
        // Beside the road near the *start* — the destination is not there.
        const destination: [number, number] = [10 + deg(10), deg(120)];
        expect(finishRouteAtDoor(path, destination)).toBe(path);
    });

    it("refuses a door too far off the road to claim", () => {
        const path = route();
        const destination: [number, number] = [
            10 + deg(DOOR_OFFSET_MAX_GAME_M + 500),
            deg(950),
        ];
        expect(finishRouteAtDoor(path, destination)).toBe(path);
    });

    it("leaves the path when the snap already landed on the door", () => {
        const path = route();
        expect(finishRouteAtDoor(path, node(10))).toBe(path);
    });

    it("does nothing without a destination", () => {
        const path = route();
        expect(finishRouteAtDoor(path, null)).toBe(path);
    });
});

describe("isArrived", () => {
    const routeEnd = node(10);
    const destination: [number, number] = [10 + deg(10), deg(980)];

    it("fires at the line's end with the trip over", () => {
        const truck: [number, number] = [10, deg(970)];
        expect(isArrived(truck, routeEnd, destination, 0.2)).toBe(true);
    });

    it("fires parked on the door mid-final-stretch", () => {
        // Cutting across the lot: the line still has some km to run.
        const truck: [number, number] = [10 + deg(10), deg(980)];
        expect(isArrived(truck, routeEnd, destination, 3)).toBe(true);
    });

    it("does not fire parked on a place the route passed early", () => {
        // The old bug's shape: chord near, most of the trip still to run.
        const passedEarly: [number, number] = [10, deg(200)];
        expect(isArrived(passedEarly, routeEnd, passedEarly, 120)).toBe(false);
    });

    it("does not fire passing the end on a parallel way with route left", () => {
        const truck: [number, number] = [10.0005, deg(980)];
        expect(isArrived(truck, routeEnd, destination, 40)).toBe(false);
    });

    it("does not fire beyond the chord reach", () => {
        const truck: [number, number] = [10, deg(980) + ARRIVAL_REACH_DEG * 2];
        expect(isArrived(truck, routeEnd, null, 0)).toBe(false);
    });
});
