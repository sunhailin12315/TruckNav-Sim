import { Capacitor } from "@capacitor/core";
import {
    extractGameEvent,
    getGameState,
    getJobDetails,
    getJobState,
    getNavigationState,
    getRemainingDeliveryMinutes,
    getTruckState,
} from "~/assets/utils/telemetry/helpers";
import { currencySymbolFor, formatMoney } from "~/assets/utils/shared/format";
import type { AchievementDef } from "~/assets/utils/gameplay/achievements";
import type {
    TruckState,
    GameState,
    NavigationState,
    JobState,
    DeliveryState,
    DeliveryInfo,
    TelemetryUpdate,
    TelemetryPacket,
} from "~/types";

const truckState = reactive<TruckState>({
    truckCoords: [0, 0],
    truckHeading: 0,
    truckSpeed: 0,
    averageSpeed: 80,
});

const gameState = reactive<GameState>({
    gameTime: "",
    gameConnected: false,
    hasInGameMarker: false,
    scale: 0,
});

const navigationState = reactive<NavigationState>({
    fuel: 0,
    speedLimit: 0,
    restStoptime: "",
    restStopMinutes: 0,
});

const jobState = reactive<JobState>({
    hasActiveJob: false,
    income: 0,
    cargoName: "",
    cargoMassKg: 0,
    cargoDamage: 0,
    remainingMinutes: null,
    sourceCityName: "",
    sourceCompanyName: "",
    destinationCityName: "",
    destinationCompanyName: "",
    destinationCity: "0",
    destinationCompany: "0",
});

const deliveryState = reactive<DeliveryState>({
    isVisible: false,
    info: null,
});

// Delivery detection: jobs end when onJob flips off; the settlement data
// may lag a few packets behind, so a short lookup window bridges the gap.
const DELIVERY_LOOKUP_WINDOW_MS = 4000;
let wasOnJob = false;
let jobEndWindowUntil = 0;
let lastDeliveryKey = "";
let pendingTripEnd = false;

function normalizeDamage(value: number) {
    // The plugin reports damage as 0-100, but guard against 0-1 fractions.
    const percent = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, percent));
}

function formatGameClock(isoTime: string) {
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) return "";
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

let lastPosition: [number, number] | null = null;
let headingOffset = 0;
let lastRpcSignature = "";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

function sendDiscordRpcState(payload: {
    game: string;
    connected: boolean;
    hasActiveJob: boolean;
    sourceCity?: string;
    destinationCity?: string;
    cargoName?: string;
    truckBrand?: string;
    truckName?: string;
    statusNote?: string;
}) {
    if (typeof window === "undefined") return;

    const electronApi = (window as any).electronAPI;
    if (!electronApi?.updateDiscordRpc) return;

    const signature = JSON.stringify(payload);
    if (signature === lastRpcSignature) return;
    lastRpcSignature = signature;

    electronApi.updateDiscordRpc(payload);
}

function clearDiscordRpcState() {
    lastRpcSignature = "";

    if (typeof window === "undefined") return;

    const electronApi = (window as any).electronAPI;
    if (!electronApi?.clearDiscordRpc) return;

    electronApi.clearDiscordRpc();
}

// Momentary Rich Presence line (deliveries, fines, cancellations). The note
// rides on top of the last telemetry-derived payload and expires on its own.
const RPC_NOTE_TTL_MS = 3 * 60_000;
type RpcBasePayload = {
    game: string;
    connected: boolean;
    hasActiveJob: boolean;
    sourceCity?: string;
    destinationCity?: string;
    cargoName?: string;
    truckBrand?: string;
    truckName?: string;
};
let rpcStatusNote = "";
let rpcNoteTimer: ReturnType<typeof setTimeout> | null = null;
let lastRpcBasePayload: RpcBasePayload | null = null;

function pushRpcPayload() {
    if (!lastRpcBasePayload) return;
    sendDiscordRpcState({
        ...lastRpcBasePayload,
        statusNote: rpcStatusNote || undefined,
    });
}

function setRpcStatusNote(note: string) {
    rpcStatusNote = note;

    if (rpcNoteTimer) clearTimeout(rpcNoteTimer);
    if (note) {
        rpcNoteTimer = setTimeout(() => {
            rpcStatusNote = "";
            pushRpcPayload();
        }, RPC_NOTE_TTL_MS);
    }

    pushRpcPayload();
}

function clearRpcStatusNote() {
    if (rpcNoteTimer) {
        clearTimeout(rpcNoteTimer);
        rpcNoteTimer = null;
    }

    if (rpcStatusNote) {
        rpcStatusNote = "";
        pushRpcPayload();
    }
}

function resetRpcStatusNote() {
    lastRpcBasePayload = null;
    rpcStatusNote = "";
    if (rpcNoteTimer) {
        clearTimeout(rpcNoteTimer);
        rpcNoteTimer = null;
    }
}

export function useEtsTelemetry() {
    const { settings } = useSettings();
    const { pushEvent } = useEventFeed();
    const { playBeep, vibrate } = useSoundAlerts();
    const tripLog = useTripLog();
    const { t } = useTranslations();

    const isCapacitor = Capacitor.isNativePlatform();

    let speedSamples: number[] = [];
    const maxSamples = 120;

    // Rising-edge tracker for the momentary special-event flags; the plugin
    // may hold a flag true across several packets, so only 0→1 pushes feed.
    let prevEventFlags = {
        fined: false,
        tollgate: false,
        ferry: false,
        train: false,
    };

    function startTelemetry(onUpdate?: (data: TelemetryUpdate) => void) {
        if (socket) return;

        const ip = isCapacitor
            ? settings.value.savedIP
            : window.location.hostname;
        const url = `ws://${ip}:30001`;

        socket = new WebSocket(url);

        socket.onopen = () => {
            reconnectAttempts = 0;
            console.log("Connected to Bridge");
        };

        socket.onmessage = (event) => {
            try {
                const rawData = JSON.parse(event.data);

                const data = rawData as TelemetryPacket;

                if (data.game.toLowerCase() !== settings.value.selectedGame) {
                    resetDataOnDisconnected(onUpdate);
                    return;
                }

                if (data) {
                    processData(data, onUpdate);
                }
            } catch (e) {
                console.error("Data error", e);
            }
        };

        socket.onclose = () => {
            socket = null;
            resetDataOnDisconnected(onUpdate);
            scheduleReconnect(onUpdate);
        };
    }

    function stopTelemetry() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (socket) {
            socket.onclose = null;
            socket.close();
            socket = null;
        }
    }

    function scheduleReconnect(onUpdate?: (data: TelemetryUpdate) => void) {
        if (reconnectTimer) return;

        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
            MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempts++;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startTelemetry(onUpdate);
        }, delay);
    }

    function processData(
        data: TelemetryPacket,
        onUpdate?: (data: TelemetryUpdate) => void,
    ) {
        const { gameConnected, hasInGameMarker, gameTime, scale } =
            getGameState(data);

        Object.assign(gameState, {
            gameTime: gameTime,
            gameConnected: gameConnected,
            hasInGameMarker: hasInGameMarker,
            scale: scale,
        });

        const {
            truckCoords,
            truckSpeed,
            truckHeading,
            headingOffset: newOffset,
            avgSpeed,
        } = getTruckState(
            data,
            lastPosition,
            settings.value.selectedGame,
            headingOffset,
            speedSamples,
            maxSamples,
        );

        Object.assign(truckState, {
            truckCoords: truckCoords,
            truckHeading: truckHeading,
            truckSpeed: truckSpeed,
            averageSpeed: avgSpeed,
        });

        lastPosition = truckCoords;
        headingOffset = newOffset;

        const { fuel, speedLimit, restStoptime, restStopMinutes } =
            getNavigationState(data);

        Object.assign(navigationState, {
            restStoptime: restStoptime,
            restStopMinutes: restStopMinutes,
            speedLimit: speedLimit,
            fuel: fuel,
        });

        const {
            hasActiveJob,
            cityTarget: destinationCity,
            companyTarget: destinationCompany,
        } = getJobState(data, settings.value.selectedGame);

        const jobDetails = getJobDetails(data);

        Object.assign(jobState, {
            hasActiveJob: hasActiveJob,
            destinationCity: destinationCity,
            destinationCompany: destinationCompany,
            ...jobDetails,
            remainingMinutes: getRemainingDeliveryMinutes(
                data.job.remainingDeliveryTime,
                data.common.gameTime,
            ),
        });

        detectDeliveryEnd(data, hasActiveJob);
        detectEconomyEvents(data, hasActiveJob);

        if (hasActiveJob) {
            // A fresh job supersedes any lingering delivery/fine note.
            if (!wasOnJob) clearRpcStatusNote();

            tripLog.beginTripIfIdle({
                game: settings.value.selectedGame ?? "",
                sourceCity: jobDetails.sourceCityName,
                destinationCity: jobDetails.destinationCityName,
                cargoName: jobDetails.cargoName,
                cargoMassKg: jobDetails.cargoMassKg,
            });
        }

        lastRpcBasePayload = {
            game: data.game,
            connected: gameConnected,
            hasActiveJob,
            sourceCity: data.job.citySource || data.job.citySourceId,
            destinationCity:
                data.job.cityDestination || data.job.cityDestinationId,
            cargoName: data.job.cargo?.name,
            truckBrand: data.truck.constants?.brand,
            truckName: data.truck.constants?.name,
        };
        sendDiscordRpcState({
            ...lastRpcBasePayload,
            statusNote: rpcStatusNote || undefined,
        });

        if (onUpdate) {
            onUpdate({
                truck: { ...truckState },
                game: { ...gameState },
                general: { ...navigationState },
                job: { ...jobState },
            });
        }
    }

    function notifyFeedEvent(
        kind: Parameters<typeof pushEvent>[0],
        amount: number,
        label: string,
    ) {
        pushEvent(kind, amount, label, gameState.gameTime);
        playBeep(660, 120);
        vibrate(30);
    }

    function announceAchievements(defs: AchievementDef[]) {
        for (const def of defs) {
            notifyFeedEvent("achievement", 0, t(def.titleKey));
        }
    }

    function detectEconomyEvents(data: TelemetryPacket, onJob: boolean) {
        const flags = {
            fined: data.specialEvents.fined === true,
            tollgate: data.specialEvents.tollgate === true,
            ferry: data.specialEvents.ferry === true,
            train: data.specialEvents.train === true,
        };

        const kinds = [
            { kind: "fine", flag: "fined" },
            { kind: "toll", flag: "tollgate" },
            { kind: "ferry", flag: "ferry" },
            { kind: "train", flag: "train" },
        ] as const;

        for (const { kind, flag } of kinds) {
            if (flags[flag] && !prevEventFlags[flag]) {
                const item = extractGameEvent(data, kind);
                if (item) {
                    notifyFeedEvent(item.kind, item.amount, item.label);
                    announceAchievements(
                        tripLog.recordEconomyEvent(
                            item.kind,
                            item.amount,
                            onJob,
                        ),
                    );

                    if (item.kind === "fine") {
                        setRpcStatusNote(
                            `Fine · -${formatMoney(item.amount, currencySymbolFor(settings.value.selectedGame))}`,
                        );
                    }
                }
            }
        }

        prevEventFlags = flags;
    }

    function detectDeliveryEnd(data: TelemetryPacket, onJob: boolean) {
        const now = Date.now();

        if (wasOnJob && !onJob) {
            // A job just ended; give the settlement data a few packets to arrive.
            jobEndWindowUntil = now + DELIVERY_LOOKUP_WINDOW_MS;
            pendingTripEnd = true;
        }
        wasOnJob = onJob;

        if (now >= jobEndWindowUntil) {
            if (pendingTripEnd) {
                tripLog.endTrip(null);
                pendingTripEnd = false;
            }
            return;
        }
        if (deliveryState.isVisible) return;

        const delivered = data.gamePlayEvents?.jobDelivered;
        const penalty = data.gamePlayEvents?.jobCancelledPenalty ?? 0;

        if (delivered && (delivered.revenue > 0 || delivered.distanceKm > 0)) {
            const key = `${delivered.deliveryTime}|${delivered.revenue}|${delivered.distanceKm}`;
            if (key === lastDeliveryKey) {
                jobEndWindowUntil = 0;
                pendingTripEnd = false;
                tripLog.endTrip(null);
                return;
            }

            lastDeliveryKey = key;
            jobEndWindowUntil = 0;
            pendingTripEnd = false;

            deliveryState.info = {
                kind: "delivered",
                revenue: delivered.revenue,
                penalty: 0,
                earnedXp: delivered.earnedXp ?? 0,
                cargoDamage: normalizeDamage(delivered.cargoDamage ?? 0),
                distanceKm: delivered.distanceKm ?? 0,
                deliveredAt: formatGameClock(delivered.deliveryTime),
                autoParker: delivered.autoParker ?? false,
                autoLoaded: delivered.autoLoaded ?? false,
            };
            deliveryState.isVisible = true;

            notifyFeedEvent(
                "delivered",
                delivered.revenue,
                jobState.destinationCityName,
            );
            setRpcStatusNote(
                `Delivered to ${jobState.destinationCityName || "company"} · +${formatMoney(delivered.revenue, currencySymbolFor(settings.value.selectedGame))}`,
            );
            announceAchievements(
                tripLog.endTrip({
                    kind: "delivered",
                    income: delivered.revenue,
                    penalty: 0,
                    cargoDamage: normalizeDamage(delivered.cargoDamage ?? 0),
                    distanceKm: delivered.distanceKm ?? 0,
                    earnedXp: delivered.earnedXp ?? 0,
                    completedAt: gameState.gameTime,
                }),
            );
            return;
        }

        if (penalty > 0 || data.specialEvents.jobCancelled === true) {
            const key = `cancelled|${penalty}`;
            if (key === lastDeliveryKey) {
                jobEndWindowUntil = 0;
                pendingTripEnd = false;
                tripLog.endTrip(null);
                return;
            }

            lastDeliveryKey = key;
            jobEndWindowUntil = 0;
            pendingTripEnd = false;

            const info: DeliveryInfo = {
                kind: "cancelled",
                revenue: 0,
                penalty: penalty,
                earnedXp: 0,
                cargoDamage: 0,
                distanceKm: 0,
                deliveredAt: "",
                autoParker: false,
                autoLoaded: false,
            };
            deliveryState.info = info;
            deliveryState.isVisible = true;

            if (penalty > 0) {
                notifyFeedEvent("cancelled", penalty, "");
                setRpcStatusNote(
                    `Job cancelled · -${formatMoney(penalty, currencySymbolFor(settings.value.selectedGame))}`,
                );
                announceAchievements(
                    tripLog.endTrip({
                        kind: "cancelled",
                        income: 0,
                        penalty: penalty,
                        cargoDamage: 0,
                        distanceKm: 0,
                        earnedXp: 0,
                        completedAt: gameState.gameTime,
                    }),
                );
            }
        }
    }

    function dismissDelivery() {
        deliveryState.isVisible = false;
    }

    function resetDataOnDisconnected(
        onUpdate?: (data: TelemetryUpdate) => void,
    ) {
        const wasConnected = gameState.gameConnected;
        headingOffset = 0;
        lastPosition = null;
        speedSamples = [];
        resetRpcStatusNote();

        Object.assign(gameState, {
            gameConnected: false,
            hasInGameMarker: false,
            gameTime: "",
            scale: 0,
        });

        Object.assign(truckState, {
            truckCoords: [0, 0],
            truckHeading: 0,
            truckSpeed: 0,
        });

        Object.assign(navigationState, {
            fuel: 0,
            speedLimit: 0,
            restStopMinutes: 0,
            restStoptime: "0",
        });

        Object.assign(jobState, {
            hasActiveJob: false,
            income: 0,
            cargoName: "",
            cargoMassKg: 0,
            cargoDamage: 0,
            remainingMinutes: null,
            sourceCityName: "",
            sourceCompanyName: "",
            destinationCityName: "",
            destinationCompanyName: "",
        });

        clearDiscordRpcState();

        if (onUpdate && wasConnected) {
            onUpdate({
                truck: { ...truckState },
                game: { ...gameState },
                general: { ...navigationState },
                job: { ...jobState },
            });
        }
    }

    return {
        ...toRefs(navigationState),
        ...toRefs(truckState),
        ...toRefs(gameState),
        ...toRefs(jobState),
        ...toRefs(deliveryState),
        dismissDelivery,
        startTelemetry,
        stopTelemetry,
    };
}
