/**
 * Pure helpers shared by the scan worker bundle and its unit tests.
 *
 * The projection must stay byte-compatible with the app's
 * convertEts2ToGeo (app/assets/utils/map/converters.ts): both sides consume
 * game-plane coordinates from the same graph/city data, and telemetry
 * positions are matched against them at runtime.
 */

const MERCATOR_R = 300000.0;

export function toWgs84(gameX: number, gameY: number): [number, number] {
    const lon = (gameX / MERCATOR_R) * (180.0 / Math.PI);
    const yMerc = -gameY / MERCATOR_R;
    const latRad = 2.0 * Math.atan(Math.exp(yMerc)) - Math.PI / 2.0;
    return [lon, latRad * (180.0 / Math.PI)];
}

/** Radian bearing between two WGS84 points (matches the app's getBearing). */
export function bearingRad(
    a: [number, number],
    b: [number, number],
): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const [lng1, lat1] = a.map(toRad);
    const [lng2, lat2] = b.map(toRad);
    const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
    return Math.atan2(y, x);
}

// truckermudgeon dlcGuard -> TruckNav DLC id (ets2Expansions key).
// 0 = base game / no DLC needed. Combined guards map to the primary DLC.
// Guard 27 is the official Iceland DLC (first seen in 1.62 scan data).
export const GUARD_TO_DLC: Record<number, number> = {
    0: 0,
    1: 1, // Going East
    2: 2, // Scandinavia
    3: 3, // Vive La France
    4: 4, // Italia
    5: 4, // Italia + VLF
    6: 5, // Beyond the Baltic Sea
    7: 5,
    8: 5,
    9: 6, // Road to the Black Sea
    10: 6,
    11: 7, // Iberia
    12: 7,
    13: 0, // Heart of Russia (cancelled)
    14: 5,
    15: 0, // Krone factory
    16: 8, // West Balkans
    17: 8,
    18: 8,
    19: 0, // Feldbinder factory
    20: 9, // Greece
    21: 9,
    22: 9,
    23: 10, // Nordic Horizons
    24: 10,
    25: 10,
    27: 11, // Iceland
};

/** Guard ids seen in the wild but absent from the table (kept for diagnostics). */
export function mapGuardToDlc(guard: number | undefined): {
    dlc: number;
    unknown: boolean;
} {
    const dlc = GUARD_TO_DLC[guard ?? 0];
    return { dlc: dlc ?? 0, unknown: dlc === undefined };
}
