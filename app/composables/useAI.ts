// AI feature state: one singleton per renderer, owning the request config
// derived from settings, the narration/insight caches, the per-route voice
// script and in-flight request bookkeeping. Everything degrades silently
// when AI is off, unconfigured or a request fails — the AI layer is an
// enhancement, never a dependency (docs/ai-features.md §1).

import { aiChat, missingAiConfigFields } from "~/assets/utils/ai/aiClient";
import type { AiUsage } from "~/assets/utils/ai/aiClient";
import {
    buildDriveReportContext,
    buildRouteInsightContext,
    buildDeliveryNoteContext,
} from "~/assets/utils/ai/contextBuilder";
import type { DeliveryNoteInput } from "~/assets/utils/ai/contextBuilder";
import {
    driveReportMessages,
    parseDriveReportNarration,
    voiceScriptMessages,
    routeInsightMessages,
    deliveryNoteMessages,
    parseAiNote,
} from "~/assets/utils/ai/prompts";
import type { DriveReportNarration } from "~/assets/utils/ai/prompts";
import {
    buildVoiceScriptContext,
    parseVoiceScript,
    routeKeyOf,
    routeTotalKm,
} from "~/assets/utils/guidance/voiceScript";
import type { DirectionStep } from "~/assets/utils/routing/directions";
import {
    computeDriveReport,
    computeTripStats,
} from "~/assets/utils/gameplay/stats";

export type AiNarrationStatus = "idle" | "loading" | "ready" | "failed";

const driveReportAiState = reactive<{
    status: AiNarrationStatus;
    narration: DriveReportNarration | null;
    /** Trip-id anchor the narration was generated for. */
    anchor: number;
    /** Locale the narration was generated for (regenerate on switch). */
    locale: string;
}>({
    status: "idle",
    narration: null,
    anchor: -1,
    locale: "",
});

let driveReportController: AbortController | null = null;

// Session-wide failure cooldown: after a request fails (network down, bad
// key…), every auto-triggered feature goes quiet for a while instead of
// burning through timeouts on every card open. The settings-page test
// button bypasses this — it is an explicit user action.
const AI_FAILURE_COOLDOWN_MS = 5 * 60_000;
let lastAiFailureAt = 0;

function noteAiFailure(): void {
    lastAiFailureAt = Date.now();
}

function aiInCooldown(): boolean {
    return Date.now() - lastAiFailureAt < AI_FAILURE_COOLDOWN_MS;
}

// ===== Session token usage =====
// Cumulative prompt+completion tokens over this app session, shown in the
// AI settings view so the cost stays visible. Not persisted — a session
// figure only.
export const aiUsageTokens = ref(0);

function noteUsage(usage: AiUsage | undefined): void {
    if (!usage) return;
    aiUsageTokens.value += usage.promptTokens + usage.completionTokens;
}

// ===== Voice-script cache (localStorage; replaying a known route is free) =====

const SCRIPT_CACHE_KEY = "truck-nav-ai-voice-scripts";
const SCRIPT_CACHE_MAX = 8;

interface StoredVoiceScript {
    routeKey: string;
    locale: string;
    cues: Array<[number, string]>;
}

// LRU-ordered by insertion; loaded once per page load.
const scriptCache = new Map<string, StoredVoiceScript>();
let scriptCacheLoaded = false;

function loadScriptCache(): void {
    if (scriptCacheLoaded || typeof localStorage === "undefined") return;
    scriptCacheLoaded = true;

    try {
        const raw = localStorage.getItem(SCRIPT_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
            version?: unknown;
            entries?: unknown;
        };
        if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;

        for (const entry of parsed.entries) {
            if (!entry || typeof entry !== "object") continue;
            const { routeKey, locale, cues } = entry as Partial<StoredVoiceScript>;
            if (
                typeof routeKey !== "string" ||
                typeof locale !== "string" ||
                !Array.isArray(cues)
            ) {
                continue;
            }
            const pairs: Array<[number, string]> = [];
            for (const cue of cues) {
                if (!Array.isArray(cue) || cue.length !== 2) continue;
                const [id, text] = cue;
                if (typeof id === "number" && typeof text === "string" && text) {
                    pairs.push([id, text]);
                }
            }
            if (pairs.length > 0) {
                scriptCache.set(routeKey, { routeKey, locale, cues: pairs });
            }
        }
    } catch {
        // Corrupt cache — start fresh, generation will repopulate it.
    }
}

function persistScriptCache(): void {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(
            SCRIPT_CACHE_KEY,
            JSON.stringify({ version: 1, entries: [...scriptCache.values()] }),
        );
    } catch {
        // Quota/serialization errors are non-fatal: the memory map still works.
    }
}

function rememberScript(
    routeKey: string,
    locale: string,
    cues: Map<number, string>,
): void {
    scriptCache.delete(routeKey); // refresh the LRU position
    scriptCache.set(routeKey, { routeKey, locale, cues: [...cues] });
    while (scriptCache.size > SCRIPT_CACHE_MAX) {
        const oldest = scriptCache.keys().next().value;
        if (oldest === undefined) break;
        scriptCache.delete(oldest);
    }
    persistScriptCache();
}

// ===== One-shot AI notes =====

const routeInsightState = reactive<{
    status: AiNarrationStatus;
    note: string;
    /** Plan identity the note was generated for. */
    routeKey: string;
    locale: string;
}>({ status: "idle", note: "", routeKey: "", locale: "" });

const deliveryNoteState = reactive<{
    status: AiNarrationStatus;
    note: string;
}>({ status: "idle", note: "" });

let routeInsightController: AbortController | null = null;
let deliveryNoteController: AbortController | null = null;

export function useAI() {
    const { settings } = useSettings();
    const { trips, sessionStart } = useTripLog();
    const { events } = useEventFeed();

    const aiConfig = computed(() => ({
        endpoint: settings.value.ai.aiEndpoint,
        apiKey: settings.value.ai.aiApiKey,
        model: settings.value.ai.aiModel,
    }));

    /** True when AI may run at all: master switch on and config complete. */
    const aiReady = computed(
        () =>
            settings.value.ai.aiEnabled &&
            missingAiConfigFields(aiConfig.value).length === 0,
    );

    const driveReportAiEnabled = computed(
        () => aiReady.value && settings.value.ai.aiDriveReport,
    );

    /** One-shot notes (route insight, delivery recap). */
    const aiInsightsEnabled = computed(
        () => aiReady.value && settings.value.ai.aiInsights,
    );

    /**
     * Ensures a narration exists for the current session anchor and
     * locale. A newly completed trip or a language switch regenerates;
     * an unchanged anchor is served from the cache. Never throws — the
     * status reflects the outcome so the card can fall back to its plain
     * layout silently.
     */
    async function ensureDriveReportNarration(): Promise<void> {
        if (!driveReportAiEnabled.value || aiInCooldown()) return;

        const anchor = sessionStart.maxTripId;
        const locale = settings.value.locale;
        if (
            driveReportAiState.anchor === anchor &&
            driveReportAiState.locale === locale &&
            (driveReportAiState.status === "ready" ||
                driveReportAiState.status === "loading")
        ) {
            return;
        }

        driveReportController?.abort();
        driveReportController = new AbortController();
        const controller = driveReportController;

        driveReportAiState.anchor = anchor;
        driveReportAiState.locale = locale;
        driveReportAiState.status = "loading";
        driveReportAiState.narration = null;

        const report = computeDriveReport(trips.value, anchor);
        const sessionTrips = trips.value.filter((trip) => trip.id > anchor);
        const lifetime = computeTripStats(trips.value);

        // Recent feed fine labels; the context builder drops them when the
        // feed knows about more fines than this session counted (labels
        // from older sessions would leak).
        const fineLabels = events.value
            .filter((event) => event.kind === "fine")
            .map((event) => event.label);

        const result = await aiChat(aiConfig.value, {
            messages: driveReportMessages(
                buildDriveReportContext(
                    report,
                    sessionTrips,
                    lifetime,
                    fineLabels,
                ),
                locale,
            ),
            temperature: 0.6,
            signal: controller.signal,
        });

        // A superseded run must not overwrite the current narration.
        if (controller.signal.aborted) return;

        noteUsage(result.ok ? result.usage : undefined);

        if (!result.ok) {
            noteAiFailure();
            driveReportAiState.status = "failed";
            driveReportAiState.narration = null;
            return;
        }

        const narration = parseDriveReportNarration(result.text);
        if (!narration) {
            noteAiFailure();
            driveReportAiState.status = "failed";
            return;
        }

        lastAiFailureAt = 0;
        driveReportAiState.status = "ready";
        driveReportAiState.narration = narration;
    }

    /** Aborts any in-flight narration (card closed or AI turned off). */
    function cancelDriveReportNarration(): void {
        driveReportController?.abort();
        driveReportController = null;
        if (driveReportAiState.status === "loading") {
            driveReportAiState.status = "idle";
            driveReportAiState.narration = null;
        }
    }

    // ===== Route insight: one sentence right after planning =====

    /**
     * Generates the departure briefing for a freshly planned route. One
     * note per plan identity + locale; reroutes regenerate, aborting the
     * previous request. Never throws — a failure just skips the toast.
     */
    async function ensureRouteInsight(
        steps: DirectionStep[],
        etaMinutes: number | null,
        destination: string,
    ): Promise<void> {
        if (!aiInsightsEnabled.value || aiInCooldown() || steps.length === 0) {
            return;
        }

        const routeKey = routeKeyOf(steps);
        const locale = settings.value.locale;
        if (
            routeInsightState.routeKey === routeKey &&
            routeInsightState.locale === locale &&
            (routeInsightState.status === "ready" ||
                routeInsightState.status === "loading")
        ) {
            return;
        }

        routeInsightController?.abort();
        routeInsightController = new AbortController();
        const controller = routeInsightController;

        routeInsightState.routeKey = routeKey;
        routeInsightState.locale = locale;
        routeInsightState.status = "loading";
        routeInsightState.note = "";

        const result = await aiChat(aiConfig.value, {
            messages: routeInsightMessages(
                buildRouteInsightContext(
                    steps,
                    routeTotalKm(steps),
                    etaMinutes,
                    destination,
                ),
                locale,
            ),
            temperature: 0.6,
            signal: controller.signal,
        });

        // A superseded run (reroute) must not overwrite the current note.
        if (controller.signal.aborted) return;

        noteUsage(result.ok ? result.usage : undefined);

        if (!result.ok) {
            noteAiFailure();
            routeInsightState.status = "failed";
            return;
        }

        const note = parseAiNote(result.text);
        if (!note) {
            noteAiFailure();
            routeInsightState.status = "failed";
            return;
        }

        lastAiFailureAt = 0;
        routeInsightState.note = note.note;
        routeInsightState.status = "ready";
    }

    /** Aborts any in-flight insight (route cleared or insights turned off). */
    function cancelRouteInsight(): void {
        routeInsightController?.abort();
        routeInsightController = null;
        if (routeInsightState.status === "loading") {
            routeInsightState.status = "idle";
            routeInsightState.note = "";
        }
    }

    /**
     * Generates the one-sentence recap for a delivery that just happened.
     * Every delivery is a new event, so there is no dedupe — a new call
     * supersedes the previous note. Callers run this after the trip has
     * been committed to the log so the session aggregates include it.
     * Never throws.
     */
    async function ensureDeliveryNote(delivery: DeliveryNoteInput): Promise<void> {
        if (!aiInsightsEnabled.value || aiInCooldown()) return;

        deliveryNoteController?.abort();
        deliveryNoteController = new AbortController();
        const controller = deliveryNoteController;

        deliveryNoteState.status = "loading";
        deliveryNoteState.note = "";

        const sessionReport = computeDriveReport(
            trips.value,
            sessionStart.maxTripId,
        );

        const result = await aiChat(aiConfig.value, {
            messages: deliveryNoteMessages(
                buildDeliveryNoteContext(delivery, {
                    deliveredCount: sessionReport.deliveredCount,
                    netIncome: sessionReport.netIncome,
                    finesCount: sessionReport.finesCount,
                }),
                settings.value.locale,
            ),
            temperature: 0.6,
            signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        noteUsage(result.ok ? result.usage : undefined);

        if (!result.ok) {
            noteAiFailure();
            deliveryNoteState.status = "failed";
            return;
        }

        const note = parseAiNote(result.text);
        if (!note) {
            noteAiFailure();
            deliveryNoteState.status = "failed";
            return;
        }

        lastAiFailureAt = 0;
        deliveryNoteState.note = note.note;
        deliveryNoteState.status = "ready";
    }

    // ===== Voice script (aiVoiceStyle "ai") =====
    // One phrase map per planned route, keyed by DirectionStep.id. Not
    // reactive on purpose: the announcement loop reads it at trigger time,
    // so changes flow through the existing distance watchers.

    const voiceScriptState = {
        routeKey: "",
        /** Locale the phrases were generated for (reroute on switch). */
        locale: "",
        cues: new Map<number, string>(),
    };
    let voiceScriptStatus: "idle" | "loading" | "ready" | "failed" = "idle";
    let voiceScriptController: AbortController | null = null;

    /** True when spoken cues should come from the AI script. */
    const aiVoiceStyleEnabled = computed(
        () =>
            aiReady.value &&
            settings.value.ai.aiVoiceStyle === "ai" &&
            settings.value.gameplay.voiceNavigation,
    );

    /**
     * Ensures a phrase map exists for the given maneuver list. The cache
     * key is route identity + locale: a reroute or language switch
     * regenerates, steady driving serves the same map, and a route seen
     * before is restored from the localStorage cache without a request.
     * Never throws — a failure just leaves the templates in place.
     */
    async function ensureVoiceScript(steps: DirectionStep[]): Promise<void> {
        if (!aiVoiceStyleEnabled.value || steps.length === 0) return;

        const routeKey = routeKeyOf(steps);
        const locale = settings.value.locale;
        if (
            voiceScriptState.routeKey === routeKey &&
            voiceScriptState.locale === locale &&
            (voiceScriptStatus === "ready" || voiceScriptStatus === "loading")
        ) {
            return;
        }

        loadScriptCache();
        const cached = scriptCache.get(routeKey);
        if (cached && cached.locale === locale && cached.cues.length > 0) {
            // Adopt the stored phrases for this exact route, free.
            scriptCache.delete(routeKey);
            scriptCache.set(routeKey, cached); // refresh LRU position
            voiceScriptState.routeKey = routeKey;
            voiceScriptState.locale = locale;
            voiceScriptState.cues = new Map(cached.cues);
            voiceScriptStatus = "ready";
            return;
        }

        voiceScriptController?.abort();
        voiceScriptController = new AbortController();
        const controller = voiceScriptController;

        voiceScriptState.routeKey = routeKey;
        voiceScriptState.locale = locale;
        voiceScriptState.cues = new Map();
        voiceScriptStatus = "loading";

        const result = await aiChat(aiConfig.value, {
            messages: voiceScriptMessages(
                buildVoiceScriptContext(steps),
                locale,
            ),
            temperature: 0.7,
            signal: controller.signal,
        });

        // A superseded run (reroute) must not overwrite the current map.
        if (controller.signal.aborted) return;

        noteUsage(result.ok ? result.usage : undefined);

        const cues = result.ok ? parseVoiceScript(result.text) : null;
        if (!cues) {
            noteAiFailure();
            voiceScriptStatus = "failed";
            return;
        }

        lastAiFailureAt = 0;
        voiceScriptState.cues = cues;
        voiceScriptStatus = "ready";
        rememberScript(routeKey, locale, cues);
    }

    /** Aborts any in-flight script (route cleared or style switched off). */
    function cancelVoiceScript(): void {
        voiceScriptController?.abort();
        voiceScriptController = null;
        if (voiceScriptStatus === "loading") {
            voiceScriptStatus = "idle";
            voiceScriptState.cues = new Map();
        }
    }

    /**
     * The AI phrase for a maneuver step, or null when the script is off,
     * stale (route/locale changed) or doesn't cover the step — callers
     * fall back to the template wording in that case. The route key is
     * the planning-time snapshot held by the state, not recomputed from
     * the live window: the directions array mutates in place as driving
     * progresses, so a window-derived key would drift away mid-route.
     */
    function voiceScriptPhraseFor(step: DirectionStep): string | null {
        return voiceScriptState.cues.get(step.id) ?? null;
    }

    return {
        aiReady,
        driveReportAiEnabled,
        driveReportAiState,
        ensureDriveReportNarration,
        cancelDriveReportNarration,
        aiInsightsEnabled,
        routeInsightState,
        ensureRouteInsight,
        cancelRouteInsight,
        deliveryNoteState,
        ensureDeliveryNote,
        aiVoiceStyleEnabled,
        ensureVoiceScript,
        cancelVoiceScript,
        voiceScriptPhraseFor,
    };
}
