// ---------------------------------------------------------------
// OpenAI-compatible chat-completions transport. DeepSeek, Qwen
// (DashScope compatible-mode), GLM, OpenAI and local runtimes such
// as Ollama / LM Studio all speak the same protocol, so the app only
// needs endpoint + key + model. Pure fetch, result-based errors, no
// business parsing here: callers own prompts, JSON tolerance and the
// offline fallback — AI is an enhancement layer, never a dependency
// (docs/ai-features.md §1). No `response_format` is sent so every
// provider works; JSON outputs are enforced by prompt and parsed
// tolerantly in prompts.ts.
// ---------------------------------------------------------------

export interface AiClientConfig {
    /** OpenAI-compatible base URL, e.g. "https://api.deepseek.com/v1". */
    endpoint: string;
    /** May stay empty for local runtimes (Ollama needs no key). */
    apiKey: string;
    /** Provider model id, e.g. "deepseek-chat" or "llama3.1:8b". */
    model: string;
}

export interface AiChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface AiChatOptions {
    messages: AiChatMessage[];
    /** Low values keep narration deterministic. */
    temperature?: number;
    /** Caps the completion; used by the one-token connection probe. */
    maxTokens?: number;
    /** Hard deadline per attempt, in milliseconds. */
    timeoutMs?: number;
    /** Caller cancellation (closing a card, rerouting…). */
    signal?: AbortSignal;
}

export type AiFailure =
    | { kind: "invalid-config"; message: string }
    | { kind: "network"; message: string }
    | { kind: "http"; status: number; message: string }
    | { kind: "aborted" }
    | { kind: "bad-response"; message: string };

/** Token usage as reported by the provider, when present. */
export interface AiUsage {
    promptTokens: number;
    completionTokens: number;
}

export type AiResult =
    | { ok: true; text: string; usage?: AiUsage }
    | { ok: false; failure: AiFailure };

/** Per-attempt deadline; narration is latency-tolerant, keep it generous. */
export const AI_REQUEST_TIMEOUT_MS = 15_000;
/** One silent retry for transient failures; auth/config errors don't retry. */
export const AI_MAX_ATTEMPTS = 2;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Completes a base URL to the chat-completions path, so "…/v1" and "…/v1/"
 * agree; an endpoint already pointing at the path is taken verbatim.
 */
export function chatCompletionsUrl(endpoint: string): string {
    const trimmed = endpoint.trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) return trimmed;
    return `${trimmed}/chat/completions`;
}

/** True when the endpoint points at a local runtime (no API key needed). */
export function isLocalEndpoint(endpoint: string): boolean {
    try {
        const host = new URL(endpoint.trim()).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
        return false;
    }
}

/**
 * Fields still missing for a usable request. The API key is only required
 * for remote providers; local runtimes authenticate by being local.
 */
export function missingAiConfigFields(
    config: AiClientConfig,
): Array<"endpoint" | "apiKey" | "model"> {
    const missing: Array<"endpoint" | "apiKey" | "model"> = [];
    if (!/^https?:\/\/.+/i.test(config.endpoint.trim())) missing.push("endpoint");
    if (!config.apiKey.trim() && !isLocalEndpoint(config.endpoint))
        missing.push("apiKey");
    if (!config.model.trim()) missing.push("model");
    return missing;
}

/**
 * Sends one chat-completion request and returns the assistant text. Up to
 * AI_MAX_ATTEMPTS attempts on transient failures; every dead end returns a
 * typed failure instead of throwing so callers can fall back in one branch.
 */
export async function aiChat(
    config: AiClientConfig,
    options: AiChatOptions,
): Promise<AiResult> {
    const missing = missingAiConfigFields(config);
    if (missing.length > 0) {
        return {
            ok: false,
            failure: {
                kind: "invalid-config",
                message: missing.join(", "),
            },
        };
    }

    const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
    const body = JSON.stringify({
        model: config.model.trim(),
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        stream: false,
        ...(options.maxTokens !== undefined
            ? { max_tokens: options.maxTokens }
            : {}),
    });

    let lastFailure: AiFailure | null = null;

    for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt++) {
        if (options.signal?.aborted) {
            return { ok: false, failure: { kind: "aborted" } };
        }

        // The caller signal and the per-attempt deadline share one controller.
        const controller = new AbortController();
        let timedOut = false;
        const onCallerAbort = () => controller.abort();
        options.signal?.addEventListener("abort", onCallerAbort, { once: true });
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            const key = config.apiKey.trim();
            // Local runtimes reject unknown auth headers less gracefully
            // than they ignore them; only send the header when set.
            if (key) headers.Authorization = `Bearer ${key}`;

            const response = await fetch(chatCompletionsUrl(config.endpoint), {
                method: "POST",
                headers,
                body,
                signal: controller.signal,
            });

            if (!response.ok) {
                const failure: AiFailure = {
                    kind: "http",
                    status: response.status,
                    message: await safeErrorDetail(response),
                };
                lastFailure = failure;
                if (!RETRYABLE_STATUSES.has(response.status)) {
                    return { ok: false, failure };
                }
                continue;
            }

            const payload: unknown = await response.json().catch(() => null);
            const text = extractAssistantText(payload);
            if (text === null) {
                // A malformed 200 won't fix itself on retry; report what the
                // provider actually said so misconfigured models are obvious.
                return {
                    ok: false,
                    failure: {
                        kind: "bad-response",
                        message: `no assistant text (${describePayload(payload)})`,
                    },
                };
            }
            const usage = extractUsage(payload);
            return usage ? { ok: true, text, usage } : { ok: true, text };
        } catch (error) {
            if (options.signal?.aborted) {
                return { ok: false, failure: { kind: "aborted" } };
            }
            // Timeout and network errors are equally transient: record and
            // let the attempt loop decide.
            const message =
                error instanceof Error ? error.message : String(error);
            lastFailure = { kind: "network", message };
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onCallerAbort);
        }
    }

    return {
        ok: false,
        failure: lastFailure ?? { kind: "network", message: "request failed" },
    };
}

/**
 * Settings-page probe: a minimal request that validates endpoint, key and
 * model together, through the same failure taxonomy as aiChat. No max_tokens
 * cap — reasoning models would burn a tiny cap on thinking alone and return
 * empty content, which reads exactly like a broken endpoint.
 */
export function testAiConnection(config: AiClientConfig): Promise<AiResult> {
    return aiChat(config, {
        messages: [
            {
                role: "user",
                content: "Reply with the single word: pong",
            },
        ],
        temperature: 0,
        timeoutMs: 30_000,
    });
}

/**
 * Pulls the first assistant message text out of a chat-completions payload.
 * Tolerates the shapes real providers emit: content as a typed-parts array,
 * and reasoning models that return empty content with the visible answer in
 * reasoning_content (proof enough that the endpoint speaks). Returns null
 * when the payload has nothing usable — the caller reports a diagnostic.
 */
export function extractAssistantText(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0];
    if (!first || typeof first !== "object") return null;
    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== "object") return null;
    const content = (message as { content?: unknown }).content;

    if (typeof content === "string" && content.trim().length > 0) {
        return content;
    }

    // Multimodal-style parts: [{ type: "text", text: "..." }, ...]
    if (Array.isArray(content)) {
        const joined = content
            .map((part) =>
                part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
                    ? (part as { text: string }).text
                    : "",
            )
            .join("")
            .trim();
        if (joined.length > 0) return joined;
    }

    // Reasoning models: the answer may land in reasoning_content/reasoning.
    const reasoning = (message as { reasoning_content?: unknown; reasoning?: unknown })
        .reasoning_content ?? (message as { reasoning?: unknown }).reasoning;
    if (typeof reasoning === "string" && reasoning.trim().length > 0) {
        return reasoning;
    }

    return null;
}

/** Short digest of an unusable response, for actionable failure messages. */
function describePayload(payload: unknown): string {
    if (payload === null || payload === undefined) return "响应不是 JSON";
    if (typeof payload !== "object") return String(payload).slice(0, 150);
    const keys = Object.keys(payload as Record<string, unknown>);
    if (keys.length === 0) return "空对象响应";
    const preview = JSON.stringify(payload);
    return `keys=[${keys.join(",")}] ${preview.slice(0, 150)}`;
}

/** Reads the OpenAI-style usage block; absent fields mean no usage data. */
export function extractUsage(payload: unknown): AiUsage | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const usage = (payload as { usage?: unknown }).usage;
    if (!usage || typeof usage !== "object") return undefined;
    const { prompt_tokens, completion_tokens } = usage as {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
    };
    if (typeof prompt_tokens !== "number" || typeof completion_tokens !== "number") {
        return undefined;
    }
    return { promptTokens: prompt_tokens, completionTokens: completion_tokens };
}

/** Best-effort human-readable detail from an error response body. */
async function safeErrorDetail(response: Response): Promise<string> {
    try {
        const text = await response.text();
        if (!text) return `HTTP ${response.status}`;
        try {
            const json = JSON.parse(text) as {
                error?: { message?: unknown };
                message?: unknown;
            };
            const message = json.error?.message ?? json.message;
            if (typeof message === "string" && message.length > 0) {
                return message.slice(0, 200);
            }
        } catch {
            // Not JSON — keep the raw body snippet below.
        }
        return text.slice(0, 200);
    } catch {
        return `HTTP ${response.status}`;
    }
}
