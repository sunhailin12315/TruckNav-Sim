import { describe, expect, it } from "vitest";
import { MinHeap } from "~/assets/utils/routing/MinHeap";

describe("MinHeap", () => {
    it("pops ids in ascending cost order", () => {
        const heap = new MinHeap(16);
        const costs = [50, 10, 40, 30, 20, 60, 5];

        costs.forEach((cost, id) => heap.push(id, cost));

        const popped: { id: number; cost: number }[] = [];
        while (heap.size() > 0) {
            const id = heap.pop()!;
            popped.push({ id, cost: costs[id]! });
        }

        expect(popped.map((p) => p.cost)).toEqual([...costs].sort((a, b) => a - b));
    });

    it("grows beyond its initial capacity", () => {
        const heap = new MinHeap(8);
        const total = 60000;

        for (let i = 0; i < total; i++) {
            heap.push(i, ((i * 7919) % total) + 1);
        }
        expect(heap.size()).toBe(total);

        let previousCost = 0;
        let count = 0;
        while (heap.size() > 0) {
            const id = heap.pop()!;
            const cost = ((id * 7919) % total) + 1;
            expect(cost).toBeGreaterThanOrEqual(previousCost);
            previousCost = cost;
            count++;
        }
        expect(count).toBe(total);
    });

    it("returns undefined when empty and resets on clear", () => {
        const heap = new MinHeap(4);

        expect(heap.pop()).toBeUndefined();
        expect(heap.size()).toBe(0);

        heap.push(1, 10);
        expect(heap.size()).toBe(1);

        heap.clear();
        expect(heap.size()).toBe(0);
        expect(heap.pop()).toBeUndefined();
    });
});
