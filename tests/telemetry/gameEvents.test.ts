import { describe, expect, it } from "vitest";
import { extractGameEvent } from "~/assets/utils/telemetry/helpers";
import type { TelemetryPacket } from "~/types";

function packetWithEvents(
    gamePlayEvents: Partial<TelemetryPacket["gamePlayEvents"]>,
    specialEvents?: Partial<TelemetryPacket["specialEvents"]>,
): TelemetryPacket {
    return {
        gamePlayEvents: {
            ferryData: { payAmount: 0, sourceName: "", targetName: "" },
            finedData: { payAmount: 0, offence: "" },
            jobCancelledPenalty: 0,
            jobDelivered: {
                autoLoaded: false,
                autoParker: false,
                cargoDamage: 0,
                deliveryTime: "",
                distanceKm: 0,
                earnedXp: 0,
                revenue: 0,
            },
            tollgatePayment: 0,
            trainData: { payAmount: 0, sourceName: "", targetName: "" },
            ...gamePlayEvents,
        },
        specialEvents: {
            onJob: false,
            jobCancelled: false,
            jobDelivered: false,
            fined: false,
            tollgate: false,
            ferry: false,
            train: false,
            ...specialEvents,
        },
    } as TelemetryPacket;
}

describe("extractGameEvent", () => {
    it("extracts a fine with its offence label", () => {
        const item = extractGameEvent(
            packetWithEvents({
                finedData: { payAmount: 250, offence: "Speeding" },
            }),
            "fine",
        );

        expect(item).toEqual({
            kind: "fine",
            amount: 250,
            label: "Speeding",
        });
    });

    it("extracts a toll gate payment without a label", () => {
        const item = extractGameEvent(
            packetWithEvents({ tollgatePayment: 120 }),
            "toll",
        );

        expect(item).toEqual({ kind: "toll", amount: 120, label: "" });
    });

    it("joins ferry source and target into a route label", () => {
        const item = extractGameEvent(
            packetWithEvents({
                ferryData: {
                    payAmount: 95,
                    sourceName: "Dover",
                    targetName: "Calais",
                },
            }),
            "ferry",
        );

        expect(item).toEqual({
            kind: "ferry",
            amount: 95,
            label: "Dover → Calais",
        });
    });

    it("omits missing names from the transport label", () => {
        const item = extractGameEvent(
            packetWithEvents({
                trainData: { payAmount: 45, sourceName: "", targetName: "Duisburg" },
            }),
            "train",
        );

        expect(item?.label).toBe("Duisburg");
    });

    it("returns null when the event payload has not arrived yet", () => {
        expect(extractGameEvent(packetWithEvents({}), "fine")).toBe(null);
        expect(extractGameEvent(packetWithEvents({}), "toll")).toBe(null);
        expect(extractGameEvent(packetWithEvents({}), "ferry")).toBe(null);
        expect(extractGameEvent(packetWithEvents({}), "train")).toBe(null);
    });

    it("returns null for zero or negative amounts", () => {
        expect(
            extractGameEvent(
                packetWithEvents({ finedData: { payAmount: 0, offence: "X" } }),
                "fine",
            ),
        ).toBe(null);
        expect(
            extractGameEvent(packetWithEvents({ tollgatePayment: -5 }), "toll"),
        ).toBe(null);
    });
});
