<script lang="ts" setup>
import { ref, onMounted, shallowRef, Transition } from "vue";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { usePlatform } from "~/composables/Platform";
import type { DirectionStep } from "~/assets/utils/routing/directions";
import {
    blendWithBg,
    darkenColor,
    lightenColor,
} from "~/assets/utils/shared/colors";
import { generateTruckIcon } from "~/assets/utils/map/markers";
import { pickTurnAnnouncement } from "~/assets/utils/guidance/voiceAnnouncements";

defineProps<{ goHome: () => void }>();

// MAP STATE
const mapEl = shallowRef<HTMLElement | null>(null);
const map = shallowRef<maplibregl.Map | null>(null);
const isSettingsPanelOpened = ref(false);
const isClickingEnabled = ref(true);
const isAddingStopMode = ref(false);

// UI STATE
const isSheetHidden = ref(false);

// JOB STATE
const currentJobKey = ref<string>("");

// Job card identity: re-expanded and re-keyed whenever a new job appears.
const activeJobKey = computed(
    () =>
        `${sourceCityName.value}|${cargoName.value}|${income.value}`,
);

// NOTIFICATION TRIGGERS
const clickingNotificationTrigger = ref(0);

// Telemetry Data
const {
    startTelemetry,
    stopTelemetry,
    gameTime,
    gameConnected,
    truckCoords,
    truckSpeed,
    speedLimit,
    truckHeading,
    fuel,
    fuelRange,
    restStoptime,
    restStopMinutes,
    hasInGameMarker,
    hasActiveJob,
    destinationCity,
    scale,
    averageSpeed,
    destinationCompany,
    cargoName,
    cargoMassKg,
    cargoDamage,
    income,
    remainingMinutes,
    sourceCityName,
    sourceCompanyName,
    destinationCityName,
    destinationCompanyName,
    isVisible: isDeliveryVisible,
    info: deliveryInfo,
    dismissDelivery,
} = useEtsTelemetry();

// Map Areas Data
const { loadLocationData, findDestinationCoords, mapScaleConfig } =
    useCityData();

// Check Platform
const { isElectron, isMobile, isWeb } = usePlatform();

// Graph manipulation
const { loading, progress, adjacency, nodeCoords, initializeGraphData } =
    useGraphSystem();

// Maplibre Camera
const {
    isCameraLocked,
    isAutoFollowEnabled,
    isNavigating,
    isRoutePreview,
    initCameraListeners,
    followTruck,
    startNavigationMode,
    stopNavigationMode,
    initMarker,
    updateMarkerSize,
    updateMarkerImage,
    toggleAutoFollow,
    enterRoutePreview,
    exitRoutePreview,
} = useMapCamera(map);

const {
    setupRouteLayer,
    handleMultiRouteCalculation,
    handleRouteClick,
    updateRouteProgress,
    clearRouteState,
    destinationName,
    routeDistance,
    routeEta,
    isCalculating: isCalculatingRoute,
    isWorkerReady,
    initWorkerData,
    destroyWorker,
    isRouteActive,
    routeFound,
    fullRouteDirections,
    nextTurnDistance,
    waypointList,
    removeWaypointAtIndex,
    findBestWaypointInsertionIndex,
    urbanAheadTrigger,
    rerouteTrigger,
    serviceSuggestion,
    routeAlternatives,
    primaryRouteSummary,
    currentRoutePath,
} = useRouteController(map, adjacency, nodeCoords, stopNavigationMode);

// Settings Controller — declared before the watchers below: Vue evaluates
// watch() source getters immediately, so any binding they read must already
// exist (a TDZ here blanks the whole map view).
const { activeSettings, settings, updateProfile } = useSettings();
const { t } = useTranslations();

// Parses the formatted ETA ("2h 30min" / "~ 3h 0min") into minutes so the
// job card can flag deadlines the current route won't make.
const routeEtaMinutes = computed<number | null>(() => {
    const match = routeEta.value.match(/(\d+)h\s+(\d+)min/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
});

// EVENT FEED
const { unreadCount: unreadEventCount } = useEventFeed();
const { playBeep, vibrate } = useSoundAlerts();

const isEventDrawerOpen = ref(false);
const isDriveReportOpen = ref(false);
const fatigueNotificationTrigger = ref(0);

function toggleEventDrawer() {
    isEventDrawerOpen.value = !isEventDrawerOpen.value;
}

function toggleDriveReport() {
    isDriveReportOpen.value = !isDriveReportOpen.value;
}

// Overspeed edge: one beep when crossing the limit, re-armed once the truck
// is back at or under the limit (no beeping while hovering just above).
let overspeedArmed = true;
watch([truckSpeed, speedLimit], () => {
    const speeding =
        speedLimit.value > 0 && truckSpeed.value > speedLimit.value + 5;

    if (speeding && overspeedArmed) {
        overspeedArmed = false;
        playBeep(700, 200);
        vibrate([80, 60, 80]);
    } else if (
        !speeding &&
        truckSpeed.value <= speedLimit.value
    ) {
        overspeedArmed = true;
    }
});

// Fatigue edge: alert once when the rest timer drops below 20 minutes,
// re-armed after a full rest resets the counter.
let fatigueArmed = true;
watch(restStopMinutes, (minutes) => {
    if (minutes > 0 && minutes < 20 && fatigueArmed) {
        fatigueArmed = false;
        fatigueNotificationTrigger.value++;
        playBeep(520, 260, 2);
        vibrate([120, 80, 120]);
    } else if (minutes >= 90) {
        fatigueArmed = true;
    }
});

// Urban-entry warning: the RouteController fires the trigger once per city
// entry; gate visuals + sound behind the urbanWarning setting.
const urbanNotificationTrigger = ref(0);
watch(urbanAheadTrigger, () => {
    if (!settings.value.gameplay.urbanWarning) return;
    urbanNotificationTrigger.value++;
    playBeep(600, 150);
});

// Rest / fuel suggestion: marker lives on the map until cleared by the
// planner; the toast + beep announce it once. The detour cost mirrors the
// AMap-style "+X min / +Y km" bubble so the driver can judge the stop.
const suggestionNotificationTrigger = ref(0);
const suggestionText = computed(() => {
    const suggestion = serviceSuggestion.value;
    if (!suggestion) return "";
    const label =
        suggestion.kind === "rest"
            ? t("map.restAhead")
            : t("map.fuelAhead");
    const detour = t("map.detourInfo", {
        km: suggestion.detourKm.toFixed(1),
        min: suggestion.detourMinutes,
    });
    return `${label} · ${suggestion.kmAhead} km · ${detour}`;
});
watch(serviceSuggestion, (suggestion) => {
    if (!suggestion) return;
    suggestionNotificationTrigger.value++;
    playBeep(suggestion.kind === "rest" ? 520 : 700, 200, 2);
});

// ===== Voice guidance: spoken turn cues + replan announcement (M9) =====
const { speak: speakCue, cancel: cancelSpeech } = useVoiceGuidance();

// Announce the upcoming turn as the distance-to-turn crosses the threshold
// marks; the spoken set resets whenever a different turn becomes "next".
let spokenTurnKey = "";
let spokenThresholds: number[] = [];
watch(
    [nextTurnDistance, fullRouteDirections, isNavigating],
    ([nowKm, dirs], [prevKm]) => {
        if (!isNavigating.value) return;

        const upcoming = dirs?.[1];
        if (!upcoming || upcoming.cumulativeKm === undefined) return;

        const turnKey = `${upcoming.type}:${upcoming.cumulativeKm}`;
        if (turnKey !== spokenTurnKey) {
            spokenTurnKey = turnKey;
            spokenThresholds = [];
        }

        const { voiceNavigation, voiceConcise } = settings.value.gameplay;
        if (!voiceNavigation) return;

        const threshold = pickTurnAnnouncement(
            prevKm ?? Infinity,
            nowKm,
            spokenThresholds,
            voiceConcise,
        );
        if (threshold === null) return;

        spokenThresholds.push(threshold);
        speakCue(
            `${t("voice.aheadOf", { m: Math.round(threshold * 1000) })} ${nextInstructionText.value}`,
        );
    },
);

// Guidance ended (or paused): stop any pending speech.
watch(isNavigating, (navigating) => {
    if (!navigating) cancelSpeech();
});

// Deviation replan: toast + optional beep + spoken cue, at most once per
// episode (the recalc itself is throttled upstream at 5 s).
const rerouteNotificationTrigger = ref(0);
let lastRerouteAnnouncedAt = 0;
watch(rerouteTrigger, () => {
    const now = Date.now();
    if (now - lastRerouteAnnouncedAt < 20000) return;
    lastRerouteAnnouncedAt = now;

    rerouteNotificationTrigger.value++;
    if (settings.value.gameplay.soundAlerts) playBeep(500, 180);
    speakCue(t("map.rerouting"));
});

// Route preference change: recalculate the active route so the new ferry
// / toll policy applies immediately.
watch(
    () => [activeSettings.value.avoidFerries, activeSettings.value.avoidTolls],
    () => {
        if (!isRouteActive.value || !truckCoords.value) return;

        handleMultiRouteCalculation(
            truckCoords.value,
            truckHeading.value,
            scale.value,
            averageSpeed.value,
            true,
        );
    },
);

// Maneuver instructions are translated at render time from the step type
// (steps carry English text baked in at route-generation time), so switching
// the locale retranslates the card immediately.
const MANEUVER_TEXT_KEYS: Partial<Record<DirectionStep["type"], string>> = {
    depart: "directions.depart",
    left: "directions.turnLeft",
    right: "directions.turnRight",
    "slight-left": "directions.keepLeft",
    "slight-right": "directions.keepRight",
    "exit-highway": "directions.takeExit",
    destination: "directions.arrived",
};

const nextInstructionText = computed(() => {
    const nextTurn = fullRouteDirections.value[1];
    if (!nextTurn) return t("map.followRoute");

    if (nextTurn.type === "roundabout") {
        return nextTurn.exitCount && nextTurn.exitCount > 0
            ? t("directions.roundaboutExit", { n: nextTurn.exitCount })
            : t("directions.roundaboutExitGeneric");
    }

    const textKey = MANEUVER_TEXT_KEYS[nextTurn.type];
    return textKey ? t(textKey) : t("map.followRoute");
});

let uiTimer: ReturnType<typeof setTimeout> | null = null;
let routeTimer: ReturnType<typeof setTimeout> | null = null;

loading.value = true;
progress.value = 0;

const isTruckSpawned = computed(() => {
    return (
        truckCoords.value &&
        (truckCoords.value[0] !== 0 || truckCoords.value[1] !== 0)
    );
});

// We check if it has active job, if it has one, plot a route
watch(
    [
        hasActiveJob,
        destinationCity,
        destinationCompany,
        gameConnected,
        loading,
        isWorkerReady,
        isTruckSpawned,
    ],
    async ([
        hasJob,
        city,
        company,
        isConnected,
        isLoading,
        isWorkerReady,
        truckReady,
    ]) => {
        if (!truckCoords.value) return;
        if (isLoading || !isWorkerReady || !isConnected || !truckReady) {
            currentJobKey.value = "";
            return;
        }

        const newJobKey = hasJob ? `${city}|${company}` : "";

        if (hasJob && newJobKey === currentJobKey.value) return;

        if (routeTimer) clearTimeout(routeTimer);

        if (hasJob && newJobKey !== currentJobKey.value) {
            const destCoords = findDestinationCoords(city, company);

            if (destCoords) {
                currentJobKey.value = newJobKey;
                clearRouteState();
                isClickingEnabled.value = false;

                await handleRouteClick(
                    destCoords,
                    truckCoords.value,
                    truckHeading.value,
                    scale.value,
                    false,
                    averageSpeed.value,
                );
            }
        } else if (!hasJob && currentJobKey.value !== "") {
            clearRouteState();
            stopNavigationMode();
            currentJobKey.value = "";
        }
    },
);

watch(
    [hasActiveJob, gameConnected, loading, isWorkerReady, isTruckSpawned],
    ([hasJob, isGameConnected, isLoading, isWorkerReady, truckReady]) => {
        if (!truckCoords.value) return;
        if (
            isLoading ||
            !isWorkerReady ||
            !isGameConnected ||
            hasJob ||
            !truckReady
        )
            return;

        const destination = activeSettings.value.lastDestination;

        if (destination && !isRouteActive.value && !isCalculatingRoute.value) {
            handleRouteClick(
                destination,
                truckCoords.value,
                truckHeading.value,
                scale.value,
                true,
                averageSpeed.value,
            );
        }
    },
);

watch(
    () => activeSettings.value.themeColor,
    async (newColor) => {
        if (!map.value) return;

        const newTruckImg = await generateTruckIcon(newColor);
        updateMarkerImage(newTruckImg.src);

        if (map.value.getLayer("prefab-zones")) {
            const blended = blendWithBg(lightenColor(newColor, 0.3), 0.6);
            map.value.setPaintProperty("prefab-zones", "fill-color", blended);
        }
    },
);

watch(
    () => activeSettings.value.backgroundColor,
    async (newColor) => {
        if (!map.value) return;

        if (map.value.getLayer("background")) {
            map.value.setPaintProperty(
                "background",
                "background-color",
                newColor,
            );
        }
    },
);

watch(
    () => activeSettings.value.landColor,
    async (newColor) => {
        if (!map.value) return;

        if (map.value.getLayer("water")) {
            map.value.setPaintProperty("water", "fill-color", newColor);
        }

        if (map.value.getLayer("country-borders")) {
            map.value.setPaintProperty(
                "country-borders",
                "fill-color",
                darkenColor(newColor, 0.4),
            );
        }

        if (map.value.getLayer("water-outline")) {
            map.value.setPaintProperty(
                "water-outline",
                "line-color",
                darkenColor(newColor, 0.4),
            );
        }
    },
);

watch(
    () => activeSettings.value.roadColor,
    async (newColor) => {
        if (!map.value) return;

        if (map.value.getLayer("roads")) {
            map.value.setPaintProperty("roads", "line-color", newColor);
        }
    },
);

watch(
    () => settings.value.truckMarkerSize,
    (newSize) => {
        if (newSize) {
            updateMarkerSize(newSize);
        }
    },
);

watch(
    () => activeSettings.value.fontFamily,
    (newFont) => {
        if (!map.value) return;

        const textLayers = [
            "village-labels",
            "city-labels",
            "capital-major-labels",
            "country-labels",
        ];

        textLayers.forEach((layerId) => {
            if (map.value!.getLayer(layerId)) {
                map.value!.setLayoutProperty(layerId, "text-font", [newFont]);
            }
        });
    },
);

watch(routeFound, (newVal) => {
    if (newVal !== null) {
        if (uiTimer) clearTimeout(uiTimer);

        uiTimer = setTimeout(() => {
            routeFound.value = null;
        }, 1000);
    }
});

watch([loading, gameConnected], ([isLoading, isGameConnected]) => {
    if (!isLoading) {
        setTimeout(() => {
            isCameraLocked.value = true;
        }, 100);

        if (isGameConnected) {
            setTimeout(() => {
                isCameraLocked.value = true;
            }, 500);
        }
    }
});

watch(gameConnected, (isConnected) => {
    if (!map.value) return;
    if (!isConnected) {
        isCameraLocked.value = false;
        clearRouteState();
    }
});

onMounted(async () => {
    await loadLocationData();
    if (!mapEl.value) return;
    if (isElectron.value) {
        (window as any).electronAPI.setWindowSize(950, 700, true, true);
    }

    try {
        const mapInstance = await initializeMap(mapEl.value);
        map.value = markRaw(mapInstance);
        if (!map.value) return;

        const initialTruckImg = await generateTruckIcon(
            activeSettings.value.themeColor,
        );
        map.value.on("load", async () => {
            initMarker(initialTruckImg.src, settings.value.truckMarkerSize);
            const graphData = await initializeGraphData();
            if (!graphData) return;

            const { nodes, graphBuffer, geometryBuffer } = graphData;
            if (!nodes || !graphBuffer || !geometryBuffer) return;

            initWorkerData(nodes, graphBuffer, geometryBuffer);

            setupRouteLayer();
            initCameraListeners();
        });

        map.value.on("click", async (e) => {
            const features = map.value!.queryRenderedFeatures(e.point, {
                layers: ["destination-layer"],
            });
            if (features.length > 0) return;

            if (!isClickingEnabled.value) return;
            if (!gameConnected.value) return;
            if (!truckCoords.value) return;

            const currentScale =
                scale.value > 0 ? scale.value : mapScaleConfig.value.ruralScale;

            const clickCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

            if (isRouteActive.value && isAddingStopMode.value) {
                const insertIndex = findBestWaypointInsertionIndex(clickCoords);
                waypointList.value.splice(insertIndex, 0, clickCoords);

                isAddingStopMode.value = false;
            } else if (!isRouteActive.value) {
                waypointList.value = [clickCoords];
            } else {
                waypointList.value.push(clickCoords);
            }

            await handleMultiRouteCalculation(
                truckCoords.value,
                truckHeading.value,
                currentScale,
                averageSpeed.value,
                true,
            );
        });

        startTelemetry(() => {
            onTelemetryUpdate();
        });
    } catch (e) {
        console.error(e);
    }
});

onUnmounted(() => {
    stopTelemetry();
    destroyWorker();

    if (routeTimer) clearTimeout(routeTimer);
    if (uiTimer) clearTimeout(uiTimer);

    if (map.value) {
        map.value.remove();
        map.value = null;
    }
});

function onTelemetryUpdate() {
    if (!truckCoords.value || !map.value) return;

    followTruck(truckCoords.value, truckHeading.value);

    if (isRouteActive.value) {
        updateRouteProgress(
            truckCoords.value,
            truckHeading.value,
            scale.value,
            averageSpeed.value,
            {
                fuelRangeKm: fuelRange.value,
                restStopMinutes: restStopMinutes.value,
            },
        );
    }
}

function onStartNavigation() {
    if (!truckCoords.value) return;

    startNavigationMode(truckCoords.value, truckHeading.value);

    isSheetHidden.value = true;
}

function onSheetClosed() {
    isSheetHidden.value = false;
}

function toggleEnableClicking() {
    isClickingEnabled.value = !isClickingEnabled.value;

    clickingNotificationTrigger.value++;
}

const onResetNorth = () => {
    map.value?.easeTo({
        bearing: 0,
        pitch: 0,
        duration: 500,
    });
};

const toggleAddStopClicked = () => {
    isAddingStopMode.value = !isAddingStopMode.value;

    if (isAddingStopMode.value) {
        isClickingEnabled.value = true;
    }
};

const onToggleFullscreen = async () => {
    const target = document.documentElement;

    try {
        if (!document.fullscreenElement) {
            await target.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            }
        }

        setTimeout(() => {
            map.value?.resize();
        }, 100);
    } catch (err) {
        console.error("Fullscreen error:", err);
    }
};

const toggleSettingsPanel = () => {
    isSettingsPanelOpened.value = !isSettingsPanelOpened.value;
};

const onCancelRoute = () => {
    clearRouteState();
    stopNavigationMode();
};

// Route overview: ease the camera out to the whole route for a few seconds,
// then hand it back to the truck (AMap's Preview mode). Tapping again — or
// dragging the map — exits early.
const onRouteOverview = () => {
    if (isRoutePreview.value) {
        exitRoutePreview();
        return;
    }

    const path = currentRoutePath.value;
    if (!path || path.length < 2) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of path) {
        bounds.extend([lng, lat]);
    }

    enterRoutePreview([
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
    ]);
};

// Picking an alternative re-plans with that preference set — the same
// switch the ferry/toll settings use, so reroutes keep the choice.
const onSelectAlternative = (kind: string) => {
    const alt = routeAlternatives.value?.find((a) => a.kind === kind);
    if (!alt) return;

    if (activeSettings.value.avoidTolls !== alt.flags.avoidTolls) {
        updateProfile("avoidTolls", alt.flags.avoidTolls);
    }
    if (activeSettings.value.avoidFerries !== alt.flags.avoidFerries) {
        updateProfile("avoidFerries", alt.flags.avoidFerries);
    }
};
</script>

<template>
    <div
        ref="wrapperEl"
        class="full-page-wrapper"
        :class="{ 'platform-mobile': isMobile }"
    >
        <div ref="mapEl" class="map-container"></div>

        <div class="ui-safe-container">
            <Transition name="ui-layer-fade">
                <div v-show="!isSettingsPanelOpened" class="map-ui-layer">
                    <Transition name="fade">
                        <LoadingScreen v-if="loading" :progress="progress" />
                    </Transition>

                    <TopBar
                        v-show="settings.activeUiComponents.includes('topBar')"
                        :fuel="fuel"
                        :game-connected="gameConnected"
                        :game-time="gameTime"
                        :rest-stop-minutes="restStopMinutes"
                        :rest-stop-time="restStoptime"
                        :truck-speed="truckSpeed"
                        :is-web="isWeb"
                    />

                    <div class="left-buttons">
                        <HudButton :onClick="goHome">
                            <Icon name="lucide:arrow-left" class="icon" />
                        </HudButton>

                        <HudButton :onClick="toggleSettingsPanel">
                            <Icon name="lucide:settings" class="icon" />
                        </HudButton>

                        <HudButton :onClick="toggleEventDrawer">
                            <span
                                v-if="unreadEventCount > 0"
                                class="bell-badge"
                            ></span>
                            <Icon name="lucide:bell" class="icon" />
                        </HudButton>

                        <HudButton
                            :is-active="isDriveReportOpen"
                            :class="{ 'green-icon': isDriveReportOpen }"
                            :onClick="toggleDriveReport"
                        >
                            <Icon
                                name="lucide:clipboard-list"
                                class="icon"
                            />
                        </HudButton>
                    </div>

                    <ManeuverCard
                        v-show="
                            isNavigating && activeSettings.hasTurnNavigation
                        "
                        :upcoming-turns="fullRouteDirections"
                        :distance-to-next-turn="nextTurnDistance"
                        :next-instruction="nextInstructionText"
                    />

                    <Transition name="fade">
                        <div
                            v-if="hasActiveJob && gameConnected"
                            class="job-card-wrap"
                        >
                            <JobCard
                                :job-key="activeJobKey"
                                :cargo-name="cargoName"
                                :cargo-mass-kg="cargoMassKg"
                                :cargo-damage="cargoDamage"
                                :income="income"
                                :remaining-minutes="remainingMinutes"
                                :eta-minutes="routeEtaMinutes"
                                :source-city-name="sourceCityName"
                                :source-company-name="sourceCompanyName"
                                :destination-city-name="destinationCityName"
                                :destination-company-name="destinationCompanyName"
                            />
                        </div>
                    </Transition>

                    <NotificationGeneral
                        :trigger="clickingNotificationTrigger"
                        :text="
                            isClickingEnabled
                                ? t('map.tappingEnabled')
                                : t('map.tappingDisabled')
                        "
                    >
                        <template #icon>
                            <Icon
                                v-if="isClickingEnabled"
                                class="notification-icon"
                                name="lucide:pointer"
                                size="24"
                                :style="{ color: '#4caf50' }"
                            />

                            <Icon
                                v-else
                                class="notification-icon"
                                name="lucide:pointer-off"
                                size="24"
                                :style="{ color: '#dd4a34' }"
                            />
                        </template>
                    </NotificationGeneral>

                    <NotificationGeneral
                        :trigger="fatigueNotificationTrigger"
                        :text="t('events.restDue')"
                    >
                        <template #icon>
                            <Icon
                                class="notification-icon"
                                name="lucide:bed-double"
                                size="24"
                                :style="{ color: '#7dd3fc' }"
                            />
                        </template>
                    </NotificationGeneral>

                    <NotificationGeneral
                        :trigger="urbanNotificationTrigger"
                        :text="t('map.urbanAhead')"
                    >
                        <template #icon>
                            <Icon
                                class="notification-icon"
                                name="lucide:building-2"
                                size="24"
                                :style="{ color: '#fbc02d' }"
                            />
                        </template>
                    </NotificationGeneral>

                    <NotificationGeneral
                        :trigger="suggestionNotificationTrigger"
                        :text="suggestionText"
                    >
                        <template #icon>
                            <Icon
                                class="notification-icon"
                                :name="
                                    serviceSuggestion?.kind === 'rest'
                                        ? 'lucide:bed-double'
                                        : 'lucide:fuel'
                                "
                                size="24"
                                :style="{
                                    color:
                                        serviceSuggestion?.kind === 'rest'
                                            ? '#7dd3fc'
                                            : '#f59e0b',
                                }"
                            />
                        </template>
                    </NotificationGeneral>

                    <NotificationGeneral
                        :trigger="rerouteNotificationTrigger"
                        :text="t('map.rerouting')"
                    >
                        <template #icon>
                            <Icon
                                class="notification-icon"
                                name="lucide:refresh-cw"
                                size="24"
                                :style="{ color: '#ff9800' }"
                            />
                        </template>
                    </NotificationGeneral>

                    <NotificationRoute
                        :is-route-found="routeFound"
                        :is-calculating-route="isCalculatingRoute"
                    />

                    <EventToast />

                    <div class="hud-buttons">
                        <HudButton v-if="isWeb" :onClick="onToggleFullscreen">
                            <Icon name="lucide:fullscreen" class="icon" />
                        </HudButton>

                        <HudButton :onClick="onResetNorth">
                            <Icon name="lucide:compass" class="icon" />
                        </HudButton>

                        <HudButton
                            :is-active="isAutoFollowEnabled"
                            :class="{ 'green-icon': isAutoFollowEnabled }"
                            :onClick="toggleAutoFollow"
                        >
                            <Icon
                                v-if="isAutoFollowEnabled"
                                name="lucide:locate-fixed"
                                class="icon"
                            />
                            <Icon v-else name="lucide:locate" class="icon" />
                        </HudButton>

                        <Transition name="fade">
                            <HudButton
                                v-if="isRouteActive"
                                :is-active="isRoutePreview"
                                :class="{ 'green-icon': isRoutePreview }"
                                :onClick="onRouteOverview"
                            >
                                <Icon name="lucide:map" class="icon" />
                            </HudButton>
                        </Transition>

                        <HudButton
                            :is-active="isClickingEnabled"
                            :class="
                                isClickingEnabled ? 'green-icon' : 'red-icon'
                            "
                            :onClick="toggleEnableClicking"
                        >
                            <Icon
                                v-if="isClickingEnabled"
                                name="lucide:pointer"
                                class="icon"
                            />
                            <Icon
                                v-else
                                name="lucide:pointer-off"
                                class="icon"
                            />
                        </HudButton>

                        <Transition name="fade">
                            <HudButton
                                class="add-stop-hud-btn"
                                v-if="isAddingStopMode"
                                :onClick="toggleAddStopClicked"
                            >
                                <Icon name="lucide:map-pin-plus" class="icon" />
                            </HudButton>
                        </Transition>
                    </div>

                    <SpeedLimit
                        v-show="
                            speedLimit > 0 &&
                            settings.activeUiComponents.includes('speedLimit')
                        "
                        :truck-speed="truckSpeed"
                        :speed-limit="speedLimit"
                    />

                    <div class="warnings">
                        <WarningSlide
                            :show-if="hasInGameMarker && !isRouteActive"
                            :reset-on="isRouteActive"
                            :text="t('map.externalRouteDetected')"
                        />

                        <WarningSlide
                            :show-if="!gameConnected"
                            :reset-on="gameConnected"
                            :text="t('common.gameOffline')"
                        />
                    </div>

                    <Transition name="panel-pop">
                        <div
                            v-if="isDeliveryVisible && deliveryInfo"
                            class="delivery-card-wrap"
                        >
                            <DeliveryCard
                                :info="deliveryInfo"
                                @dismiss="dismissDelivery"
                            />
                        </div>
                    </Transition>

                    <Transition name="sheet-slide" @after-leave="onSheetClosed">
                        <SheetSlide
                            v-if="isRouteActive"
                            :on-stop-navigation="onCancelRoute"
                            :is-navigating="isNavigating"
                            :on-start-navigation="onStartNavigation"
                            :destination-name="destinationName"
                            v-model:is-sheet-hidden="isSheetHidden"
                            :route-distance="routeDistance"
                            :route-eta="routeEta"
                            :speed-limit="speedLimit"
                            :truck-speed="truckSpeed"
                            :alternatives="routeAlternatives"
                            :primary-summary="primaryRouteSummary"
                            :on-select-alternative="onSelectAlternative"
                            @update:add-stop-clicked="toggleAddStopClicked"
                        />
                    </Transition>
                </div>
            </Transition>

            <Transition name="panel-pop">
                <EventDrawer
                    v-if="isEventDrawerOpen"
                    @close="toggleEventDrawer"
                />
            </Transition>

            <Transition name="panel-pop">
                <DriveReportCard
                    v-if="isDriveReportOpen"
                    @close="toggleDriveReport"
                />
            </Transition>

            <Transition name="panel-pop">
                <SettingsPanel
                    v-show="isSettingsPanelOpened"
                    :close-panel="toggleSettingsPanel"
                />
            </Transition>
        </div>
    </div>
</template>

<style scoped lang="scss" src="~/assets/scss/scoped/map/map.scss"></style>
