import { describe, expect, it } from "vitest";
import {
    driveReportMessages,
    parseDriveReportNarration,
} from "~/assets/utils/ai/prompts";

describe("driveReportMessages", () => {
    it("pins the reply language to the app locale", () => {
        const [system, user] = driveReportMessages("{}", "zh");

        expect(system.role).toBe("system");
        expect(system.content).toContain("JSON");
        expect(user.content).toContain("Simplified Chinese");
        expect(user.content).toContain("{}");
    });
});

describe("parseDriveReportNarration", () => {
    it("parses a plain JSON reply", () => {
        expect(
            parseDriveReportNarration(
                '{"summary":"Solid run.","tips":["Enable the speed alert."]}',
            ),
        ).toEqual({
            summary: "Solid run.",
            tips: ["Enable the speed alert."],
        });
    });

    it("recovers from markdown fences and surrounding prose", () => {
        const fenced = '```json\n{"summary":"Good trip.","tips":[]}\n```';
        expect(parseDriveReportNarration(fenced)?.summary).toBe("Good trip.");

        const chatty =
            'Here you go: {"summary":"Careful driving.","tips":["Rest soon."]} Hope it helps!';
        expect(parseDriveReportNarration(chatty)?.tips).toEqual(["Rest soon."]);
    });

    it("rejects replies without a usable summary", () => {
        expect(parseDriveReportNarration("no json here")).toBeNull();
        expect(parseDriveReportNarration('{"tips":["only tips"]}')).toBeNull();
        expect(parseDriveReportNarration('{"summary":"   "}')).toBeNull();
        expect(parseDriveReportNarration("{broken")).toBeNull();
        expect(parseDriveReportNarration("")).toBeNull();
    });

    it("keeps only string tips and caps the list", () => {
        const parsed = parseDriveReportNarration(
            JSON.stringify({
                summary: "Ok.",
                tips: ["A", 42, "B", null, "C", "D"],
            }),
        );

        expect(parsed?.tips).toEqual(["A", "B", "C"]);
    });
});
