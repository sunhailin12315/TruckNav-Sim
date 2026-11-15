// ---------------------------------------------------------------
// Prompt templates and tolerant JSON parsing for the AI features.
// The transport (aiClient) never sends `response_format`, so every
// provider — including local Ollama — works the same; JSON outputs
// are enforced by instruction here and recovered tolerantly below.
// ---------------------------------------------------------------

import type { LocaleCode } from "../shared/settingsSchema";
import type { AiChatMessage } from "./aiClient";

/** Prompt-side language names, keyed by the app locale. */
const LANGUAGE_NAMES: Record<LocaleCode, string> = {
    en: "English",
    de: "German",
    nl: "Dutch",
    cs: "Czech",
    sk: "Slovak",
    ro: "Romanian",
    ko: "Korean",
    zh: "Simplified Chinese",
};

const DRIVE_REPORT_SYSTEM_PROMPT = `You are the AI co-driver of a truck-simulator navigation app. Write like a seasoned trucker coach: plain, direct, friendly — never customer-service polite. The user message holds one JSON blob describing the driving session plus lifetime stats.

Hard rules:
- Use ONLY numbers and names present in the data. Never invent places, laws, fees or causes.
- Ground claims in numbers (e.g. "3 fines" instead of "several fines").
- When lifetime stats allow it, compare trends (income per delivery, damage, fines); otherwise skip comparisons.
- No greeting, no sign-off, no markdown.

Reply with ONLY one JSON object, nothing else:
{"summary": "<2-3 sentences reviewing this session>", "tips": ["<exactly one concrete, actionable tip>"]}`;

export interface DriveReportNarration {
    summary: string;
    tips: string[];
}

/** Chat messages for the drive-report narration, output in the app locale. */
export function driveReportMessages(
    contextJson: string,
    locale: LocaleCode,
): AiChatMessage[] {
    return [
        { role: "system", content: DRIVE_REPORT_SYSTEM_PROMPT },
        {
            role: "user",
            content: `Reply in ${LANGUAGE_NAMES[locale]}. Session data:\n${contextJson}`,
        },
    ];
}

const VOICE_SCRIPT_SYSTEM_PROMPT = `You write the spoken turn instructions for a truck navigation app. The user message holds JSON: {"turns":[{"i":<turn id>,"type":"<maneuver type>","km":<cumulative route km>,"exit":<exit number>}],"totalKm":<route km>}.

Maneuver types: left, right, slight-left, slight-right, sharp-left, sharp-right, u-turn, straight, ferry, roundabout, exit-highway.

Rules:
- For every turn write ONE short spoken phrase (max 40 characters) a truck driver hears just before the turn.
- The distance to the turn is announced separately — NEVER mention distances or the km values.
- For a roundabout with an exit number, the phrase must mention taking that exit ("take the second exit").
- Use only what the input gives: no street names, no hazards, no cameras, no lanes you weren't told about.
- Casual, professional trucker tone; vary the wording across turns; no greetings, no markdown.

Reply ONLY with one JSON object, nothing else:
{"cues":[{"i":<same turn id>,"text":"<phrase>"}]} covering every input turn, written in the language requested below.`;

/** Chat messages for the per-route voice script, output in the app locale. */
export function voiceScriptMessages(
    contextJson: string,
    locale: LocaleCode,
): AiChatMessage[] {
    return [
        { role: "system", content: VOICE_SCRIPT_SYSTEM_PROMPT },
        {
            role: "user",
            content: `Reply in ${LANGUAGE_NAMES[locale]}. Route data:\n${contextJson}`,
        },
    ];
}

const ROUTE_INSIGHT_SYSTEM_PROMPT = `You are the AI co-driver of a truck-simulator navigation app. The user message holds JSON describing a freshly planned route.

Rules:
- ONE sentence (max 80 characters), spoken-style, like a dispatcher briefing the driver before departure.
- Use ONLY numbers and names from the data; never invent places, hazards or fees.
- Mention the most decision-relevant fact first (long drive, ferries, many roundabouts, tight ETA).
- No greeting, no markdown.

Reply ONLY with one JSON object, nothing else:
{"note": "<the one sentence>"}`;

const DELIVERY_NOTE_SYSTEM_PROMPT = `You are the AI co-driver of a truck-simulator navigation app. The user message holds JSON describing the delivery that just completed plus the session so far.

Rules:
- ONE sentence (max 80 characters), spoken-style, like a trucker coach reacting to the drop-off.
- Use ONLY numbers and names from the data; never invent causes or fees.
- Praise what went well, or name the single biggest cost (damage, fines) when present.
- No greeting, no markdown.

Reply ONLY with one JSON object, nothing else:
{"note": "<the one sentence>"}`;

/** Chat messages for the route-insight note, output in the app locale. */
export function routeInsightMessages(
    contextJson: string,
    locale: LocaleCode,
): AiChatMessage[] {
    return [
        { role: "system", content: ROUTE_INSIGHT_SYSTEM_PROMPT },
        {
            role: "user",
            content: `Reply in ${LANGUAGE_NAMES[locale]}. Route data:\n${contextJson}`,
        },
    ];
}

/** Chat messages for the delivery recap note, output in the app locale. */
export function deliveryNoteMessages(
    contextJson: string,
    locale: LocaleCode,
): AiChatMessage[] {
    return [
        { role: "system", content: DELIVERY_NOTE_SYSTEM_PROMPT },
        {
            role: "user",
            content: `Reply in ${LANGUAGE_NAMES[locale]}. Delivery data:\n${contextJson}`,
        },
    ];
}

export interface AiNote {
    note: string;
}

/**
 * Parses a single-`{"note": "..."}` reply, tolerating fences and prose.
 * Returns null when no usable note survives so the caller skips the toast.
 */
export function parseAiNote(text: string): AiNote | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    const note = (parsed as Record<string, unknown>).note;
    if (typeof note !== "string") return null;
    const trimmed = note.trim();
    if (!trimmed || trimmed.length > 200) return null;
    return { note: trimmed };
}

/**
 * Parses the model reply into the narration contract. Tolerates prose,
 * markdown fences and trailing remarks by grabbing the outermost JSON
 * object; anything that doesn't yield a non-empty summary is rejected so
 * the caller can fall back to the plain (non-AI) report card.
 */
export function parseDriveReportNarration(
    text: string,
): DriveReportNarration | null {
    const json = extractJson(text);
    if (!json) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as Record<string, unknown>;
    const summary =
        typeof record.summary === "string" ? record.summary.trim() : "";
    if (!summary) return null;

    const tips = Array.isArray(record.tips)
        ? record.tips
              .filter(
                  (tip): tip is string =>
                      typeof tip === "string" && tip.trim().length > 0,
              )
              .map((tip) => tip.trim())
              .slice(0, 3)
        : [];

    return { summary, tips };
}

/** Extracts the outermost JSON object, ignoring surrounding prose/fences. */
function extractJson(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return text.slice(start, end + 1);
}
