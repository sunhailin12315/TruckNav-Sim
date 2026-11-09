import {
    AUTO_VOICE,
    DEFAULT_SETTINGS,
    defaultSettings,
    loadSettingsFromRaw,
} from "~/assets/utils/shared/settingsSchema";

export { AUTO_VOICE };

export type {
    ActiveComponents,
    AppSettingsState,
    BeepStyle,
    DayNightMode,
    GameProfile,
    GameplaySettings,
    LocaleCode,
    RouteTimeMode,
    TextTheme,
    UiComponent,
    UnitSystem,
} from "~/assets/utils/shared/settingsSchema";

const STORAGE_KEY = "truck-nav-settings";

export const useSettings = () => {
    // defaultSettings() deep-copies so runtime mutations never touch the
    // shared DEFAULT_SETTINGS template.
    const settings = useState<AppSettingsState>("app-settings", () =>
        defaultSettings(),
    );

    const activeSettings = computed(() => {
        const game = settings.value.selectedGame || "ets2";
        return settings.value.profiles[game];
    });

    const applySideEffects = () => {
        // Theme + text colors are owned by useDayNight (they dim at night);
        // everything else is applied here on every save.
        document.documentElement.style.setProperty(
            "--app-font",
            activeSettings.value.fontFamily,
        );

        document.documentElement.style.setProperty(
            "--hud-btn-size",
            `${settings.value.hudBtnSize}px`,
        );

        document.documentElement.style.setProperty(
            "--compact-trip-size",
            `${settings.value.compactTripFontSize}rem`,
        );

        document.documentElement.style.setProperty(
            "--top-bar-height",
            !settings.value.activeUiComponents.includes("topBar")
                ? "0px"
                : "40px",
        );
    };

    const saveSettings = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value));
        applySideEffects();
    };

    const updateGlobal = <K extends keyof Omit<AppSettingsState, "profiles">>(
        key: K,
        value: AppSettingsState[K],
    ) => {
        settings.value[key] = value;
        saveSettings();
    };

    const updateProfile = <K extends keyof GameProfile>(
        key: K,
        value: GameProfile[K],
    ) => {
        const game = settings.value.selectedGame || "ets2";
        settings.value.profiles[game][key] = value;
        saveSettings();
    };

    const initSettings = () => {
        const savedString = localStorage.getItem(STORAGE_KEY);

        if (savedString) {
            // Parses, runs pending schema migrations and normalizes every
            // field; corrupt or stale data falls back to defaults per-field.
            const { settings: loaded } = loadSettingsFromRaw(savedString);
            settings.value = loaded;
        } else {
            settings.value = defaultSettings();
        }

        applySideEffects();
    };

    const resetGlobalSetting = <
        K extends keyof Omit<AppSettingsState, "profiles">,
    >(
        key: K,
    ) => {
        settings.value[key] = DEFAULT_SETTINGS[key];
        saveSettings();
    };

    const resetProfileSetting = <K extends keyof GameProfile>(key: K) => {
        const game = settings.value.selectedGame || "ets2";
        const defaultValue = DEFAULT_SETTINGS.profiles[game][key];

        settings.value.profiles[game][key] = defaultValue;
        saveSettings();
    };

    const resetSettings = () => {
        const game = settings.value.selectedGame || "ets2";

        const currentDest = settings.value.profiles[game].lastDestination;

        const freshProfile = JSON.parse(
            JSON.stringify(DEFAULT_SETTINGS.profiles[game]),
        );
        freshProfile.lastDestination = currentDest;

        settings.value.hudBtnSize = DEFAULT_SETTINGS.hudBtnSize;
        settings.value.truckMarkerSize = DEFAULT_SETTINGS.truckMarkerSize;
        settings.value.compactTripFontSize =
            DEFAULT_SETTINGS.compactTripFontSize;
        settings.value.routeTimeMode = DEFAULT_SETTINGS.routeTimeMode;

        settings.value.activeUiComponents = [
            ...DEFAULT_SETTINGS.activeUiComponents,
        ];

        settings.value.profiles[game] = freshProfile;

        saveSettings();
    };

    return {
        settings,
        activeSettings,
        DEFAULT_SETTINGS,
        updateGlobal,
        updateProfile,
        resetGlobalSetting,
        resetProfileSetting,
        initSettings,
        resetSettings,
    };
};
