import type { GameType } from "~/types";

// ---------------------------------------------------------------
// Settings data contract: types, defaults, parsing/normalization
// and versioned migrations. Kept free of Vue/Nuxt imports so it
// stays unit-testable; app/composables/Settings.ts holds behavior.
// ---------------------------------------------------------------

export type UnitSystem = "metric" | "imperial";
export type TextTheme = "light" | "dark";
export type RouteTimeMode = "game" | "real";
export type UiComponent =
    | "speed"
    | "fuel"
    | "sleep"
    | "time"
    | "speedLimit"
    | "topBar";
export type ActiveComponents = UiComponent[];
export type LocaleCode = "en" | "de" | "nl" | "cs" | "sk" | "ko" | "ro";

export interface GameProfile {
    themeColor: string;
    textColor: TextTheme;
    routeColor: string;
    backgroundColor: string;
    landColor: string;
    roadColor: string;
    units: UnitSystem;
    ownedDlcs: number[];
    lastDestination: [number, number] | null;
    hasTurnNavigation: boolean;
    avoidFerries: boolean;
    avoidTolls: boolean;
    fontFamily: string;
    activeMod: string | "none";
}

export interface GameplaySettings {
    /** Toast + history for fines, tolls, ferry/train rides and deliveries. */
    eventFeed: boolean;
    /** Beeps and vibration for overspeed, fatigue and feed events. */
    soundAlerts: boolean;
    /** Toast when the route is about to enter an urban area. */
    urbanWarning: boolean;
}

export interface AppSettingsState {
    /** Bumped whenever the settings shape changes; see MIGRATIONS. */
    schemaVersion: number;
    selectedGame: GameType;
    savedIP: string | null;
    profiles: {
        ets2: GameProfile;
        ats: GameProfile;
    };
    hudBtnSize: number;
    truckMarkerSize: number;
    compactTripFontSize: number;
    activeUiComponents: ActiveComponents;
    locale: LocaleCode;
    routeTimeMode: RouteTimeMode;
    gameplay: GameplaySettings;
}

export const SETTINGS_SCHEMA_VERSION = 4;

const UI_COMPONENTS: readonly UiComponent[] = [
    "speed",
    "fuel",
    "sleep",
    "time",
    "speedLimit",
    "topBar",
];

const LOCALES: readonly LocaleCode[] = ["en", "de", "nl", "cs", "sk", "ro", "ko"];

const DEFAULT_PROFILE: GameProfile = {
    themeColor: "#fbc02d",
    textColor: "light",
    routeColor: "#22d3ee",
    roadColor: "#4a5f7a",
    backgroundColor: "#24467b",
    landColor: "#272d39",
    units: "metric",
    ownedDlcs: Array.from({ length: 10 }, (_, i) => i + 1),
    lastDestination: null,
    hasTurnNavigation: true,
    avoidFerries: false,
    avoidTolls: false,
    fontFamily: "Commissioner",
    activeMod: "none",
};

export const DEFAULT_SETTINGS: AppSettingsState = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    selectedGame: null,
    savedIP: null,
    profiles: {
        ets2: {
            ...DEFAULT_PROFILE,
            themeColor: "#fbc02d",
            textColor: "dark",
            units: "metric",
        },
        ats: {
            ...DEFAULT_PROFILE,
            themeColor: "#d32f2f",
            ownedDlcs: Array.from({ length: 18 }, (_, i) => i + 1),
            units: "imperial",
        },
    },
    hudBtnSize: 30,
    truckMarkerSize: 40,
    compactTripFontSize: 1.8,
    activeUiComponents: [
        "speed",
        "speedLimit",
        "fuel",
        "time",
        "sleep",
        "topBar",
    ],
    locale: "en",
    routeTimeMode: "game",
    // The visual feed is quiet enough to ship on; sound stays opt-in.
    gameplay: {
        eventFeed: true,
        soundAlerts: false,
        urbanWarning: true,
    },
};

/** A fresh, deeply-copied default settings object (no shared references). */
export function defaultSettings(): AppSettingsState {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

type RawRecord = Record<string, unknown>;

// One step per version bump: MIGRATIONS[v] upgrades stored data written by
// schema version v into the shape of version v + 1. Data without a version
// is treated as v1 (the current shape), so future changes only append steps.
const MIGRATIONS: Record<number, (raw: RawRecord) => RawRecord> = {
    // v2 adds the gameplay block; the normalizer fills in its defaults, so
    // the step only marks stored v1 data as migrated (triggering a re-save).
    1: (raw) => raw,
    // v3 adds avoidFerries (profile) and urbanWarning (gameplay); the
    // normalizer fills their defaults, so this step only marks migration.
    2: (raw) => raw,
    // v4 adds avoidTolls (profile); the normalizer fills its default.
    3: (raw) => raw,
};

function oneOf<T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

function asColor(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asCoordinate(value: unknown): [number, number] | null {
    if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "number" &&
        Number.isFinite(value[0]) &&
        typeof value[1] === "number" &&
        Number.isFinite(value[1])
    ) {
        return [value[0], value[1]];
    }
    return null;
}

function normalizeGameplay(raw: unknown, defaults: GameplaySettings): GameplaySettings {
    const source = raw && typeof raw === "object" ? (raw as RawRecord) : {};

    return {
        eventFeed:
            typeof source.eventFeed === "boolean"
                ? source.eventFeed
                : defaults.eventFeed,
        soundAlerts:
            typeof source.soundAlerts === "boolean"
                ? source.soundAlerts
                : defaults.soundAlerts,
        urbanWarning:
            typeof source.urbanWarning === "boolean"
                ? source.urbanWarning
                : defaults.urbanWarning,
    };
}

function normalizeProfile(raw: unknown, defaults: GameProfile): GameProfile {
    const source = raw && typeof raw === "object" ? (raw as RawRecord) : {};

    return {
        themeColor: asColor(source.themeColor, defaults.themeColor),
        textColor: oneOf(source.textColor, ["light", "dark"] as const, defaults.textColor),
        routeColor: asColor(source.routeColor, defaults.routeColor),
        backgroundColor: asColor(source.backgroundColor, defaults.backgroundColor),
        landColor: asColor(source.landColor, defaults.landColor),
        roadColor: asColor(source.roadColor, defaults.roadColor),
        units: oneOf(source.units, ["metric", "imperial"] as const, defaults.units),
        ownedDlcs: Array.isArray(source.ownedDlcs)
            ? source.ownedDlcs.filter(
                  (id): id is number =>
                      typeof id === "number" && Number.isInteger(id) && id > 0,
              )
            : [...defaults.ownedDlcs],
        lastDestination: asCoordinate(source.lastDestination),
        hasTurnNavigation:
            typeof source.hasTurnNavigation === "boolean"
                ? source.hasTurnNavigation
                : defaults.hasTurnNavigation,
        avoidFerries:
            typeof source.avoidFerries === "boolean"
                ? source.avoidFerries
                : defaults.avoidFerries,
        avoidTolls:
            typeof source.avoidTolls === "boolean"
                ? source.avoidTolls
                : defaults.avoidTolls,
        fontFamily: asColor(source.fontFamily, defaults.fontFamily),
        activeMod: typeof source.activeMod === "string" ? source.activeMod : defaults.activeMod,
    };
}

function normalizeSettings(raw: unknown): AppSettingsState {
    const source = raw && typeof raw === "object" ? (raw as RawRecord) : {};
    const profiles = (source.profiles && typeof source.profiles === "object"
        ? (source.profiles as RawRecord)
        : {}) as RawRecord;

    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        selectedGame:
            source.selectedGame === "ets2" || source.selectedGame === "ats"
                ? source.selectedGame
                : null,
        savedIP: typeof source.savedIP === "string" ? source.savedIP : null,
        profiles: {
            ets2: normalizeProfile(profiles.ets2, DEFAULT_SETTINGS.profiles.ets2),
            ats: normalizeProfile(profiles.ats, DEFAULT_SETTINGS.profiles.ats),
        },
        hudBtnSize: asFiniteNumber(source.hudBtnSize, DEFAULT_SETTINGS.hudBtnSize),
        truckMarkerSize: asFiniteNumber(
            source.truckMarkerSize,
            DEFAULT_SETTINGS.truckMarkerSize,
        ),
        compactTripFontSize: asFiniteNumber(
            source.compactTripFontSize,
            DEFAULT_SETTINGS.compactTripFontSize,
        ),
        activeUiComponents: Array.isArray(source.activeUiComponents)
            ? source.activeUiComponents.filter((id): id is UiComponent =>
                  (UI_COMPONENTS as readonly string[]).includes(id as string),
              )
            : [...DEFAULT_SETTINGS.activeUiComponents],
        locale: oneOf(source.locale, LOCALES, DEFAULT_SETTINGS.locale),
        routeTimeMode: oneOf(
            source.routeTimeMode,
            ["game", "real"] as const,
            DEFAULT_SETTINGS.routeTimeMode,
        ),
        gameplay: normalizeGameplay(
            source.gameplay,
            DEFAULT_SETTINGS.gameplay,
        ),
    };
}

/**
 * Parses stored settings JSON: runs pending schema migrations, then
 * normalizes every field against the defaults so corrupt or stale data can
 * never reach the runtime.
 */
export function loadSettingsFromRaw(json: string): {
    settings: AppSettingsState;
    migrated: boolean;
} {
    let raw: unknown = null;
    try {
        raw = JSON.parse(json);
    } catch {
        raw = null;
    }

    let migrated = false;
    if (raw && typeof raw === "object") {
        const record = raw as RawRecord;
        const storedVersion =
            typeof record.schemaVersion === "number" &&
            Number.isInteger(record.schemaVersion) &&
            record.schemaVersion >= 1
                ? record.schemaVersion
                : 1;

        for (let v = storedVersion; v < SETTINGS_SCHEMA_VERSION; v++) {
            const step = MIGRATIONS[v];
            if (step) {
                raw = step(record);
                migrated = true;
            }
        }
    }

    return { settings: normalizeSettings(raw), migrated };
}
