let adjacency: Map<number, any[]> | null = null;
let nodeCoordsF64: Float64Array | null = null;
let nodeCoordsMapInstance: TypedNodeCoordsMap | null = null;

import {
    buildRouteStatsCache,
    calculateRoute,
    resetRoutingState,
    type WorkerCityArea,
    simplifyPath,
    smoothPath,
} from "~/assets/utils/routing/algorithm";
import {
    finishRouteAtDoor,
    truckHeadApproach,
    yardJoinPoint,
} from "~/assets/utils/routing/approachLines";
import type { MapScaleConfig } from "~/composables/CityData";

let cityNodes: WorkerCityArea[] | null = null;
let geometryF32: Float32Array | null = null;
let workerScaleConfig: MapScaleConfig = {
    ruralScale: 19,
    urbanScale: 3,
    hasUkRule: true,
};

// Toll-gate POI points accumulated by the main thread from the loaded map
// tiles; rebuilt into a node set lazily whenever the revision advances.
const TOLL_NODE_RADIUS_KM = 0.5;
let tollPointsGeo: [number, number][] = [];
let tollPointsRevision = 0;
let tollNodeSetBuilt = -1;
let tollNodeSet: Set<number> | null = null;

// The polyline geometry of one graph edge, looked up in the loaded adjacency.
// The endpoint wiring (approachLines) slices the edge the truck stands on,
// identified by its two nodes. Null when the graph does not know the edge.
function edgeGeometry(
    fromId: number,
    toId: number,
): [number, number][] | null {
    if (!adjacency || !geometryF32) return null;
    const edges = adjacency.get(fromId);
    if (!edges) return null;
    const edge = edges.find((e) => e.to === toId);
    if (
        !edge ||
        edge.startIndex === undefined ||
        edge.pointCount === undefined
    ) {
        return null;
    }
    const points: [number, number][] = [];
    for (let p = 0; p < edge.pointCount; p++) {
        points.push([
            geometryF32[edge.startIndex + p * 2]!,
            geometryF32[edge.startIndex + p * 2 + 1]!,
        ]);
    }
    return points;
}

function buildTollNodeSet(): Set<number> | null {
    if (tollNodeSetBuilt === tollPointsRevision) return tollNodeSet;
    tollNodeSetBuilt = tollPointsRevision;
    tollNodeSet = null;

    if (!nodeCoordsMapInstance || tollPointsGeo.length === 0) return null;

    // Spatial grid over the toll points; each node checks its 3x3 cells.
    const CELL = 0.01;
    const grid = new Map<string, [number, number][]>();
    for (const [lng, lat] of tollPointsGeo) {
        const key = `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
        const cellPoints = grid.get(key);
        if (cellPoints) cellPoints.push([lng, lat]);
        else grid.set(key, [[lng, lat]]);
    }

    const set = new Set<number>();
    for (const [nodeId, [lng, lat]] of nodeCoordsMapInstance.entries()) {
        const gx = Math.floor(lng / CELL);
        const gy = Math.floor(lat / CELL);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cellPoints = grid.get(`${gx + dx}:${gy + dy}`);
                if (!cellPoints) continue;

                for (const [tollLng, tollLat] of cellPoints) {
                    const dxKm = (tollLng - lng) * 111.0 * 0.65;
                    const dyKm = (tollLat - lat) * 111.0;
                    if (dxKm * dxKm + dyKm * dyKm <= TOLL_NODE_RADIUS_KM * TOLL_NODE_RADIUS_KM) {
                        set.add(nodeId);
                    }
                }
            }
        }
    }

    tollNodeSet = set.size > 0 ? set : null;
    return tollNodeSet;
}

class TypedNodeCoordsMap {    private array: Float64Array;
    public size: number;

    constructor(array: Float64Array) {
        this.array = array;
        this.size = array.length / 2;
    }

    get(id: number): [number, number] | undefined {
        const offset = id * 2;
        if (offset >= this.array.length) return undefined;

        const lng = this.array[offset];
        const lat = this.array[offset + 1];

        if (lng === undefined || lat === undefined) return undefined;
        if (lng === 0 && lat === 0) return undefined;

        return [lng, lat];
    }

    has(id: number): boolean {
        const offset = id * 2;
        if (offset >= this.array.length) return false;

        const lng = this.array[offset];
        const lat = this.array[offset + 1];

        if (lng === undefined || lat === undefined) return false;
        return lng !== 0 || lat !== 0;
    }

    keys(): IterableIterator<number> {
        const activeKeys: number[] = [];
        for (let i = 0; i < this.array.length; i += 2) {
            const v1 = this.array[i];
            const v2 = this.array[i + 1];
            if (
                v1 !== undefined &&
                v2 !== undefined &&
                (v1 !== 0 || v2 !== 0)
            ) {
                activeKeys.push(i / 2);
            }
        }
        return activeKeys[Symbol.iterator]();
    }

    values(): IterableIterator<[number, number]> {
        const activeValues: [number, number][] = [];
        for (let i = 0; i < this.array.length; i += 2) {
            const v1 = this.array[i];
            const v2 = this.array[i + 1];
            if (
                v1 !== undefined &&
                v2 !== undefined &&
                (v1 !== 0 || v2 !== 0)
            ) {
                activeValues.push([v1, v2]);
            }
        }
        return activeValues[Symbol.iterator]();
    }

    entries(): IterableIterator<[number, [number, number]]> {
        const activeEntries: [number, [number, number]][] = [];
        for (let i = 0; i < this.array.length; i += 2) {
            const v1 = this.array[i];
            const v2 = this.array[i + 1];
            if (
                v1 !== undefined &&
                v2 !== undefined &&
                (v1 !== 0 || v2 !== 0)
            ) {
                activeEntries.push([i / 2, [v1, v2]]);
            }
        }
        return activeEntries[Symbol.iterator]();
    }

    [Symbol.iterator](): IterableIterator<[number, [number, number]]> {
        return this.entries();
    }
}

self.onmessage = async (e: MessageEvent) => {
    const { type, requestId, payload } = e.data;

    if (type === "SET_TOLL_POINTS") {
        tollPointsGeo = payload.points ?? [];
        tollPointsRevision = payload.revision ?? 0;
        return;
    }

    if (type === "INIT_GRAPH") {
        try {
            const {
                nodesCoordsBuffer,
                graphBuffer,
                geometryBuffer,
                cities,
                scaleConfig,
            } = payload;

            geometryF32 = new Float32Array(geometryBuffer);
            const graphF32 = new Float32Array(graphBuffer);

            nodeCoordsF64 = new Float64Array(nodesCoordsBuffer);
            nodeCoordsMapInstance = new TypedNodeCoordsMap(nodeCoordsF64);

            // Drop derived edge-id mappings from a previously loaded graph so
            // the next calculation re-maps against this adjacency.
            resetRoutingState();

            adjacency = new Map();
            if (cities) cityNodes = cities;
            if (scaleConfig) workerScaleConfig = scaleConfig;

            for (let i = 0; i < graphF32.length; i += 12) {
                const u = graphF32[i]!;
                const v = graphF32[i + 1]!;
                const w = graphF32[i + 2]!;
                const hIn = graphF32[i + 3]!;
                const hOut = graphF32[i + 4]!;
                const isFerry = graphF32[i + 5] === 1;
                const requiredDlc = graphF32[i + 6];
                const vPrefabId = graphF32[i + 7];
                const startIndex = graphF32[i + 8]!;
                const pointCount = graphF32[i + 9]!;
                const maneuverType = graphF32[i + 10]!;
                const exitNumber = graphF32[i + 11]!;

                if (!adjacency.has(u)) adjacency.set(u, []);
                adjacency.get(u)!.push({
                    to: v,
                    weight: w,
                    hIn,
                    hOut,
                    isFerry,
                    requiredDlc,
                    vPrefabId,
                    startIndex,
                    pointCount,
                    maneuverType,
                    exitNumber,
                });
            }
            self.postMessage({ type: "READY" });
        } catch (err) {
            console.error("Error during INIT_GRAPH inside worker:", err);
        }
    }

    if (type === "CALC_ROUTE") {
        try {
            if (!adjacency || !nodeCoordsMapInstance || !geometryF32) {
                self.postMessage({ type: "RESULT", requestId, payload: null });
                return;
            }

            const {
                startId,
                possibleEnds,
                heading,
                startType,
                targetCoords,
                ownedDlcs,
                selectedGame,
                sdkScale,
                avgSpeed,
                avoidFerries,
                avoidTolls,
            } = payload;

            const result = calculateRoute(
                startId,
                new Set(possibleEnds),
                heading,
                adjacency,
                nodeCoordsMapInstance as any,
                startType,
                ownedDlcs,
                targetCoords,
                avoidFerries === true,
                avoidTolls === true,
                avoidTolls ? buildTollNodeSet() : null,
            );

            if (result && result.path && result.nodeSequence) {
                let fullPath = [...result.path];
                let rawDisplayPath: [number, number][] = [];

                const routedEdges = result.edges || [];

                for (let i = 0; i < result.nodeSequence.length - 1; i++) {
                    const edge = routedEdges[i];

                    if (
                        edge &&
                        edge.startIndex !== undefined &&
                        edge.pointCount !== undefined
                    ) {
                        for (let p = 0; p < edge.pointCount; p++) {
                            const lng = geometryF32[edge.startIndex + p * 2]!;
                            const lat =
                                geometryF32[edge.startIndex + p * 2 + 1]!;
                            if (
                                rawDisplayPath.length > 0 &&
                                rawDisplayPath[
                                    rawDisplayPath.length - 1
                                ]![0] === lng &&
                                rawDisplayPath[
                                    rawDisplayPath.length - 1
                                ]![1] === lat
                            )
                                continue;
                            rawDisplayPath.push([lng, lat]);
                        }
                    } else {
                        rawDisplayPath.push(fullPath[i]!);
                    }
                }
                rawDisplayPath.push(fullPath[fullPath.length - 1]!);

                const simplified = simplifyPath(rawDisplayPath, 0.00003);
                const finalSmoothedPath = smoothPath(simplified, 4);

                const { stats: finalStatsCache, urbanKmMarks } =
                    buildRouteStatsCache(
                        finalSmoothedPath,
                        cityNodes,
                        selectedGame,
                        sdkScale,
                        avgSpeed,
                        workerScaleConfig,
                    );

                const nodeKms = new Float32Array(result.nodeSequence.length);
                const nodeDisplayIndices = new Int32Array(
                    result.nodeSequence.length,
                );
                for (let i = 0; i < result.nodeSequence.length; i++) {
                    const originalNodePos = nodeCoordsMapInstance.get(
                        result.nodeSequence[i]!,
                    );
                    if (!originalNodePos) continue;

                    let minDistSq = Infinity;
                    let bestIdx = 0;
                    for (let j = 0; j < finalSmoothedPath.length; j++) {
                        const p = finalSmoothedPath[j]!;
                        const dSq =
                            Math.pow(p[0] - originalNodePos[0], 2) +
                            Math.pow(p[1] - originalNodePos[1], 2);
                        if (dSq < minDistSq) {
                            minDistSq = dSq;
                            bestIdx = j;
                        }
                    }
                    nodeKms[i] = finalStatsCache[bestIdx * 3]!;
                    nodeDisplayIndices[i] = bestIdx;
                }

                const sequenceManeuvers = new Int8Array(
                    result.nodeSequence.length,
                );
                const sequenceExits = new Int8Array(result.nodeSequence.length);

                for (let i = 0; i < result.nodeSequence.length - 1; i++) {
                    const edge = routedEdges[i];

                    let mType = edge ? edge.maneuverType || 0 : 0;
                    let extNum = edge ? edge.exitNumber || 0 : 0;

                    if (mType === 3) {
                        if (extNum === -3) {
                            let skippedExits = 0;

                            for (
                                let j = i + 1;
                                j < result.nodeSequence.length - 1;
                                j++
                            ) {
                                const scanU = result.nodeSequence[j]!;
                                const scanV = result.nodeSequence[j + 1]!;
                                const scanEdge = routedEdges[j];

                                if (!scanEdge || scanEdge.maneuverType !== 3)
                                    break;

                                if (scanEdge.exitNumber === -2) {
                                    extNum = skippedExits + 1;
                                    break;
                                } else if (scanEdge.exitNumber === -1) {
                                    const neighbors =
                                        adjacency.get(scanU) || [];
                                    for (const n of neighbors) {
                                        if (
                                            n.maneuverType === 3 &&
                                            n.exitNumber === -2 &&
                                            n.to !== scanV
                                        ) {
                                            skippedExits++;
                                        }
                                    }
                                } else {
                                    break;
                                }
                            }

                            if (extNum === -3) extNum = 1;
                        } else if (extNum === -1 || extNum === -2) {
                            mType = 0;
                            extNum = 0;
                        }
                    }

                    sequenceManeuvers[i] = mType;
                    sequenceExits[i] = extNum;
                }

                self.postMessage(
                    {
                        type: "RESULT",
                        requestId,
                        payload: {
                            ...result,
                            rawPath: finalSmoothedPath,
                            displayPath: finalSmoothedPath,
                            stats: finalStatsCache,
                            urbanKmMarks,
                            nodeKms: nodeKms,
                            nodeDisplayIndices: nodeDisplayIndices,
                            sequenceManeuvers: sequenceManeuvers,
                            sequenceExits: sequenceExits,
                        },
                    },
                    [
                        finalStatsCache.buffer,
                        urbanKmMarks.buffer,
                        nodeKms.buffer,
                        nodeDisplayIndices.buffer,
                        sequenceManeuvers.buffer,
                        sequenceExits.buffer,
                    ],
                );
            } else {
                self.postMessage({ type: "RESULT", requestId, payload: null });
            }
        } catch (error) {
            console.error("Web Worker calculation crash caught:", error);
            self.postMessage({ type: "RESULT", requestId, payload: null });
        }
    }

    if (type === "CALC_MULTI_ROUTE") {
        try {
            if (!adjacency || !nodeCoordsMapInstance || !geometryF32) {
                self.postMessage({ type: "RESULT", requestId, payload: null });
                return;
            }

            const {
                startId,
                waypointsCoords,
                waypointsNodeGroups,
                heading,
                startType,
                ownedDlcs,
                selectedGame,
                sdkScale,
                avgSpeed,
                avoidFerries,
                avoidTolls,
            } = payload;

            const tollNodes = avoidTolls ? buildTollNodeSet() : null;

            // Counting set: built whenever toll POIs are known, so every
            // route (not only toll-avoided ones) can report gate counts.
            const countableTollNodes =
                tollPointsGeo.length > 0 ? buildTollNodeSet() : tollNodes;

            let currentStartId = startId;
            let currentHeading = heading;
            let currentStartType = startType;

            const combinedNodeSequence: number[] = [];
            const combinedEdges: any[] = [];
            const combinedPathCoords: [number, number][] = [];
            const snappedNodeIds: number[] = [];

            // Loop through each segment sequentially
            for (let i = 0; i < waypointsNodeGroups.length; i++) {
                const targetCoords = waypointsCoords[i];
                const candidateEnds = new Set<number>(waypointsNodeGroups[i]);

                // Calculate current segment route
                const segmentResult = calculateRoute(
                    currentStartId,
                    candidateEnds,
                    currentHeading,
                    adjacency,
                    nodeCoordsMapInstance as any,
                    currentStartType,
                    ownedDlcs,
                    targetCoords,
                    avoidFerries === true,
                    avoidTolls === true,
                    tollNodes,
                );

                if (!segmentResult) {
                    self.postMessage({ type: "RESULT", requestId, payload: null });
                    return;
                }

                const segmentEdges = segmentResult.edges || [];

                // Extract display coordinates for this segments geometry
                const segmentDisplayPath: [number, number][] = [];
                for (
                    let j = 0;
                    j < segmentResult.nodeSequence.length - 1;
                    j++
                ) {
                    const edge = segmentEdges[j];

                    if (
                        edge &&
                        edge.startIndex !== undefined &&
                        edge.pointCount !== undefined
                    ) {
                        for (let p = 0; p < edge.pointCount; p++) {
                            const lng = geometryF32[edge.startIndex + p * 2]!;
                            const lat =
                                geometryF32[edge.startIndex + p * 2 + 1]!;

                            if (
                                segmentDisplayPath.length > 0 &&
                                segmentDisplayPath[
                                    segmentDisplayPath.length - 1
                                ]![0] === lng &&
                                segmentDisplayPath[
                                    segmentDisplayPath.length - 1
                                ]![1] === lat
                            ) {
                                continue;
                            }
                            segmentDisplayPath.push([lng, lat]);
                        }
                    } else {
                        segmentDisplayPath.push(segmentResult.path[j]!);
                    }
                }

                let arrivalHeading = 0;
                if (segmentEdges.length > 0) {
                    const edge =
                        segmentEdges[segmentEdges.length - 1];
                    arrivalHeading = edge ? edge.hOut || 0 : 0;
                }

                if (combinedNodeSequence.length > 0) {
                    combinedNodeSequence.pop();
                }

                combinedNodeSequence.push(...segmentResult.nodeSequence);
                for (const segmentEdge of segmentEdges) {
                    combinedEdges.push(segmentEdge);
                }
                combinedPathCoords.push(...segmentDisplayPath);
                snappedNodeIds.push(segmentResult.endId);

                currentStartId = segmentResult.endId;
                currentHeading = arrivalHeading;
                currentStartType = "road";
            }

            const simplified = simplifyPath(combinedPathCoords, 0.00003);
            const smoothed = smoothPath(simplified, 4);

            // Wire the route's real ends onto the drawn line before the stats
            // cache is built, so remaining km, ETA and the arrival test
            // measure to the places the drive actually has: in front, the
            // truck leads the line with the road behind the start node (the
            // route would else start at the node ahead of it, leaving the
            // stretch under the wheels behind the line — read as a deviation,
            // and double-counted in the distance); behind, the line is cut at
            // the destination's door (it would else run to the snapped node
            // and report arrival there, however far the place stood). See
            // approachLines for what makes each splice honest.
            const startEdge = payload.startEdge;
            const approachEdgePoints =
                startEdge && startEdge.fromId !== startEdge.toId
                    ? edgeGeometry(startEdge.fromId, startEdge.toId)
                    : null;
            const headApproach =
                approachEdgePoints && approachEdgePoints.length >= 2
                    ? truckHeadApproach(
                          approachEdgePoints,
                          payload.truckCoords ?? null,
                          smoothed[0]!,
                      )
                    : [
                          yardJoinPoint(
                              smoothed[0]!,
                              payload.truckCoords ?? null,
                          ),
                      ].filter((p): p is [number, number] => p !== null);
            const doorCut = finishRouteAtDoor(
                smoothed,
                waypointsCoords[waypointsCoords.length - 1] ?? null,
            );
            const finalSmoothedPath =
                headApproach.length > 0
                    ? [...headApproach, ...doorCut]
                    : doorCut;

            const { stats: finalStatsCache, urbanKmMarks } =
                buildRouteStatsCache(
                    finalSmoothedPath,
                    cityNodes,
                    selectedGame,
                    sdkScale,
                    avgSpeed,
                    workerScaleConfig,
                );

            const nodeKms = new Float32Array(combinedNodeSequence.length);
            const nodeDisplayIndices = new Int32Array(
                combinedNodeSequence.length,
            );
            for (let i = 0; i < combinedNodeSequence.length; i++) {
                const originalNodePos = nodeCoordsMapInstance.get(
                    combinedNodeSequence[i]!,
                );
                if (!originalNodePos) continue;

                let MinDistSq = Infinity;
                let bestIdx = 0;
                for (let j = 0; j < finalSmoothedPath.length; j++) {
                    const p = finalSmoothedPath[j]!;
                    const dSq =
                        Math.pow(p[0] - originalNodePos[0], 2) +
                        Math.pow(p[1] - originalNodePos[1], 2);

                    if (dSq < MinDistSq) {
                        MinDistSq = dSq;
                        bestIdx = j;
                    }
                }
                nodeKms[i] = finalStatsCache[bestIdx * 3]!;
                nodeDisplayIndices[i] = bestIdx;
            }

            // The final node stands for the destination in the guidance (the
            // "Arrived" step's km and its spoken marks count down to it), so
            // map it to the line's true end — the door once it is wired, the
            // node itself otherwise, where this is a no-op. Without it the
            // last cue would fire a stub early and the step would advance
            // before the truck is parked.
            const lastNode = combinedNodeSequence.length - 1;
            nodeKms[lastNode] =
                finalStatsCache[(finalSmoothedPath.length - 1) * 3]!;
            nodeDisplayIndices[lastNode] = finalSmoothedPath.length - 1;

            const sequenceManeuvers = new Int8Array(
                combinedNodeSequence.length,
            );
            const sequenceExits = new Int8Array(combinedNodeSequence.length);
            for (let i = 0; i < combinedNodeSequence.length - 1; i++) {
                const edge = combinedEdges[i];

                let mType = edge ? edge.maneuverType || 0 : 0;
                let extNum = edge ? edge.exitNumber || 0 : 0;

                if (mType === 3 && extNum === -3) extNum = 1;
                sequenceManeuvers[i] = mType;
                sequenceExits[i] = extNum;
            }

            // Route costs reported alongside the geometry: ferry legs come
            // straight off the edge flags; toll gates count as zone entries
            // (a node inside a toll-gate radius whose predecessor isn't).
            let ferryCount = 0;
            for (const edge of combinedEdges) {
                if (edge && edge.isFerry) ferryCount++;
            }

            let tollCount = 0;
            if (countableTollNodes) {
                let prevInZone = false;
                for (const nodeId of combinedNodeSequence) {
                    const inZone = countableTollNodes.has(nodeId);
                    if (inZone && !prevInZone) tollCount++;
                    prevInZone = inZone;
                }
            }

            self.postMessage(
                {
                    type: "RESULT",
                    requestId,
                    payload: {
                        nodeSequence: combinedNodeSequence,
                        displayPath: finalSmoothedPath,
                        stats: finalStatsCache,
                        urbanKmMarks,
                        nodeKms,
                        nodeDisplayIndices,
                        sequenceManeuvers,
                        sequenceExits,
                        snappedNodeIds,
                        ferryCount,
                        tollCount,
                        endId: combinedNodeSequence[
                            combinedNodeSequence.length - 1
                        ],
                    },
                },
                [
                    finalStatsCache.buffer,
                    urbanKmMarks.buffer,
                    nodeKms.buffer,
                    nodeDisplayIndices.buffer,
                    sequenceManeuvers.buffer,
                    sequenceExits.buffer,
                ],
            );
        } catch (error) {
            console.error("Multi-routing worker error:", error);
            self.postMessage({ type: "RESULT", requestId, payload: null });
        }
    }
};
