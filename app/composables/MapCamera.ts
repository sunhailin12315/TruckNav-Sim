import { ref, onUnmounted } from "vue";
import type { Ref } from "vue";
import type { Map } from "maplibre-gl";
import {
    AUTO_RECENTRE_MS,
    DAMP_TAU,
    damp,
    dampBearing,
    bearingDelta,
    FOLLOW_DELAY_MS,
    samePose,
    truckAt,
    zoomForSpeed,
    zoomOffsetFor,
    type TruckSample,
} from "~/assets/utils/map/cameraMath";

const PADDING_NAV = { top: 180, bottom: 0, left: 0, right: 0 };
const PADDING_FREE = { top: 0, bottom: 0, left: 0, right: 0 };

/** How long an easeTo runs before the damped loop takes the pose back over. */
const RESUME_EASE_MS = 500;
/** How long the sample buffer keeps history: the render delay only ever
 * looks ~FOLLOW_DELAY_MS back, ~2 s is plenty even at low telemetry rates. */
const SAMPLE_KEEP_MS = 2000;

export const useMapCamera = (map: Ref<Map | null>) => {
    const isCameraLocked = ref(false);
    const isAutoFollowEnabled = ref(false);
    const isNavigating = ref(false);
    // Route overview (preview) mode: the camera is handed to the route
    // bounding box for a few seconds, then returns to the truck.
    const isRoutePreview = ref(false);

    // Telemetry poses, newest last; the camera renders FOLLOW_DELAY_MS behind
    // the newest one so interpolation always has two samples and never
    // extrapolates (WestPlay camera.ts, docs/westplay-reference-study.md).
    let samples: TruckSample[] = [];

    // The damped pose the camera is actually drawn at.
    let damped: {
        center: [number, number];
        zoom: number;
        bearing: number;
    } | null = null;

    // The player's zoom bias against the speed-based zoom: any zoom they
    // choose while browsing is kept when following resumes (WestPlay's
    // zoomOffsetFor), and speed zoom continues varying from there.
    let zoomOffset = 0;
    let lastSpeedKph = 0;
    let lastFrameTime = 0;

    let currentTruckCoords: [number, number] | null = null;
    let currentTruckHeading = 0;

    let animationFrameId: number | null = null;
    let isEasing = false;
    let easeTimeout: ReturnType<typeof setTimeout> | null = null;

    let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
    let previewAutoExitTimer: ReturnType<typeof setTimeout> | null = null;
    // Auto-follow preference to restore when the route overview ends.
    let previewRestoreAutoFollow = false;

    let markerEl: HTMLDivElement | null = null;

    const initMarker = (imgSrc: string, size: number) => {
        if (!map.value) return;
        if (!markerEl) {
            markerEl = document.createElement("div");
            markerEl.style.position = "absolute";
            markerEl.style.top = "0";
            markerEl.style.left = "0";

            markerEl.style.width = `${size}px`;
            markerEl.style.height = `${size}px`;

            markerEl.style.backgroundImage = `url("${imgSrc}")`;
            markerEl.style.backgroundSize = "contain";
            markerEl.style.backgroundRepeat = "no-repeat";
            markerEl.style.backgroundPosition = "center";
            markerEl.style.pointerEvents = "none";
            markerEl.style.zIndex = "10";
            markerEl.style.willChange = "transform";

            map.value.getContainer().appendChild(markerEl);
        }
    };

    const updateMarkerSize = (size: number) => {
        if (markerEl) {
            markerEl.style.width = `${size}px`;
            markerEl.style.height = `${size}px`;
        }
    };

    const updateMarkerImage = (imgSrc: string) => {
        if (markerEl) {
            markerEl.style.backgroundImage = `url("${imgSrc}")`;
        }
    };

    const syncDampedFromMap = () => {
        const m = map.value;
        if (!m) return;
        damped = {
            center: [m.getCenter().lng, m.getCenter().lat],
            zoom: m.getZoom(),
            bearing: m.getBearing(),
        };
    };

    const renderLoop = () => {
        const now = performance.now();
        const dt = lastFrameTime > 0 ? Math.min(now - lastFrameTime, 250) : 16;
        lastFrameTime = now;

        // Keep only the history the render delay can reach.
        while (
            samples.length > 2 &&
            samples[1]!.time <= now - SAMPLE_KEEP_MS
        ) {
            samples.shift();
        }

        const pose = truckAt(samples, now - FOLLOW_DELAY_MS);
        const isTargetAtOrigin =
            !!pose && pose.coords[0] === 0 && pose.coords[1] === 0;

        if (map.value && pose && !isTargetAtOrigin) {
            if (isCameraLocked.value && !isEasing) {
                if (!damped) syncDampedFromMap();

                const d = damped!;
                const targetZoom = zoomForSpeed(pose.speedKph) + zoomOffset;
                const next = {
                    center: [
                        damp(
                            d.center[0],
                            pose.coords[0],
                            dt,
                            DAMP_TAU.center,
                        ),
                        damp(
                            d.center[1],
                            pose.coords[1],
                            dt,
                            DAMP_TAU.center,
                        ),
                    ] as [number, number],
                    zoom: damp(d.zoom, targetZoom, dt, DAMP_TAU.zoom),
                    bearing: dampBearing(
                        d.bearing,
                        isAutoFollowEnabled.value ? pose.heading : 0,
                        dt,
                        DAMP_TAU.bearing,
                    ),
                };
                // Moving the map to the same pose still makes it draw a
                // whole frame; skip once the damping has settled.
                if (!samePose(d, next)) {
                    map.value.jumpTo({
                        center: next.center,
                        zoom: next.zoom,
                        bearing: next.bearing,
                        padding: isNavigating.value
                            ? PADDING_NAV
                            : PADDING_FREE,
                    });
                }
                damped = next;
            }

            if (markerEl) {
                const pos = map.value.project(pose.coords);
                const pitch = map.value.getPitch();
                const bearing = map.value.getBearing();

                const screenRot = pose.heading - bearing;

                markerEl.style.transform = `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotateX(${pitch}deg) rotateZ(${screenRot}deg)`;
            }
        }

        animationFrameId = requestAnimationFrame(renderLoop);
    };

    const startRenderLoop = () => {
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(renderLoop);
        }
    };

    const stopRenderLoop = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };

    const initCameraListeners = () => {
        if (!map.value) return;
        startRenderLoop();

        const breakLockEvents = ["mousedown", "touchstart", "wheel"];

        breakLockEvents.forEach((event) => {
            map.value!.on(event, (e) => {
                if (e.originalEvent && !isEasing) {
                    // Interacting during a route overview ends it; the
                    // standard unlock / re-lock handling takes over from
                    // here with the user's original follow preference.
                    if (isRoutePreview.value) {
                        exitRoutePreview(false);
                    }

                    isCameraLocked.value = false;
                    if (autoLockTimer) clearTimeout(autoLockTimer);

                    if (isAutoFollowEnabled.value) {
                        autoLockTimer = setTimeout(() => {
                            resumeCameraLock();
                        }, AUTO_RECENTRE_MS);
                    }
                }
            });
        });

        // A zoom the player chose themselves (drag pinch or wheel) becomes
        // the bias the speed-based zoom varies around when following
        // resumes. Programmatic jumpTo carries no originalEvent, so the
        // camera's own zooming never overwrites it.
        map.value.on("zoom", (e) => {
            if (
                e.originalEvent &&
                !isEasing &&
                !isRoutePreview.value &&
                currentTruckCoords
            ) {
                zoomOffset = zoomOffsetFor(
                    map.value!.getZoom(),
                    lastSpeedKph,
                );
            }
        });

        map.value.on("move", (e) => {
            if (e.originalEvent && !isCameraLocked.value && !isEasing) {
                if (autoLockTimer) clearTimeout(autoLockTimer);

                if (isAutoFollowEnabled.value && !isRoutePreview.value) {
                    autoLockTimer = setTimeout(() => {
                        resumeCameraLock();
                    }, AUTO_RECENTRE_MS);
                }
            }
        });
    };

    const resumeCameraLock = (isFollowButtonEnabled?: boolean) => {
        if (!map.value || !currentTruckCoords) return;
        isAutoFollowEnabled.value = isFollowButtonEnabled ?? true;
        isCameraLocked.value = true;
        isEasing = true;

        if (easeTimeout) clearTimeout(easeTimeout);
        easeTimeout = setTimeout(() => {
            isEasing = false;
            // The ease landed wherever the player had left the map: take
            // that pose as the damping's start, and keep their zoom as the
            // bias the speed-based zoom varies around.
            syncDampedFromMap();
            zoomOffset = zoomOffsetFor(map.value!.getZoom(), lastSpeedKph);
        }, RESUME_EASE_MS);

        map.value.easeTo({
            center: currentTruckCoords,
            bearing: currentTruckHeading,
            pitch: map.value.getPitch(),
            duration: 350,
            padding: isNavigating.value ? PADDING_NAV : PADDING_FREE,
        });
    };

    const toggleAutoFollow = () => {
        isAutoFollowEnabled.value = !isAutoFollowEnabled.value;

        if (isAutoFollowEnabled.value) {
            resumeCameraLock();
        } else {
            isCameraLocked.value = false;
            if (autoLockTimer) clearTimeout(autoLockTimer);
        }
    };

    const followTruck = (
        coords: [number, number],
        heading: number,
        speedKph = lastSpeedKph,
    ) => {
        lastSpeedKph = speedKph;
        samples.push({ time: performance.now(), coords, heading, speedKph });

        if (currentTruckCoords) {
            // Keep the ease target unwrapped, so resumeCameraLock's easeTo
            // always turns the short way round (350° -> 10° goes +20°).
            currentTruckHeading += bearingDelta(currentTruckHeading, heading);
        } else {
            currentTruckHeading = heading;
        }
        currentTruckCoords = [...coords] as [number, number];
    };

    const lockCamera = () => {
        if (!map.value) return;
        isCameraLocked.value = true;
    };

    const startNavigationMode = (
        coords: [number, number],
        heading: number,
        speedKph = 0,
    ) => {
        if (!map.value) return;
        isNavigating.value = true;
        isCameraLocked.value = true;
        isAutoFollowEnabled.value = true;
        currentTruckCoords = coords;
        currentTruckHeading = heading;
        // A fresh guide starts at the speed's own zoom, no inherited bias.
        zoomOffset = 0;
        lastSpeedKph = speedKph;

        isEasing = true;
        if (easeTimeout) clearTimeout(easeTimeout);

        easeTimeout = setTimeout(() => {
            isEasing = false;
            syncDampedFromMap();
        }, RESUME_EASE_MS);

        map.value.easeTo({
            center: coords,
            bearing: heading,
            zoom: zoomForSpeed(speedKph),
            pitch: map.value.getPitch(),
            duration: 350,
            padding: PADDING_NAV,
        });
    };

    const stopNavigationMode = () => {
        if (!map.value || !currentTruckCoords) return;
        isNavigating.value = false;

        exitRoutePreview(false);
        resumeCameraLock(false);
    };

    /**
     * Overview mode: ease to the route bounding box, hold for a few seconds,
     * then ease back to the truck. User interaction cancels the preview.
     * The user's original auto-follow preference is restored on exit.
     */
    const enterRoutePreview = (
        bounds: [[number, number], [number, number]],
    ) => {
        if (!map.value) return;

        if (previewAutoExitTimer) clearTimeout(previewAutoExitTimer);
        if (autoLockTimer) clearTimeout(autoLockTimer);

        previewRestoreAutoFollow = isAutoFollowEnabled.value;
        isRoutePreview.value = true;
        isCameraLocked.value = false;
        isAutoFollowEnabled.value = true;

        map.value.fitBounds(bounds, {
            padding: { top: 220, bottom: 320, left: 100, right: 100 },
            pitch: 0,
            duration: 700,
        });

        previewAutoExitTimer = setTimeout(() => {
            exitRoutePreview();
        }, 8000);
    };

    const exitRoutePreview = (resumeFollow = true) => {
        if (!isRoutePreview.value) return;

        isRoutePreview.value = false;
        isAutoFollowEnabled.value = previewRestoreAutoFollow;
        if (previewAutoExitTimer) {
            clearTimeout(previewAutoExitTimer);
            previewAutoExitTimer = null;
        }

        if (resumeFollow) resumeCameraLock(previewRestoreAutoFollow);
    };

    onUnmounted(() => {
        stopRenderLoop();
        if (easeTimeout) clearTimeout(easeTimeout);
        if (previewAutoExitTimer) clearTimeout(previewAutoExitTimer);
        if (markerEl) markerEl.remove();
    });

    return {
        isCameraLocked,
        isNavigating,
        isAutoFollowEnabled,
        isRoutePreview,
        initMarker,
        updateMarkerSize,
        updateMarkerImage,
        initCameraListeners,
        followTruck,
        stopNavigationMode,
        resumeCameraLock,
        toggleAutoFollow,
        lockCamera,
        startNavigationMode,
        enterRoutePreview,
        exitRoutePreview,
    };
};
