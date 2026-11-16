import { describe, expect, it } from "vitest";
import { applyPronunciationFixes } from "~/assets/utils/guidance/pronunciation";

describe("applyPronunciationFixes", () => {
    it("rewrites zh place-name polyphones to homophones", () => {
        expect(applyPronunciationFixes("前方500米经过单县", "zh")).toBe(
            "前方500米经过善县",
        );
        expect(applyPronunciationFixes("下一出口前往蚌埠", "zh")).toBe(
            "下一出口前往蹦埠",
        );
        expect(applyPronunciationFixes("请提前调头", "zh")).toBe(
            "请提前掉头",
        );
    });

    it("applies every matching entry in one pass", () => {
        expect(applyPronunciationFixes("从六安到郓城，注意匝道", "zh")).toBe(
            "从陆安到运城，注意扎道",
        );
    });

    it("is idempotent", () => {
        const once = applyPronunciationFixes("单县服务区", "zh");
        expect(applyPronunciationFixes(once, "zh")).toBe(once);
    });

    it("leaves text without entries untouched", () => {
        expect(applyPronunciationFixes("前方500米右转", "zh")).toBe(
            "前方500米右转",
        );
    });

    it("is identity for non-zh locales", () => {
        expect(applyPronunciationFixes("turn ahead", "en")).toBe("turn ahead");
        expect(applyPronunciationFixes("单县", "de")).toBe("单县");
    });
});
