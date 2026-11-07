// Delivery performance grade from the data stored in every trip record.
// Pure and offline; S through C mirrors the game's own bonus culture.

export type DeliveryGrade = "S" | "A" | "B" | "C";

export function computeDeliveryGrade(
    cargoDamage: number,
    finesCount: number,
): DeliveryGrade {
    if (cargoDamage === 0 && finesCount === 0) return "S";
    if (cargoDamage < 5 && finesCount === 0) return "A";
    if (cargoDamage < 20 && finesCount <= 1) return "B";
    return "C";
}
