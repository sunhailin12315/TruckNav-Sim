import { describe, expect, it } from "vitest";
import {
    getJobDetails,
    getRemainingDeliveryMinutes,
} from "~/assets/utils/telemetry/helpers";
import type { TelemetryPacket } from "~/types";

// The bridge anchors bare minute counts at the .NET DateTime epoch, so
// "385 minutes left" is sent as "0001-01-01T06:25:00Z". Encode samples the
// same way instead of hand-writing strings.
const YEAR_ONE_MS = -62135596800000; // Date.parse("0001-01-01T00:00:00Z")

function bridgeRemainingTime(minutes: number) {
    return new Date(YEAR_ONE_MS + minutes * 60000).toISOString();
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
    it("decodes the bridge's epoch-anchored minute count", () => {
        expect(getRemainingDeliveryMinutes(bridgeRemainingTime(385))).toBe(385);
        expect(getRemainingDeliveryMinutes("0001-01-01T06:25:00Z")).toBe(385);
    });

    it("returns null when no delivery window is set (0 minutes)", () => {
        expect(
            getRemainingDeliveryMinutes("0001-01-01T00:00:00Z"),
        ).toBeNull();
    });

    it("returns null beyond a week (implausible in-game)", () => {
        expect(
            getRemainingDeliveryMinutes(bridgeRemainingTime(8 * 24 * 60)),
        ).toBeNull();
    });

    it("returns null on missing or malformed input", () => {
        expect(getRemainingDeliveryMinutes("")).toBeNull();
        expect(getRemainingDeliveryMinutes("not-a-date")).toBeNull();
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
