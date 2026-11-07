export interface TelemetryUpdate {
    truck: TruckState;
    game: GameState;
    general: NavigationState;
    job: JobState;
}

export interface GameState {
    gameTime: string;
    gameConnected: boolean;
    hasInGameMarker: boolean;
    scale: number;
}

export interface TruckState {
    truckCoords: [number, number] | null;
    truckHeading: number;
    truckSpeed: number;
    averageSpeed: number;
}

export interface NavigationState {
    fuel: number;
    /** Remaining driving range reported by the game dashboard, in km. */
    fuelRange: number;
    speedLimit: number;
    restStoptime: string;
    restStopMinutes: number;
}

export interface JobState {
    hasActiveJob: boolean;
    income: number;
    cargoName: string;
    cargoMassKg: number;
    cargoDamage: number;
    remainingMinutes: number | null;
    sourceCityName: string;
    sourceCompanyName: string;
    destinationCityName: string;
    destinationCompanyName: string;
    destinationCity: string;
    destinationCompany: string;
}

export type DeliveryKind = "delivered" | "cancelled";

import type { DeliveryGrade } from "~/assets/utils/gameplay/score";

export interface DeliveryInfo {
    kind: DeliveryKind;
    revenue: number;
    penalty: number;
    earnedXp: number;
    cargoDamage: number;
    distanceKm: number;
    deliveredAt: string;
    autoParker: boolean;
    autoLoaded: boolean;
    /** Performance grade, only present on delivered jobs. */
    grade?: DeliveryGrade;
}

export interface DeliveryState {
    isVisible: boolean;
    info: DeliveryInfo | null;
}
