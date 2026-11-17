import { describe, expect, it } from "vitest";
import { createTollSession } from "~/assets/utils/routing/tollSession";

describe("createTollSession", () => {
    it("keeps discovery order and reports only the new points", () => {
        const s = createTollSession();

        expect(s.absorb([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
        expect(s.absorb([[5, 6]])).toEqual([[5, 6]]);
        expect(s.points).toEqual([[1, 2], [3, 4], [5, 6]]);
    });

    it("dedups by the 4-decimal key the old sweep used", () => {
        const s = createTollSession();
        s.absorb([[1.12344001, 2]]);

        // Both round to "1.1234" → same key, not new.
        expect(s.absorb([[1.12344999, 2]])).toEqual([]);
        expect(s.points.length).toBe(1);

        // A distinct key still gets in.
        expect(s.absorb([[1.1235, 2]])).toEqual([[1.1235, 2]]);
    });

    it("treats differently-rounded coordinates as different gates", () => {
        const s = createTollSession();
        s.absorb([[12.34561, 45.4]]);
        expect(s.absorb([[12.34569, 45.4]])).toEqual([[12.34569, 45.4]]);
    });

    it("absorbs nothing from an empty sweep without touching state", () => {
        const s = createTollSession();
        expect(s.absorb([])).toEqual([]);
        expect(s.points).toEqual([]);
    });
});
