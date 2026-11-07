import { convertAtsToGeo, convertEts2ToGeo } from "../map/converters";
import { getBearing } from "../map/maths";
import type { GameType, TelemetryPacket } from "~/types";

export function getTruckState(
    data: TelemetryPacket,
    lastPosition: [number, number] | null,
    selectedGame: GameType,
    currentHeadingOffset: number,
    speedSamples: number[],
    maxSamples: number,
) {
    const { x, z } = data.truck.current.position;
    let truckCoords: [number, number];

    if (Math.abs(x) < 0.001 && Math.abs(z) < 0.001) {
        truckCoords = [0, 0];
    } else {
        truckCoords =
            selectedGame === "ets2"
                ? convertEts2ToGeo(x, z)
                : convertAtsToGeo(x, z);
    }

    const truckSpeed = Math.max(
        0,
        Math.floor(data.truck.current.dashboard.speedKph),
    );

    const avgSpeed = updateMovingAverage(truckSpeed, speedSamples, maxSamples);

    const rawGameHeading = data.truck.current.heading;
    const { heading, newOffset } = getCorrectHeading(
        rawGameHeading,
        truckSpeed,
        truckCoords,
        lastPosition,
        currentHeadingOffset,
    );

    return {
        truckCoords,
        truckSpeed,
        truckHeading: heading,
        headingOffset: newOffset,
        avgSpeed,
    };
}

export function getGameState(data: TelemetryPacket) {
    const name = data.game.toLowerCase();
    const gameConnected = name === "ets2" || name === "ats";

    const scale = data.common.mapScale;

    const hasInGameMarker =
        data.navigation.distance > 100 && data.job.income === 0;

    const { formatted, raw } = convertTelemtryTime(data.common.gameTime);
    const day = raw.toUTCString().slice(0, 3);
    const gameTime = `${day} ${formatted}`;

    return {
        gameConnected,
        hasInGameMarker,
        gameTime,
        scale,
    };
}

export function getNavigationState(data: TelemetryPacket) {
    const fuel = parseInt(data.truck.current.dashboard.fuelAmount.toFixed(1));
    const speedLimit = Math.max(0, Math.round(data.navigation.speedLimitKph));

    const totalMinutes = data.common.nextRestStopMinutes;
    const hours = Math.max(0, Math.floor(totalMinutes / 60));
    const mins = Math.max(0, totalMinutes % 60);

    const restStoptime = `${hours.toString().padStart(2, "0")}:${mins
        .toString()
        .padStart(2, "0")}`;

    return { fuel, speedLimit, restStoptime, restStopMinutes: totalMinutes };
}

export function getJobState(data: TelemetryPacket, selectedGame: GameType) {
    let companyTarget = "";
    let cityTarget = "";
    let trailerCoords: [number, number] = [0, 0];

    const hasActiveJob = data.specialEvents.onJob;

    const destinationCity = data.job.cityDestinationId;
    const destinationCompany = data.job.companyDestinationId;

    const jobType = data.job.jobType;

    const sourceCity = data.job.citySourceId;
    const sourceCompany = data.job.companySourceId;

    if (data.trailers[0]) {
        const isTrailerAvailable =
            data.trailers[0].position.y !== 0 &&
            data.trailers[0].position.x !== 0;

        const isTrailerAttached = data.trailers[0]?.attached;

        if (jobType === "external_contracts" || jobType === "external_market") {
            companyTarget =
                isTrailerAvailable && !isTrailerAttached
                    ? sourceCompany
                    : destinationCompany;

            cityTarget =
                isTrailerAvailable && !isTrailerAttached
                    ? sourceCity
                    : destinationCity;
        } else {
            companyTarget = destinationCompany;
            cityTarget = destinationCity;
        }
    } else {
        companyTarget = destinationCompany;
        cityTarget = destinationCity;
    }

    return { hasActiveJob, cityTarget, companyTarget, trailerCoords };
}

export function getJobDetails(data: TelemetryPacket) {
    const cargo = data.job.cargo;

    return {
        cargoName: cargo?.name ?? "",
        cargoMassKg: cargo?.mass ?? 0,
        cargoDamage: normalizePercent(cargo?.cargoDamage ?? 0),
        income: data.job.income ?? 0,
        sourceCityName: data.job.citySource ?? "",
        sourceCompanyName: data.job.companySource ?? "",
        destinationCityName: data.job.cityDestination ?? "",
        destinationCompanyName: data.job.companyDestination ?? "",
    };
}

/**
 * Remaining minutes until the delivery deadline, computed against the
 * current game time. The plugin reports both as absolute game timestamps,
 * so implausible results (e.g. a bare duration misread as a date) degrade
 * to null instead of showing a bogus countdown.
 */
export function getRemainingDeliveryMinutes(
    deliveryTimeIso: string,
    gameTimeIso: string,
): number | null {
    const deadline = new Date(deliveryTimeIso).getTime();
    const gameTime = new Date(gameTimeIso).getTime();

    if (Number.isNaN(deadline) || Number.isNaN(gameTime)) return null;

    const minutes = (deadline - gameTime) / 60000;

    // Plausible window: 24h overdue up to a week of remaining time.
    if (minutes < -24 * 60 || minutes > 7 * 24 * 60) return null;

    return minutes;
}

function normalizePercent(value: number) {
    // The plugin reports damage as 0-100, but guard against 0-1 fractions.
    const percent = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, percent));
}

export type GameEventKind = "fine" | "toll" | "ferry" | "train";

export interface GameEventItem {
    kind: GameEventKind;
    amount: number;
    label: string;
}

/**
 * Extracts the economy detail for one momentary special event. Returns null
 * when the packet carries no usable data for the requested kind (e.g. the
 * event flag fired before its payload arrived).
 */
export function extractGameEvent(
    data: TelemetryPacket,
    kind: GameEventKind,
): GameEventItem | null {
    const events = data.gamePlayEvents;
    if (!events) return null;

    switch (kind) {
        case "fine": {
            const fine = events.finedData;
            if (!fine || !(fine.payAmount > 0)) return null;
            return { kind, amount: fine.payAmount, label: fine.offence ?? "" };
        }
        case "toll": {
            const amount = events.tollgatePayment;
            if (!(amount > 0)) return null;
            return { kind, amount, label: "" };
        }
        case "ferry":
        case "train": {
            const ride = kind === "ferry" ? events.ferryData : events.trainData;
            if (!ride || !(ride.payAmount > 0)) return null;
            const label = [ride.sourceName, ride.targetName]
                .filter(Boolean)
                .join(" → ");
            return { kind, amount: ride.payAmount, label };
        }
    }
}

/**
 * Checks if telemetry bridge is reachable
 * @param ip Ip to get data from
 * @param timeoutMs How long to wait before giving up
 * @returns boolean - true if running, false if not
 */
export async function isBridgeRunning(
    ip: string,
    timeoutMs: number = 2000,
): Promise<boolean> {
    const wsUrl = `ws://${ip}:30001`;

    return new Promise((resolve) => {
        const testSocket = new WebSocket(wsUrl);

        const timeoutId = setTimeout(() => {
            testSocket.close();
            resolve(false);
        }, timeoutMs);

        testSocket.onopen = () => {
            clearTimeout(timeoutId);
            testSocket.close();
            resolve(true);
        };

        testSocket.onerror = () => {
            clearTimeout(timeoutId);
            testSocket.close();
            resolve(false);
        };
    });
}

function getCorrectHeading(
    rawGameHeading: number,
    truckSpeed: number,
    currentCoords: [number, number],
    lastPosition: [number, number] | null,
    headingOffset: number,
) {
    let internalOffset = headingOffset;

    const rawDegrees = -rawGameHeading * 360;

    if (lastPosition && truckSpeed > 10) {
        const dist = Math.sqrt(
            Math.pow(currentCoords[0] - lastPosition[0], 2) +
                Math.pow(currentCoords[1] - lastPosition[1], 2),
        );

        if (dist > 0.00005) {
            const trueBearing = getBearing(lastPosition, currentCoords);

            let diff = trueBearing - rawDegrees;
            while (diff < -180) diff += 360;
            while (diff > 180) diff -= 360;

            if (Math.abs(diff) < 90) {
                internalOffset += (diff - internalOffset) * 0.1;
            }
        }
    }

    let finalHeading = rawDegrees + internalOffset;
    finalHeading = ((finalHeading % 360) + 360) % 360;

    return { heading: finalHeading, newOffset: internalOffset };
}

function convertTelemtryTime(time: string) {
    const date = new Date(time);
    return {
        formatted: `${date.getUTCHours().toString().padStart(2, "0")}:${date
            .getUTCMinutes()
            .toString()
            .padStart(2, "0")}`,
        raw: date,
    };
}

function updateMovingAverage(
    currentSpeed: number,
    speedSamples: number[],
    maxSamples: number,
) {
    if (currentSpeed > 10) {
        speedSamples.push(currentSpeed);
        if (speedSamples.length > maxSamples) speedSamples.shift();
    }

    if (speedSamples.length === 0) return 80;

    const sum = speedSamples.reduce((a, b) => a + b, 0);
    return sum / speedSamples.length;
}
