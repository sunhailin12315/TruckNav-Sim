import { describe, expect, it } from "vitest";
import {
    DEFAULT_SETTINGS,
    SETTINGS_SCHEMA_VERSION,
    defaultSettings,
    loadSettingsFromRaw,
} from "~/assets/utils/shared/settingsSchema";

describe("settingsSchema", () => {
    it("deep-copies defaults so mutations cannot leak into the template", () => {
        const settings = defaultSettings();
        settings.profiles.ets2.themeColor = "#000000";
        settings.profiles.ets2.ownedDlcs.push(999);

        expect(DEFAULT_SETTINGS.profiles.ets2.themeColor).toBe("#fbc02d");
        expect(DEFAULT_SETTINGS.profiles.ets2.ownedDlcs).toHaveLength(10);
    });

    it("passes a valid payload through per-field", () => {
        const stored = {
            schemaVersion: 1,
            selectedGame: "ats",
            savedIP: "192.168.1.50",
            hudBtnSize: 44,
            locale: "de",
            routeTimeMode: "real",
            activeUiComponents: ["speed", "topBar"],
            profiles: {
                ets2: {
                    themeColor: "#123456",
                    units: "imperial",
                    ownedDlcs: [1, 2, 3],
                    lastDestination: [10.5, 20.5],
                    hasTurnNavigation: false,
                },
            },
        };

        const { settings } = loadSettingsFromRaw(JSON.stringify(stored));

        expect(settings.selectedGame).toBe("ats");
        expect(settings.savedIP).toBe("192.168.1.50");
        expect(settings.hudBtnSize).toBe(44);
        expect(settings.locale).toBe("de");
        expect(settings.routeTimeMode).toBe("real");
        expect(settings.activeUiComponents).toEqual(["speed", "topBar"]);
        expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);

        // ETS2 profile keeps the stored values...
        expect(settings.profiles.ets2.themeColor).toBe("#123456");
        expect(settings.profiles.ets2.units).toBe("imperial");
        expect(settings.profiles.ets2.ownedDlcs).toEqual([1, 2, 3]);
        expect(settings.profiles.ets2.lastDestination).toEqual([10.5, 20.5]);
        expect(settings.profiles.ets2.hasTurnNavigation).toBe(false);

        // ...and the untouched ATS profile falls back to its own defaults.
        expect(settings.profiles.ats.themeColor).toBe(
            DEFAULT_SETTINGS.profiles.ats.themeColor,
        );
        expect(settings.profiles.ats.units).toBe("imperial");
    });

    it("falls back per-field on wrong types instead of dropping everything", () => {
        const stored = {
            selectedGame: "gmod",
            savedIP: 42,
            hudBtnSize: "huge",
            locale: "xx",
            routeTimeMode: "warp",
            activeUiComponents: ["speed", "notAComponent", 7],
            profiles: {
                ets2: {
                    units: "nautical",
                    ownedDlcs: [1, "2", -3, 4.5, 5],
                    lastDestination: [10, 20, 30],
                    fontFamily: "",
                },
            },
        };

        const { settings } = loadSettingsFromRaw(JSON.stringify(stored));

        expect(settings.selectedGame).toBeNull();
        expect(settings.savedIP).toBeNull();
        expect(settings.hudBtnSize).toBe(DEFAULT_SETTINGS.hudBtnSize);
        expect(settings.locale).toBe("en");
        expect(settings.routeTimeMode).toBe("game");
        expect(settings.activeUiComponents).toEqual(["speed"]);
        expect(settings.profiles.ets2.units).toBe("metric");
        // Only the valid positive integers survive.
        expect(settings.profiles.ets2.ownedDlcs).toEqual([1, 5]);
        expect(settings.profiles.ets2.lastDestination).toBeNull();
        expect(settings.profiles.ets2.fontFamily).toBe("Commissioner");
    });

    it("returns full defaults on corrupt JSON", () => {
        const { settings } = loadSettingsFromRaw("{not json at all");

        expect(settings).toEqual(
            loadSettingsFromRaw(JSON.stringify({})).settings,
        );
        expect(settings.profiles.ets2.ownedDlcs).toHaveLength(10);
    });

    it("handles non-object payloads and missing profiles", () => {
        expect(loadSettingsFromRaw("null").settings.locale).toBe("en");
        expect(loadSettingsFromRaw("[1,2]").settings.selectedGame).toBeNull();
        expect(
            loadSettingsFromRaw('{"profiles":42}').settings.profiles.ets2.units,
        ).toBe("metric");
    });

    it("keeps an unversioned payload valid (pre-versioning data)", () => {
        const stored = { selectedGame: "ets2", locale: "ko" };
        const { settings, migrated } = loadSettingsFromRaw(
            JSON.stringify(stored),
        );

        expect(settings.selectedGame).toBe("ets2");
        expect(settings.locale).toBe("ko");
        expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        // Unversioned data is treated as v1, so the v1 step marks it migrated.
        expect(migrated).toBe(true);
    });

    it("stamps the schema version so the next save is versioned", () => {
        const { settings } = loadSettingsFromRaw("{}");
        expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect(JSON.parse(JSON.stringify(settings)).schemaVersion).toBe(
            SETTINGS_SCHEMA_VERSION,
        );
    });

    it("fills gameplay defaults when migrating v1 data", () => {
        const stored = { schemaVersion: 1, selectedGame: "ets2" };
        const { settings, migrated } = loadSettingsFromRaw(
            JSON.stringify(stored),
        );

        expect(migrated).toBe(true);
        expect(settings.gameplay).toEqual({
            eventFeed: true,
            soundAlerts: false,
        });
    });

    it("normalizes the gameplay block per-field", () => {
        const stored = {
            gameplay: { eventFeed: false, soundAlerts: "yes", junk: 1 },
        };
        const { settings } = loadSettingsFromRaw(JSON.stringify(stored));

        expect(settings.gameplay.eventFeed).toBe(false);
        expect(settings.gameplay.soundAlerts).toBe(
            DEFAULT_SETTINGS.gameplay.soundAlerts,
        );

        expect(loadSettingsFromRaw('{"gameplay":42}').settings.gameplay).toEqual(
            DEFAULT_SETTINGS.gameplay,
        );
    });
});
