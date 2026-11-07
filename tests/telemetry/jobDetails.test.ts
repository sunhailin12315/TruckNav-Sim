import { describe, expect, it } from "vitest";
import {
    getJobDetails,
    getRemainingDeliveryMinutes,
} from "~/assets/utils/telemetry/helpers";
import type { TelemetryPacket } from "~/types";

const GAME_TIME = "2026-01-10T12:00:00.000Z";

function minutesFromNow(minutes: number) {
    return new Date(new Date(GAME_TIME).getTime() + minutes * 60000).toISOString();
}

function packetWithJob(job: Partial<TelemetryPacket["job"]>): TelemetryPacket {
    return {
        job: {
            remainingDeliveryTime: "",
            cargoLoaded: false,
            specialJob: false,
            jobType: "",
            cargo: { mass: 0, name: "", cargoDamage: 0 },
            cityDestinationId: "",
            cityDestination: "",
            companyDestinationId: "",
            companyDestination: "",
            citySourceId: "",
            citySource: "",
            companySourceId: "",
            companySource: "",
            income: 0,
            ...job,
        },
    } as TelemetryPacket;
}

describe("getRemainingDeliveryMinutes", () => {
    it("returns the minutes left until the deadline", () => {
        expect(
            getRemainingDeliveryMinutes(minutesFromNow(90), GAME_TIME),
        ).toBe(90);
    });

    it("returns negative minutes for an overdue deadline", () => {
        expect(
            getRemainingDeliveryMinutes(minutesFromNow(-30), GAME_TIME),
        ).toBe(-30);
    });

    it("returns null when the deadline is implausibly far away", () => {
        expect(
            getRemainingDeliveryMinutes(minutesFromNow(8 * 24 * 60), GAME_TIME),
        ).toBe(null);
    });

    it("returns null for a duration misread as a date", () => {
        // A 1h30m duration encoded as time-since-epoch lands far outside
        // the plausible window relative to the game time.
        expect(
            getRemainingDeliveryMinutes("0001-01-01T01:30:00.000Z", GAME_TIME),
        ).toBe(null);
    });

    it("returns null on missing or malformed input", () => {
        expect(getRemainingDeliveryMinutes("", GAME_TIME)).toBe(null);
        expect(getRemainingDeliveryMinutes(minutesFromNow(90), "")).toBe(null);
        expect(getRemainingDeliveryMinutes("not-a-date", GAME_TIME)).toBe(null);
    });
});

describe("getJobDetails", () => {
    it("extracts cargo, income and route names", () => {
        const details = getJobDetails(
            packetWithJob({
                income: 12345,
                cargo: { mass: 18000, name: "Construction Tools", cargoDamage: 12 },
                citySource: "Calais",
                companySource: "TransAgil",
                cityDestination: "Duisburg",
                companyDestination: "SellPlan",
            }),
        );

        expect(details).toEqual({
            cargoName: "Construction Tools",
            cargoMassKg: 18000,
            cargoDamage: 12,
            income: 12345,
            sourceCityName: "Calais",
            sourceCompanyName: "TransAgil",
            destinationCityName: "Duisburg",
            destinationCompanyName: "SellPlan",
        });
    });

    it("normalizes 0-1 damage fractions into 0-100 percent", () => {
        const details = getJobDetails(
            packetWithJob({
                cargo: { mass: 5000, name: "Glass", cargoDamage: 0.35 },
            }),
        );

        expect(details.cargoDamage).toBe(35);
    });

    it("clamps damage outliers and tolerates missing cargo", () => {
        const damaged = getJobDetails(
            packetWithJob({
                cargo: { mass: 0, name: "", cargoDamage: 150 },
            }),
        );
        expect(damaged.cargoDamage).toBe(100);

        const empty = getJobDetails(packetWithJob({ cargo: undefined }));
        expect(empty.cargoName).toBe("");
        expect(empty.cargoDamage).toBe(0);
        expect(empty.income).toBe(0);
    });
});
