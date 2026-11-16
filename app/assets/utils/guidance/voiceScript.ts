// Pure voice-script building blocks for the AI cue style (aiVoiceStyle:
// "ai"). Each planned route gets ONE generation pass producing a natural
// spoken phrase per maneuver; the announcement loop swaps its template
// wording for the matching phrase when one exists. Trigger timing and
// distance prefixes stay rule-based — only the maneuver wording is
// AI-crafted, so a slow or failed generation degrades silently to the
// templates (docs/ai-features.md §6).

import type { DirectionStep } from "../routing/directions";

/** Turns sent in ONE generation pass; longer routes continue in batches
 * as the driver approaches the end of the covered stretch. */
export const VOICE_SCRIPT_MAX_TURNS = 30;

/** Hard cap of covered turns per route; beyond it the tail keeps the
 * template wording no matter how far the route runs. */
export const VOICE_SCRIPT_MAX_TOTAL_TURNS = 150;

/** How close to the last covered turn the driver must be before the next
 * batch is generated (route km) — early enough that phrases land before
 * the first uncovered turn's 5 km mark, late enough to not burn a request
 * the driver may never reach. */
export const VOICE_SCRIPT_CONTINUE_LEAD_KM = 10;

/** Steps the driver never hears a maneuver phrase for. */
const SKIPPED_TYPES = new Set(["depart", "destination"]);

/** Max stored phrase length; longer model replies are dropped per-cue. */
const MAX_PHRASE_LENGTH = 120;

/** One generation pass over the uncovered part of a maneuver window. */
export interface VoiceScriptBatch {
    /** Prompt context for this batch ("" when nothing was left to cover). */
    context: string;
    /** Step ids this batch asks the model to phrase. */
    coveredIds: number[];
    /** Furthest route-km the batch covers; null when it covers nothing. */
    lastCoveredKm: number | null;
    /** True when no uncovered eligible turn remained in the window. */
    exhausted: boolean;
}

/**
 * Stable identity of a maneuver list. Planning (and every reroute)
 * rebuilds the list from scratch, so a new plan always yields a new key;
 * driving progress mutates the window in place and keeps every step's
 * id/cumulativeKm, hence the same key.
 */
export function routeKeyOf(steps: DirectionStep[]): string {
    return steps
        .map((step) => `${step.id}@${step.cumulativeKm ?? -1}`)
        .join("|");
}

/** Route total in km from the window's destination step (0 when absent). */
export function routeTotalKm(steps: DirectionStep[]): number {
    const last = steps[steps.length - 1];
    return last?.cumulativeKm !== undefined
        ? Math.round(last.cumulativeKm)
        : 0;
}

/**
 * Plans one generation batch: walks the window in route order, skips the
 * steps already covered (`exclude`) and the never-spoken depart/destination
 * types, and takes up to VOICE_SCRIPT_MAX_TURNS. Reports whether the window
 * held anything left to cover so callers can mark the script complete.
 */
export function planVoiceScriptBatch(
    steps: DirectionStep[],
    exclude?: Set<number>,
): VoiceScriptBatch {
    const turns: Array<{
        i: number;
        type: string;
        km?: number;
        exit?: number;
    }> = [];
    const coveredIds: number[] = [];
    let lastCoveredKm: number | null = null;
    let remaining = false;

    for (const step of steps) {
        if (SKIPPED_TYPES.has(step.type)) continue;
        if (exclude?.has(step.id)) continue;

        if (turns.length >= VOICE_SCRIPT_MAX_TURNS) {
            // Still uncovered turns behind the cap: the script continues
            // when the driver approaches the covered stretch.
            remaining = true;
            break;
        }

        turns.push({
            i: step.id,
            type: step.type,
            ...(step.cumulativeKm !== undefined
                ? { km: Math.round(step.cumulativeKm * 10) / 10 }
                : {}),
            ...(step.exitCount ? { exit: step.exitCount } : {}),
        });
        coveredIds.push(step.id);
        if (step.cumulativeKm !== undefined) {
            lastCoveredKm =
                lastCoveredKm === null
                    ? step.cumulativeKm
                    : Math.max(lastCoveredKm, step.cumulativeKm);
        }
    }

    return {
        context: JSON.stringify({ turns, totalKm: routeTotalKm(steps) }),
        coveredIds,
        lastCoveredKm,
        exhausted: !remaining,
    };
}

/**
 * Compact generation context for the planned route: the upcoming maneuvers
 * (already capped, minus `exclude`d ids) plus the total distance. No
 * coordinates, no street names — the model paraphrases maneuver types and
 * must not invent places.
 */
export function buildVoiceScriptContext(
    steps: DirectionStep[],
    exclude?: Set<number>,
): string {
    return planVoiceScriptBatch(steps, exclude).context;
}

/**
 * Parses the model reply into a step-id → phrase map. Tolerates prose and
 * markdown fences; individual cues with a bad id or an overlong/empty text
 * are dropped (their step just keeps the template wording), while a reply
 * without any usable cue yields null so the caller knows the script
 * generation failed outright.
 */
export function parseVoiceScript(text: string): Map<number, string> | null {
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

    const cues = (parsed as { cues?: unknown }).cues;
    if (!Array.isArray(cues)) return null;

    const phrases = new Map<number, string>();
    for (const cue of cues) {
        if (!cue || typeof cue !== "object") continue;
        const { i, text: phrase } = cue as { i?: unknown; text?: unknown };
        if (typeof i !== "number" || !Number.isInteger(i)) continue;
        if (typeof phrase !== "string") continue;
        const trimmed = phrase.trim();
        if (trimmed.length === 0 || trimmed.length > MAX_PHRASE_LENGTH) {
            continue;
        }
        phrases.set(i, trimmed);
    }

    return phrases.size > 0 ? phrases : null;
}
