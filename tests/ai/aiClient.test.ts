import { describe, expect, it } from "vitest";
import {
    chatCompletionsUrl,
    extractAssistantText,
    isLocalEndpoint,
    missingAiConfigFields,
} from "~/assets/utils/ai/aiClient";

describe("aiClient", () => {
    it("completes endpoints to the chat-completions path", () => {
        expect(chatCompletionsUrl("https://api.deepseek.com/v1")).toBe(
            "https://api.deepseek.com/v1/chat/completions",
        );
        expect(chatCompletionsUrl("https://api.deepseek.com/v1/")).toBe(
            "https://api.deepseek.com/v1/chat/completions",
        );
        // An endpoint already pointing at the path is taken verbatim.
        expect(
            chatCompletionsUrl("https://proxy.example.com/chat/completions"),
        ).toBe("https://proxy.example.com/chat/completions");
    });

    it("treats loopback endpoints as local (no API key needed)", () => {
        expect(isLocalEndpoint("http://localhost:11434/v1")).toBe(true);
        expect(isLocalEndpoint("http://127.0.0.1:1234/v1")).toBe(true);
        expect(isLocalEndpoint("https://api.deepseek.com/v1")).toBe(false);
        expect(isLocalEndpoint("not a url")).toBe(false);
    });

    it("flags the missing config fields, key only for remote providers", () => {
        expect(
            missingAiConfigFields({
                endpoint: "",
                apiKey: "",
                model: "",
            }),
        ).toEqual(["endpoint", "apiKey", "model"]);

        // Local runtimes authenticate by being local.
        expect(
            missingAiConfigFields({
                endpoint: "http://localhost:11434/v1",
                apiKey: "",
                model: "llama3.1:8b",
            }),
        ).toEqual([]);

        // Remote providers need the key.
        expect(
            missingAiConfigFields({
                endpoint: "https://api.deepseek.com/v1",
                apiKey: "",
                model: "deepseek-chat",
            }),
        ).toEqual(["apiKey"]);
    });

    it("extracts the first assistant message from a completion payload", () => {
        expect(
            extractAssistantText({
                choices: [{ message: { role: "assistant", content: " hi " } }],
            }),
        ).toBe(" hi ");

        expect(extractAssistantText({ choices: [] })).toBeNull();
        expect(extractAssistantText({ choices: [{ message: {} }] })).toBeNull();
        expect(
            extractAssistantText({
                choices: [{ message: { content: "  " } }],
            }),
        ).toBeNull();
        expect(extractAssistantText(null)).toBeNull();
        expect(extractAssistantText("nope")).toBeNull();
    });
});
