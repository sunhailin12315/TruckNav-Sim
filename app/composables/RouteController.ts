import maplibregl from "maplibre-gl";
import { generateDestinationIcon } from "~/assets/utils/map/markers";
import {
    getBearing,
    getSqDistToSegment,
    DEVIATION_THRESHOLD_SQ,
    getSquaredDist,
} from "~/assets/utils/map/maths";
import {
    deleteMapLibreData,
    setMapLibreData,
} from "~/assets/utils/map/helpers";
import {
    generateDirectionsList,
    type DirectionStep,
} from "~/assets/utils/routing/directions";
import {
    findNearestPoiAhead,
    estimateDetourMinutes,
    type PoiHit,
} from "~/assets/utils/routing/poiAlongRoute";
import {
    buildRouteAlternatives,
    summarizeRouteResult,
    type RouteAlternativeFlags,
    type RouteAlternativeSummary,
} from "~/assets/utils/routing/routeAlternatives";

import RouteWorker from "~/workers/route.worker?worker&inline";

const REAL_TIME_DELAY_FACTOR = 0.25;
const MAX_REAL_TIME_DELAY_MINUTES = 10;
const PLANNING_CHECK_INTERVAL_MS = 2000;
const REST_PLANNING_THRESHOLD_MIN = 90;
const REST_SEARCH_KM_AHEAD = 150;
const FUEL_SEARCH_KM_AHEAD = 150;
const POI_MAX_DETOUR_KM = 3;
const TOLL_ACCUMULATE_INTERVAL_MS = 10000;

// Session-wide toll-gate POI cache: the map only exposes POIs from tiles
// loaded so far, so points accumulate as the driver's viewport sweeps the
// route. Reroutes use the set built so far (best-effort, grows over time).
let sessionTollPoints: [number, number][] = [];
let sessionTollRevision = 0;
let sessionTollAccumulatedAt = 0;

export const useRouteController = (
    map: Ref<maplibregl.Map | null>,
    adjacency: Map<number, any>,
    nodeCoords: Map<number, [number, number]>,
    stopNavigationMode: () => void,
) => {
    const { getGameLocationName, getWorkerCityData, mapScaleConfig } =
        useCityData();
    const { getClosestNodes } = useGraphSystem();
    const { settings, activeSettings, updateGlobal, updateProfile } =
        useSettings();

    const currentRoutePath = shallowRef<[number, number][] | null>(null);
    const routeStatsCache = shallowRef<Float32Array | null>(null);
    // Absolute km marks where the route transitions into an urban area.
    const routeUrbanKmMarks = shallowRef<Float32Array | null>(null);
    let nextUrbanMarkIdx = 0;
    // Maps nodeSequence index -> displayPath index, provided by the worker.
    const nodeDisplayIndicesCache = shallowRef<Int32Array | null>(null);

    const destinationName = ref<string>("");
    const routeDistance = ref<number>(0);
    const routeEta = ref<string>("");

    const isRouteActive = ref(false);
    const isYardStart = ref(false);

    const isTruckInYard = ref(false);

    const startNodeId = ref<number | null>(null);
    const endNodeId = ref<number | null>(null);
    const lastMathPos = ref<[number, number] | null>(null);

    const isCalculating = ref(false);
    const routeFound = ref<boolean | null>(null);

    // Incremented once each time the route approaches an urban entry point.
    const urbanAheadTrigger = ref(0);

    // Rest/fuel planning: the next reachable service area or gas station
    // along the route, drawn as a marker and announced once.
    const serviceSuggestion = ref<{
        kind: "rest" | "fuel";
        kmAhead: number;
        coords: [number, number];
        detourKm: number;
        detourMinutes: number;
    } | null>(null);
    let lastPlanningCheck = 0;

    // Alternative routes (fewer tolls / fewer ferries), computed in the
    // background right after a route is planned. Deviation reroutes do not
    // recompute them: the primary route must stay latency-free.
    const routeAlternatives = ref<RouteAlternativeSummary[] | null>(null);
    const primaryRouteSummary = ref<RouteAlternativeSummary | null>(null);
    let alternativesToken = 0;

    function querySpritePoints(sprite: string): [number, number][] {
        if (!map.value) return [];

        const features = map.value.querySourceFeatures("all-data", {
            sourceLayer: "spritelocations",
            filter: ["==", ["get", "sprite"], sprite],
        });

        const points: [number, number][] = [];
        for (const feature of features) {
            const geom = feature.geometry as { type: string; coordinates: unknown };
            if (geom?.type !== "Point") continue;
            const coords = geom.coordinates as [number, number];
            points.push([coords[0]!, coords[1]!]);
        }
        return points;
    }

    /**
     * Pulls toll-gate POIs from the currently loaded tiles into the session
     * cache and pushes the cache to the worker when it grew.
     */
    function accumulateTollPoints(force = false) {
        const now = Date.now();
        if (!force && now - sessionTollAccumulatedAt < TOLL_ACCUMULATE_INTERVAL_MS)
            return;
        sessionTollAccumulatedAt = now;

        if (!worker || !isWorkerReady.value) return;

        const seen = new Set(
            sessionTollPoints.map(([lng, lat]) => `${lng.toFixed(4)}:${lat.toFixed(4)}`),
        );

        let added = 0;
        for (const [lng, lat] of querySpritePoints("toll_ico")) {
            const key = `${lng.toFixed(4)}:${lat.toFixed(4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            sessionTollPoints.push([lng, lat]);
            added++;
        }

        if (added > 0 || force) {
            sessionTollRevision++;
            worker.postMessage({
                type: "SET_TOLL_POINTS",
                payload: {
                    points: sessionTollPoints,
                    revision: sessionTollRevision,
                },
            });
        }
    }

    function findPoiAhead(
        kind: "rest" | "fuel",
        maxKmAhead: number,
    ): PoiHit | null {
        const path = currentRoutePath.value;
        const cache = routeStatsCache.value;
        if (!path || !cache) return null;

        const sprite = kind === "rest" ? "service_ico" : "gas_ico";
        return findNearestPoiAhead(
            path,
            cache,
            currentRouteIndex.value,
            querySpritePoints(sprite),
            maxKmAhead,
            POI_MAX_DETOUR_KM,
        );
    }

    function updateSuggestionMarker() {
        if (!map.value || !map.value.getSource("service-suggestion")) return;

        const source = map.value.getSource(
            "service-suggestion",
        ) as maplibregl.GeoJSONSource;
        const suggestion = serviceSuggestion.value;

        source.setData({
            type: "FeatureCollection",
            features: suggestion
                ? [
                      {
                          type: "Feature",
                          geometry: {
                              type: "Point",
                              coordinates: suggestion.coords,
                          },
                          properties: { kind: suggestion.kind },
                      },
                  ]
                : [],
        } as any);
    }

    function updateServicePlanning(
        fuelRangeKm: number,
        restStopMinutes: number,
        avgSpeedKmh: number,
    ) {
        const now = Date.now();
        if (now - lastPlanningCheck < PLANNING_CHECK_INTERVAL_MS) return;
        lastPlanningCheck = now;

        const cache = routeStatsCache.value;
        const path = currentRoutePath.value;
        if (!cache || !path) return;

        const lastIdx = (path.length - 1) * 3;
        const currentIdx = currentRouteIndex.value * 3;
        const remGameMinutes = (cache[lastIdx + 1]! - cache[currentIdx + 1]!) * 60;
        const remKm = cache[lastIdx]! - cache[currentIdx]!;

        const restNeedsStop =
            restStopMinutes > 0 &&
            restStopMinutes < REST_PLANNING_THRESHOLD_MIN &&
            remGameMinutes > restStopMinutes;

        const fuelNeedsStop = fuelRangeKm > 0 && fuelRangeKm < remKm;

        // Rest wins: falling asleep is worse than walking to a pump.
        if (restNeedsStop) {
            if (serviceSuggestion.value?.kind !== "rest") {
                const hit = findPoiAhead("rest", REST_SEARCH_KM_AHEAD);
                if (hit) {
                    serviceSuggestion.value = {
                        kind: "rest",
                        kmAhead: Math.round(hit.kmAhead),
                        coords: hit.poiCoords,
                        detourKm: +hit.detourKm.toFixed(1),
                        detourMinutes: estimateDetourMinutes(
                            hit.detourKm,
                            avgSpeedKmh,
                        ),
                    };
                    updateSuggestionMarker();
                }
            }
            return;
        }

        // Rest taken (or trip short enough): clear the stale suggestion.
        if (serviceSuggestion.value?.kind === "rest") {
            serviceSuggestion.value = null;
            updateSuggestionMarker();
        }

        if (fuelNeedsStop) {
            if (serviceSuggestion.value?.kind !== "fuel") {
                const hit = findPoiAhead("fuel", FUEL_SEARCH_KM_AHEAD);
                if (hit) {
                    serviceSuggestion.value = {
                        kind: "fuel",
                        kmAhead: Math.round(hit.kmAhead),
                        coords: hit.poiCoords,
                        detourKm: +hit.detourKm.toFixed(1),
                        detourMinutes: estimateDetourMinutes(
                            hit.detourKm,
                            avgSpeedKmh,
                        ),
                    };
                    updateSuggestionMarker();
                }
            }
        } else if (serviceSuggestion.value?.kind === "fuel") {
            serviceSuggestion.value = null;
            updateSuggestionMarker();
        }
    }

    const currentRouteIndex = ref(0);
    const isWorkerReady = ref(false);

    const fullRouteDirections = ref<DirectionStep[]>([]);
    const nextTurnDistance = ref<number>(0);

    const waypointList = ref<[number, number][]>([]);
    const snappedWaypointNodeIds = ref<number[]>([]);

    function updateRouteEta(gameHours: number, realHours: number) {
        const usesRealTime = settings.value.routeTimeMode === "real";
        const realTimeDelay = Math.min(
            realHours * REAL_TIME_DELAY_FACTOR,
            MAX_REAL_TIME_DELAY_MINUTES / 60,
        );
        const remainingHours = usesRealTime
            ? realHours + realTimeDelay
            : gameHours;

        if (remainingHours > 0) {
            const totalMinutes = Math.round(remainingHours * 60);
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            routeEta.value = `${usesRealTime ? "~ " : ""}${h}h ${m}min`;
        } else {
            routeEta.value = "Arriving...";
        }
    }

    watch(
        () => settings.value.routeTimeMode,
        () => {
            const cache = routeStatsCache.value;
            const path = currentRoutePath.value;
            if (!cache || !path) return;

            const lastIdx = (path.length - 1) * 3;
            const currentIdx = currentRouteIndex.value * 3;

            updateRouteEta(
                cache[lastIdx + 1]! - cache[currentIdx + 1]!,
                cache[lastIdx + 2]! - cache[currentIdx + 2]!,
            );
        },
    );

    watch(
        () => activeSettings.value.themeColor,
        async (newColor) => {
            if (map.value && map.value.hasImage("destination-icon")) {
                const newPinImg = await generateDestinationIcon(newColor);
                map.value.updateImage("destination-icon", newPinImg);
            }
        },
    );

    watch(
        () => activeSettings.value.routeColor,
        (newColor) => {
            if (map.value && map.value.getLayer("route-line")) {
                map.value.setPaintProperty(
                    "route-line",
                    "line-color",
                    newColor,
                );
            }
        },
    );

    watch(
        () => activeSettings.value.hasTurnNavigation,
        (hasGuidedNavigation) => {
            if (!map.value) return;

            if (hasGuidedNavigation) {
                if (isRouteActive.value && currentRoutePath.value) {
                    drawTurnArrows(
                        fullRouteDirections.value,
                        currentRoutePath.value,
                    );
                }
            } else {
                const lineSource = map.value.getSource(
                    "turn-arrows-line-source",
                ) as maplibregl.GeoJSONSource;
                const headSource = map.value.getSource(
                    "turn-arrows-head-source",
                ) as maplibregl.GeoJSONSource;

                const emptyData: any = {
                    type: "FeatureCollection",
                    features: [],
                };

                if (lineSource) lineSource.setData(emptyData);
                if (headSource) headSource.setData(emptyData);
            }
        },
    );

    let worker: Worker | null = null;
    let workerRequestId = 0;
    if (import.meta.client) {
        worker = new RouteWorker();

        worker.onmessage = (e) => {
            if (e.data.type === "READY") console.log("Web Worker Ready.");
        };
    }

    function destroyWorker() {
        if (worker) {
            worker.terminate();
            worker = null;
        }
        isWorkerReady.value = false;
    }

    function initWorkerData(
        nodesCoordsBuffer: ArrayBuffer,
        graphBuffer: ArrayBuffer,
        geometryBuffer: ArrayBuffer,
    ) {
        if (!worker) return;
        const cityPayload = getWorkerCityData();

        const transferables: Transferable[] = [
            nodesCoordsBuffer,
            graphBuffer,
            geometryBuffer,
        ];

        worker.postMessage(
            {
                type: "INIT_GRAPH",
                payload: {
                    nodesCoordsBuffer: nodesCoordsBuffer,
                    graphBuffer: graphBuffer,
                    geometryBuffer: geometryBuffer,
                    cities: cityPayload,
                    scaleConfig: toRaw(mapScaleConfig.value),
                },
            },
            transferables,
        );

        isWorkerReady.value = true;

        // Baseline push so the worker starts with the session cache.
        accumulateTollPoints(true);
    }

    /**
     * Computes the "fewer tolls" / "fewer ferries" variants of the just
     * planned route in the background. Fire-and-forget: results land in
     * `routeAlternatives` when ready, or silently vanish if a newer route
     * (or a deviation reroute) invalidated them first.
     */
    function computeAlternativesInWorker(
        startId: number,
        waypointsNodeGroups: number[][],
        truckHeading: number,
        startType: string,
        ownedDlcs: number[],
        sdkScale: number,
        avgSpeed: number,
        baseFlags: RouteAlternativeFlags,
    ) {
        const token = ++alternativesToken;

        const variants: {
            kind: "tolls" | "ferries";
            avoidTolls: boolean;
            avoidFerries: boolean;
        }[] = [
            {
                kind: "tolls",
                avoidTolls: !baseFlags.avoidTolls,
                avoidFerries: baseFlags.avoidFerries,
            },
            {
                kind: "ferries",
                avoidTolls: baseFlags.avoidTolls,
                avoidFerries: !baseFlags.avoidFerries,
            },
        ];

        void (async () => {
            for (const variant of variants) {
                try {
                    const result = await calculateMultiRouteInWorker(
                        startId,
                        toRaw(waypointList.value),
                        waypointsNodeGroups,
                        truckHeading,
                        startType,
                        ownedDlcs,
                        sdkScale,
                        avgSpeed,
                        variant.avoidFerries,
                        variant.avoidTolls,
                    );

                    if (token !== alternativesToken || !result) continue;

                    const summary = summarizeRouteResult(
                        variant.kind,
                        {
                            avoidTolls: variant.avoidTolls,
                            avoidFerries: variant.avoidFerries,
                        },
                        result.stats,
                        result.displayPath?.length ?? 0,
                        result.tollCount ?? 0,
                        result.ferryCount ?? 0,
                    );
                    if (!summary) continue;

                    const primary = primaryRouteSummary.value;
                    if (!primary) continue;

                    const next = buildRouteAlternatives(
                        primary,
                        [
                            ...(routeAlternatives.value ?? []),
                            summary,
                        ],
                    );
                    routeAlternatives.value = next;
                } catch (e) {
                    console.error(
                        `Alternative route (${variant.kind}) failed: ${e}`,
                    );
                }
            }
        })();
    }

    async function handleMultiRouteCalculation(
        truckCoords: [number, number],
        truckHeading: number,
        sdkScale: number,
        avgSpeed: number,
        computeAlternatives = false,
    ) {
        if (
            waypointList.value.length === 0 ||
            adjacency.size === 0 ||
            isCalculating.value ||
            !isWorkerReady.value
        ) {
            return;
        }

        routeAlternatives.value = null;
        primaryRouteSummary.value = null;
        alternativesToken++;

        isCalculating.value = true;
        routeFound.value = null;
        nodeDisplayIndicesCache.value = null;

        try {
            const startConfig = findBestStartConfiguration(
                truckCoords,
                truckHeading,
                50,
            );
            if (!startConfig) {
                isCalculating.value = false;
                return;
            }

            isYardStart.value = startConfig.type === "yard";
            startNodeId.value = startConfig.toId;

            const waypointsNodeGroups: number[][] = [];
            for (const waypoint of waypointList.value) {
                let candidates = getClosestNodes(waypoint, 10, 0.1);

                if (candidates.length === 0) {
                    candidates = getClosestNodes(waypoint, 10, 0.4);
                }
                if (candidates.length === 0) {
                    candidates = getClosestNodes(waypoint, 10, 1.5);
                }

                waypointsNodeGroups.push(candidates);
            }

            const userDlcs = toRaw(activeSettings.value.ownedDlcs);

            const result = await calculateMultiRouteInWorker(
                startNodeId.value!,
                waypointList.value,
                waypointsNodeGroups,
                truckHeading,
                startConfig.type as "road" | "yard",
                userDlcs,
                sdkScale,
                avgSpeed,
                activeSettings.value.avoidFerries,
                activeSettings.value.avoidTolls,
            );

            if (result) {
                isRouteActive.value = true;
                endNodeId.value = result.endId;

                snappedWaypointNodeIds.value = result.snappedNodeIds || [];

                const frozenRawPath = Object.freeze(result.displayPath);
                currentRoutePath.value = frozenRawPath as any;
                routeStatsCache.value = result.stats;
                routeUrbanKmMarks.value = result.urbanKmMarks || null;
                nextUrbanMarkIdx = 0;
                nodeDisplayIndicesCache.value =
                    result.nodeDisplayIndices || null;

                const cache = result.stats;
                const lastIdx = (result.displayPath.length - 1) * 3;
                const totalKm = cache[lastIdx];
                const totalGameHours = cache[lastIdx + 1];
                const totalRealHours = cache[lastIdx + 2];

                drawRouteOnMap(result.displayPath);
                drawDestinationMarkers();

                routeDistance.value = Math.round(totalKm);
                updateRouteEta(totalGameHours, totalRealHours);

                const lastStop =
                    waypointList.value[waypointList.value.length - 1]!;
                destinationName.value = getGameLocationName(
                    lastStop[0],
                    lastStop[1],
                );

                fullRouteDirections.value = generateDirectionsList(
                    result.nodeSequence,
                    result.nodeKms,
                    result.sequenceManeuvers,
                    result.sequenceExits,
                    nodeCoords,
                );

                if (fullRouteDirections.value.length > 1) {
                    const upcomingTurn = fullRouteDirections.value[1];
                    if (
                        upcomingTurn &&
                        upcomingTurn.cumulativeKm !== undefined
                    ) {
                        nextTurnDistance.value = Math.max(
                            0,
                            +upcomingTurn.cumulativeKm.toFixed(1),
                        );
                    }
                } else {
                    nextTurnDistance.value = 0;
                }

                if (activeSettings.value.hasTurnNavigation) {
                    drawTurnArrows(
                        fullRouteDirections.value,
                        result.displayPath,
                    );
                }

                routeFound.value = true;
                currentRouteIndex.value = 0;
                updateProfile(
                    "lastDestination",
                    waypointList.value[waypointList.value.length - 1]!,
                );

                const primaryFlags: RouteAlternativeFlags = {
                    avoidTolls: activeSettings.value.avoidTolls,
                    avoidFerries: activeSettings.value.avoidFerries,
                };
                primaryRouteSummary.value = summarizeRouteResult(
                    "primary",
                    primaryFlags,
                    result.stats,
                    result.displayPath.length,
                    result.tollCount ?? 0,
                    result.ferryCount ?? 0,
                );

                if (computeAlternatives && startNodeId.value !== null) {
                    computeAlternativesInWorker(
                        startNodeId.value,
                        waypointsNodeGroups,
                        truckHeading,
                        startConfig.type as "road" | "yard",
                        userDlcs,
                        sdkScale,
                        avgSpeed,
                        primaryFlags,
                    );
                }
            } else {
                routeFound.value = false;
            }
        } catch (e) {
            console.error(`Route calculation failed: ${e}`);
            isRouteActive.value = false;
        } finally {
            isCalculating.value = false;
        }
    }

    function calculateMultiRouteInWorker(
        startId: number,
        waypointsCoords: [number, number][],
        waypointsNodeGroups: number[][],
        heading: number,
        startType: string,
        ownedDlcs: number[],
        sdkScale: number,
        avgSpeed: number,
        avoidFerries: boolean,
        avoidTolls: boolean,
    ): Promise<any> {
        return new Promise((resolve) => {
            if (!worker) {
                resolve(null);
                return;
            }

            // Tag each request so overlapping calculations cannot consume
            // each other's RESULT messages.
            const requestId = ++workerRequestId;

            const handler = (e: MessageEvent) => {
                if (
                    e.data.type === "RESULT" &&
                    e.data.requestId === requestId
                ) {
                    worker!.removeEventListener("message", handler);
                    resolve(e.data.payload);
                }
            };

            worker.addEventListener("message", handler);

            const cleanCoords = waypointsCoords.map((coord) => [
                Number(coord[0]),
                Number(coord[1]),
            ]);
            const cleanNodeGroups = waypointsNodeGroups.map((group) =>
                group.map((node) => Number(node)),
            );
            const cleanDlcs = ownedDlcs.map((dlc) => Number(dlc));

            worker.postMessage({
                type: "CALC_MULTI_ROUTE",
                requestId,
                payload: {
                    startId: Number(startId),
                    waypointsCoords: cleanCoords,
                    waypointsNodeGroups: cleanNodeGroups,
                    heading: heading !== null ? Number(heading) : null,
                    startType,
                    ownedDlcs: cleanDlcs,
                    selectedGame: settings.value.selectedGame,
                    sdkScale: Number(sdkScale),
                    avgSpeed: Number(avgSpeed),
                    avoidFerries: avoidFerries === true,
                    avoidTolls: avoidTolls === true,
                },
            });
        });
    }

    function findBestWaypointInsertionIndex(
        clickCoords: [number, number],
    ): number {
        if (
            !isRouteActive.value ||
            !currentRoutePath.value ||
            currentRoutePath.value.length < 2 ||
            waypointList.value.length == 0
        ) {
            return waypointList.value.length;
        }

        const routePoints = currentRoutePath.value;

        const markedPositionsOnRoute: number[] = [];
        let searchStart = 0;

        for (const markedCoords of waypointList.value) {
            let closestPointIndex = searchStart;
            let shortestDistSq = Infinity;

            for (let i = searchStart; i < routePoints.length; i++) {
                const distSq = getSquaredDist(markedCoords, routePoints[i]!);
                if (distSq < shortestDistSq) {
                    shortestDistSq = distSq;
                    closestPointIndex = i;
                }
            }

            markedPositionsOnRoute.push(closestPointIndex);
            searchStart = closestPointIndex;
        }

        let clickedRoadPieceIndex = 0;
        let shortestClickDistSq = Infinity;

        for (let i = 0; i < routePoints.length - 1; i++) {
            const distSq = getSqDistToSegment(
                clickCoords,
                routePoints[i]!,
                routePoints[i + 1]!,
            );

            if (distSq < shortestClickDistSq) {
                shortestClickDistSq = distSq;
                clickedRoadPieceIndex = i;
            }
        }

        for (
            let markedIdx = 0;
            markedIdx < markedPositionsOnRoute.length;
            markedIdx++
        ) {
            const markedPosition = markedPositionsOnRoute[markedIdx]!;
            if (clickedRoadPieceIndex < markedPosition) {
                return markedIdx;
            }
        }

        return waypointList.value.length;
    }

    async function handleRouteClick(
        clickCoords: [number, number],
        truckCoords: [number, number],
        truckHeading: number,
        sdkScale: number,
        createEndMarker: boolean,
        avgSpeed: number,
    ) {
        waypointList.value = [clickCoords];
        await handleMultiRouteCalculation(
            truckCoords,
            truckHeading,
            sdkScale,
            avgSpeed,
            true,
        );
    }

    async function removeWaypointAtIndex(
        index: number,
        truckCoords: [number, number],
        truckHeading: number,
        sdkScale: number,
        avgSpeed: number,
    ) {
        waypointList.value.splice(index, 1);

        if (waypointList.value.length === 0) {
            clearRouteState();
        } else {
            drawDestinationMarkers();

            await handleMultiRouteCalculation(
                truckCoords,
                truckHeading,
                sdkScale,
                avgSpeed,
                true,
            );
        }
    }

    function drawDestinationMarkers() {
        if (!map.value) return;

        const source = map.value.getSource(
            "destination-source",
        ) as maplibregl.GeoJSONSource;
        if (!source) return;

        const features = waypointList.value.map((coords, idx) => {
            let markerCoords = coords;

            const targetNodeId = snappedWaypointNodeIds.value[idx];
            if (targetNodeId !== undefined) {
                const snappedCoords = nodeCoords.get(targetNodeId);
                if (snappedCoords) {
                    markerCoords = snappedCoords;
                }
            }

            return {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: markerCoords,
                },
                properties: {
                    index: idx,
                },
            };
        });

        source.setData({
            type: "FeatureCollection",
            features: features as any,
        });
    }

    function projectPointToSegment(
        p: [number, number],
        v: [number, number],
        w: [number, number],
    ): [number, number] {
        const l2 = getSquaredDist(v, w);
        if (l2 === 0) return [v[0], v[1]];
        let t =
            ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) /
            l2;
        t = Math.max(0, Math.min(1, t));
        return [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
    }

    function drawTurnArrows(
        steps: DirectionStep[],
        displayPath: [number, number][],
    ) {
        if (!map.value) return;

        const linesFeatures = [];
        const headsFeatures = [];

        const ARROW_HEAD_OFFSET_M = 30;

        const MAX_ARROWS_TO_SHOW = 2;
        let arrowsDrawn = 0;

        const displayIndices = nodeDisplayIndicesCache.value;

        for (const step of steps) {
            if (
                ["depart", "destination", "straight", "ferry"].includes(
                    step.type,
                )
            )
                continue;

            if (arrowsDrawn >= MAX_ARROWS_TO_SHOW) break;

            let startIdx = -1;
            let endIdx = -1;

            const nodeIdx = step.nodeIndex;
            const directStart =
                displayIndices && nodeIdx !== undefined
                    ? displayIndices[nodeIdx]
                    : undefined;
            const directEnd =
                displayIndices && nodeIdx !== undefined
                    ? displayIndices[nodeIdx + 1]
                    : undefined;

            if (
                directStart !== undefined &&
                directEnd !== undefined &&
                directEnd >= directStart
            ) {
                // Exact indices from the worker: node -> display path.
                startIdx = directStart;
                endIdx = directEnd;
                if (endIdx === startIdx && endIdx < displayPath.length - 1) {
                    endIdx = startIdx + 1;
                }
            } else {
                // Fallback: locate the maneuver by nearest coordinates.
                let minStartDist = Infinity;
                for (let i = 0; i < displayPath.length; i++) {
                    const distSq = getSquaredDist(displayPath[i]!, step.coords);
                    if (distSq < minStartDist) {
                        minStartDist = distSq;
                        startIdx = i;
                    }
                }

                endIdx = startIdx;
                if (step.exitCoords && startIdx !== -1) {
                    let minEndDist = Infinity;
                    const searchLimit = Math.min(
                        displayPath.length,
                        startIdx + 1000,
                    );
                    for (let i = startIdx; i < searchLimit; i++) {
                        const distSq = getSquaredDist(
                            displayPath[i]!,
                            step.exitCoords,
                        );
                        if (distSq < minEndDist) {
                            minEndDist = distSq;
                            endIdx = i;
                        }
                    }
                }
            }

            if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
                const arrowCoords: [number, number][] = [];

                for (let i = startIdx; i <= endIdx; i++) {
                    arrowCoords.push(displayPath[i]!);
                }

                let hIdx = endIdx;
                let dFwd = 0;
                let finalHeadPoint: [number, number] = displayPath[hIdx]!;

                while (
                    hIdx < displayPath.length - 1 &&
                    dFwd < ARROW_HEAD_OFFSET_M
                ) {
                    const segDist =
                        Math.sqrt(
                            getSquaredDist(
                                displayPath[hIdx]!,
                                displayPath[hIdx + 1]!,
                            ),
                        ) * 111000;
                    if (dFwd + segDist > ARROW_HEAD_OFFSET_M) {
                        const ratio = (ARROW_HEAD_OFFSET_M - dFwd) / segDist;
                        const p1 = displayPath[hIdx]!;
                        const p2 = displayPath[hIdx + 1]!;
                        finalHeadPoint = [
                            p1[0] + (p2[0] - p1[0]) * ratio,
                            p1[1] + (p2[1] - p1[1]) * ratio,
                        ];
                        dFwd = ARROW_HEAD_OFFSET_M;
                    } else {
                        dFwd += segDist;
                        hIdx++;
                        finalHeadPoint = displayPath[hIdx]!;
                    }
                }

                if (dFwd > 0) {
                    arrowCoords.push(finalHeadPoint);
                }

                if (arrowCoords.length >= 2) {
                    linesFeatures.push({
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: arrowCoords,
                        },
                        properties: {},
                    });

                    const pLast = arrowCoords[arrowCoords.length - 1]!;
                    const pPrev = arrowCoords[arrowCoords.length - 2]!;
                    const bearing = getBearing(pPrev, pLast);

                    headsFeatures.push({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: pLast },
                        properties: { bearing },
                    });

                    arrowsDrawn++;
                }
            }
        }

        const lineSource = map.value.getSource(
            "turn-arrows-line-source",
        ) as maplibregl.GeoJSONSource;
        const headSource = map.value.getSource(
            "turn-arrows-head-source",
        ) as maplibregl.GeoJSONSource;

        if (lineSource)
            lineSource.setData({
                type: "FeatureCollection",
                features: linesFeatures as any,
            });
        if (headSource)
            headSource.setData({
                type: "FeatureCollection",
                features: headsFeatures as any,
            });
    }

    function findBestStartConfiguration(
        truckCoords: [number, number],
        truckHeading: number,
        searchLimit: number = 50,
    ) {
        if (adjacency.size === 0 || nodeCoords.size === 0) {
            console.error("CRITICAL: Graph data is empty!");
            return null;
        }

        const nearbyNodes = getClosestNodes(truckCoords, searchLimit, 0.1);

        if (nearbyNodes.length === 0) {
            return null;
        }

        let bestEdge = null;
        let minScore = Infinity;

        for (const fromNodeId of nearbyNodes) {
            const neighbors = adjacency.get(fromNodeId);
            const fromPos = nodeCoords.get(fromNodeId);
            if (!neighbors || !fromPos) continue;

            for (const edge of neighbors) {
                const toPos = nodeCoords.get(edge.to);
                if (!toPos) continue;

                let roadBearing = getBearing(fromPos, toPos);

                let diff = Math.abs(truckHeading - roadBearing);
                if (diff > 180) diff = 360 - diff;

                const isOpposite = diff > 90;
                const trueDiff = isOpposite ? 180 - diff : diff;
                if (trueDiff > 45) continue;

                const visualRoadBearing = isOpposite
                    ? (roadBearing + 180) % 360
                    : roadBearing;

                const projected = projectPointToSegment(
                    truckCoords,
                    fromPos,
                    toPos,
                );
                const distSq = getSquaredDist(truckCoords, projected);
                const distKm = Math.sqrt(distSq) * 111;

                const headingPenalty = Math.pow(trueDiff / 90, 2) * 0.1;
                const directionPenalty = isOpposite ? 0.5 : 0;

                const score = distKm + headingPenalty + directionPenalty;

                if (score < minScore) {
                    minScore = score;
                    bestEdge = {
                        type: "road",
                        fromId: fromNodeId,
                        toId: edge.to,
                        projectedCoords: projected,
                        bearing: visualRoadBearing,
                    };
                }
            }
        }

        if (bestEdge) return bestEdge;

        const yardCandidates = getClosestNodes(truckCoords, 10, 0.3);
        let closestNodeId: number | null = null;
        let minNodeDist = Infinity;

        for (const nodeId of yardCandidates) {
            const nodePos = nodeCoords.get(nodeId);
            if (!nodePos) continue;

            const distSq = getSquaredDist(truckCoords, nodePos);
            if (distSq < minNodeDist) {
                minNodeDist = distSq;
                closestNodeId = nodeId;
            }
        }

        if (closestNodeId !== null) {
            const nodePos = nodeCoords.get(closestNodeId);
            if (!nodePos) return;

            return {
                type: "yard",
                fromId: closestNodeId,
                toId: closestNodeId,
                projectedCoords: nodePos,
            };
        }

        return null;
    }

    function drawRouteOnMap(coords: [number, number][]) {
        if (!map.value) return;

        const rawMap = toRaw(map.value);
        setMapLibreData(rawMap, "route-line", "LineString", toRaw(coords));
    }

    async function setupRouteLayer() {
        if (!map.value) return;
        if (map.value.getSource("route-line")) return;

        if (!map.value.hasImage("destination-icon")) {
            const pinImg = await generateDestinationIcon(
                activeSettings.value.themeColor,
            );
            map.value.addImage("destination-icon", pinImg, { pixelRatio: 2.5 });
        }

        map.value.addSource("route-line", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });

        map.value.addLayer(
            {
                id: "route-line",
                type: "line",
                source: "route-line",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": activeSettings.value.routeColor,
                    "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10,
                        8,
                        10.2,
                        9,
                        10.5,
                        6,
                        11.5,
                        11,
                    ],
                },
            },
            "all-sprites",
        );

        if (!map.value.getSource("service-suggestion")) {
            map.value.addSource("service-suggestion", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
            });

            map.value.addLayer(
                {
                    id: "service-suggestion-layer",
                    type: "circle",
                    source: "service-suggestion",
                    paint: {
                        "circle-radius": 9,
                        "circle-color": [
                            "match",
                            ["get", "kind"],
                            "rest",
                            "#7dd3fc",
                            "#f59e0b",
                        ],
                        "circle-stroke-color": "#ffffff",
                        "circle-stroke-width": 2,
                    },
                },
                "all-sprites",
            );
        }

        if (!map.value.getSource("destination-source")) {
            map.value.addSource("destination-source", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
            });

            map.value.addLayer({
                id: "destination-layer",
                type: "symbol",
                source: "destination-source",
                layout: {
                    "icon-image": "destination-icon",
                    "icon-anchor": "bottom",
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                },
            });

            map.value.on("click", "destination-layer", async (e) => {
                const { truckCoords, truckHeading, averageSpeed, scale } =
                    useEtsTelemetry();
                if (!truckCoords.value) return;

                const features = map.value!.queryRenderedFeatures(e.point, {
                    layers: ["destination-layer"],
                });

                if (features.length > 0) {
                    const index = features[0]!.properties?.index;

                    if (index !== undefined) {
                        const targetIdx = parseInt(index, 10);

                        const currentScale =
                            scale.value > 0
                                ? scale.value
                                : mapScaleConfig.value.ruralScale;

                        await removeWaypointAtIndex(
                            targetIdx,
                            truckCoords.value,
                            truckHeading.value,
                            currentScale,
                            averageSpeed.value,
                        );
                    }
                }
            });
            map.value.on("mouseenter", "destination-layer", () => {
                map.value!.getCanvas().style.cursor = "pointer";
            });
            map.value.on("mouseleave", "destination-layer", () => {
                map.value!.getCanvas().style.cursor = "";
            });
        }

        if (!map.value.hasImage("turn-arrow-icon")) {
            const arrowImg = new Image();
            arrowImg.onload = () =>
                map.value!.addImage("turn-arrow-icon", arrowImg);

            arrowImg.src =
                "data:image/svg+xml;charset=utf-8," +
                encodeURIComponent(
                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 20L12 16L22 20L12 2Z" fill="white" stroke="#1c1c1c" stroke-width="2" stroke-linejoin="round"/></svg>',
                );
        }

        if (!map.value.getSource("turn-arrows-line-source")) {
            map.value.addSource("turn-arrows-line-source", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
            });

            map.value.addLayer({
                id: "turn-arrows-line-border",
                type: "line",
                source: "turn-arrows-line-source",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": "#1c1c1c",
                    "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10,
                        9,
                        15,
                        15,
                    ],
                },
            });

            map.value.addLayer({
                id: "turn-arrows-line-inner",
                type: "line",
                source: "turn-arrows-line-source",
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": "#ffffff",
                    "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10,
                        5.5,
                        15,
                        9.5,
                    ],
                },
            });
        }

        if (!map.value.getSource("turn-arrows-head-source")) {
            map.value.addSource("turn-arrows-head-source", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
            });

            map.value.addLayer({
                id: "turn-arrows-head-layer",
                type: "symbol",
                source: "turn-arrows-head-source",
                layout: {
                    "icon-image": "turn-arrow-icon",
                    "icon-size": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10,
                        0.83,
                        15,
                        1.33,
                    ],
                    "icon-rotation-alignment": "map",
                    "icon-rotate": ["get", "bearing"],
                    "icon-anchor": "center",
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                },
            });
        }
    }

    const lastRecalcTime = ref(0);
    const updateRouteProgress = (
        truckCoords: [number, number],
        truckHeading: number,
        sdkScale: number,
        avgSpeed: number,
        context?: { fuelRangeKm?: number; restStopMinutes?: number },
    ) => {
        if (!currentRoutePath.value || currentRoutePath.value.length < 2)
            return;
        const cache = routeStatsCache.value;
        if (!cache) return;

        if (lastMathPos.value) {
            const sqDist = getSquaredDist(lastMathPos.value, truckCoords);
            if (sqDist < 0.000000001) return;
        }
        lastMathPos.value = truckCoords;

        const path = currentRoutePath.value;
        let bestIndex = currentRouteIndex.value;
        let minSqDist = Infinity;

        const searchLimit = Math.min(path.length - 1, bestIndex + 500);
        const startSearch = Math.max(0, bestIndex - 5);

        for (let i = startSearch; i < searchLimit; i++) {
            const distSq = getSqDistToSegment(
                truckCoords,
                path[i]!,
                path[i + 1]!,
            );

            if (distSq < minSqDist) {
                minSqDist = distSq;
                bestIndex = i;
            }
        }

        currentRouteIndex.value = bestIndex;

        let activeThreshold = DEVIATION_THRESHOLD_SQ;

        const distToEndSq = getSquaredDist(truckCoords, path[path.length - 1]!);
        if (distToEndSq < 0.00005) {
            clearRouteState();
            return;
        }

        const lastIdx = (path.length - 1) * 3;
        const currentIdx = bestIndex * 3;

        const totalKm = cache[lastIdx]!;
        const totalGameHours = cache[lastIdx + 1]!;
        const totalRealHours = cache[lastIdx + 2]!;

        const currentKm = cache[currentIdx]!;
        const currentGameHours = cache[currentIdx + 1]!;
        const currentRealHours = cache[currentIdx + 2]!;

        const remKm = totalKm - currentKm;
        const remGameHours = totalGameHours - currentGameHours;
        const remRealHours = totalRealHours - currentRealHours;
        routeDistance.value = Math.round(remKm);

        updateRouteEta(remGameHours, remRealHours);

        // Urban-entry warning: fire once when the next city area is close.
        const urbanMarks = routeUrbanKmMarks.value;
        if (urbanMarks && urbanMarks.length > 0) {
            while (
                nextUrbanMarkIdx < urbanMarks.length &&
                urbanMarks[nextUrbanMarkIdx]! <= currentKm + 0.05
            ) {
                nextUrbanMarkIdx++;
            }

            if (nextUrbanMarkIdx < urbanMarks.length) {
                const distToUrban = urbanMarks[nextUrbanMarkIdx]! - currentKm;
                if (distToUrban <= 1.5) {
                    urbanAheadTrigger.value++;
                    nextUrbanMarkIdx++;
                }
            }
        }

        // Rest / fuel planning against the remaining route.
        updateServicePlanning(
            context?.fuelRangeKm ?? 0,
            context?.restStopMinutes ?? 0,
            avgSpeed,
        );

        // Keep the session toll-gate cache growing while the map moves.
        accumulateTollPoints();

        if (fullRouteDirections.value.length > 1) {
            const upcomingTurn = fullRouteDirections.value[1];

            if (upcomingTurn && upcomingTurn.cumulativeKm !== undefined) {
                const distKm = upcomingTurn.cumulativeKm - currentKm;
                const distRounded = +distKm.toFixed(1);

                nextTurnDistance.value = Math.max(0, distRounded);

                const targetExitKm =
                    upcomingTurn.exitCumulativeKm !== undefined
                        ? upcomingTurn.exitCumulativeKm
                        : upcomingTurn.cumulativeKm;

                const distToExit = targetExitKm - currentKm;
                const threshold =
                    upcomingTurn.type === "destination" ? 0.02 : 0.05;

                if (distToExit < threshold) {
                    fullRouteDirections.value.shift();

                    if (
                        currentRoutePath.value &&
                        activeSettings.value.hasTurnNavigation
                    ) {
                        drawTurnArrows(
                            fullRouteDirections.value,
                            currentRoutePath.value,
                        );
                    }
                }
            }
        } else {
            nextTurnDistance.value = 0;
        }

        const now = Date.now();
        if (now - lastRecalcTime.value < 5000) return;

        if (isTruckInYard.value) {
            activeThreshold = 0.05;
        } else if (isYardStart.value) {
            if (bestIndex > 0) {
                isYardStart.value = false;
            } else {
                activeThreshold = 0.005;
            }
        }

        if (minSqDist > activeThreshold) {
            if (!isCalculating.value && waypointList.value.length > 0) {
                lastRecalcTime.value = now;
                console.log("Deviation detected! Recalculating...");
                handleMultiRouteCalculation(
                    truckCoords,
                    truckHeading,
                    sdkScale,
                    avgSpeed,
                );
                return;
            }
        }
    };

    function clearRouteState() {
        if (!map.value) return;

        deleteMapLibreData(map.value, "route-line");
        deleteMapLibreData(map.value, "destination-source");
        deleteMapLibreData(map.value, "turn-arrows-line-source");
        deleteMapLibreData(map.value, "turn-arrows-head-source");

        isRouteActive.value = false;
        endNodeId.value = null;
        currentRoutePath.value = null;
        routeUrbanKmMarks.value = null;
        nextUrbanMarkIdx = 0;

        serviceSuggestion.value = null;
        lastPlanningCheck = 0;
        updateSuggestionMarker();

        routeAlternatives.value = null;
        primaryRouteSummary.value = null;
        alternativesToken++;

        waypointList.value = [];
        snappedWaypointNodeIds.value = [];
        isYardStart.value = false;
        fullRouteDirections.value = [];
        updateProfile("lastDestination", null);
        stopNavigationMode();

        nextTurnDistance.value = 0;
        lastMathPos.value = null;
    }

    return {
        worker,
        destinationName,
        routeDistance,
        routeEta,
        isCalculating,
        routeFound,
        currentRoutePath,
        isWorkerReady,
        isRouteActive,
        urbanAheadTrigger,
        serviceSuggestion,
        routeAlternatives,
        primaryRouteSummary,
        fullRouteDirections,
        nextTurnDistance,
        initWorkerData,
        destroyWorker,
        waypointList,
        removeWaypointAtIndex,
        setupRouteLayer,
        handleMultiRouteCalculation,
        findBestWaypointInsertionIndex,
        handleRouteClick,
        findBestStartConfiguration,
        updateRouteProgress,
        clearRouteState,
    };
};
