require("./rt/electron-rt");
import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "./settingsConstants";
import type { DiscordRpcPayload } from "./discordRpc";

contextBridge.exposeInMainWorld("electronAPI", {
    onServerIp: (callback: (ip: string) => void) =>
        ipcRenderer.on("server-ip", (_event, value) => callback(value)),

    getLocalIP: () => ipcRenderer.invoke("get-local-ip"),
    getLocalPort: () => ipcRenderer.invoke("get-local-port"),
    openExternal: (url: string) => ipcRenderer.send("open-external", url),
    selectGameFolder: (gameName: string) =>
        ipcRenderer.invoke("select-game-folder", gameName),
    checkPluginStatuses: () => ipcRenderer.invoke("check-plugin-statuses"),

    setWindowSize: (
        width: number,
        height: number,
        resizable: boolean,
        maximize: boolean,
        fullscreen?: boolean,
    ) =>
        ipcRenderer.send("set-window-size", {
            width,
            height,
            resizable,
            maximize,
            fullscreen,
        }),

    manualStartServer: () => ipcRenderer.send("manual-start-server"),

    updateDiscordRpc: (payload: DiscordRpcPayload) =>
        ipcRenderer.send("update-discord-rpc", payload),
    clearDiscordRpc: () => ipcRenderer.send("clear-discord-rpc"),

    getSettings: () => ipcRenderer.invoke("get-settings"),
    updateSetting: (key: keyof AppSettings, value: any) =>
        ipcRenderer.invoke("update-setting", key, value),

    // MAP DOWNLOADABLE CONTENT
    checkMap: (mapId: string) => ipcRenderer.invoke("check-map", mapId),

    uninstallMap: (mapId: string) => ipcRenderer.invoke("uninstall-map", mapId),

    downloadMap: (mapId: string, url: string) =>
        ipcRenderer.invoke("download-map", { mapId, url }),

    onMapProgress: (callback: (percent: number) => void) => {
        ipcRenderer.on("map-download-progress", (_event, percent) =>
            callback(percent),
        );
    },

    getDownloadedMaps: () => ipcRenderer.invoke("get-downloaded-maps"),

    // MAP SCANNING (local game install -> TruckNav map data)
    scanStart: (game: "ets2" | "ats") => ipcRenderer.invoke("scan:start", game),
    scanStatus: () => ipcRenderer.invoke("scan:status"),
    scanCancel: () => ipcRenderer.invoke("scan:cancel"),
    scanGameDir: (game: "ets2" | "ats") =>
        ipcRenderer.invoke("scan:gamemapdir", game),
    onScanProgress: (callback: (state: unknown) => void) => {
        const handler = (_event: unknown, state: unknown) => callback(state);
        ipcRenderer.on("scan:progress", handler);
        return () => ipcRenderer.removeListener("scan:progress", handler);
    },

    // OFFLINE NEURAL TTS
    ttsStatus: () => ipcRenderer.invoke("tts:status"),
    ttsSynthesize: (text: string, locale: string) =>
        ipcRenderer.invoke("tts:synthesize", text, locale),
});
