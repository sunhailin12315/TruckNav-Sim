// Turn glyphs on a 48-unit square: thick rounded strokes, the way in from
// the bottom. A turn points where the road actually goes (its angle); an
// exit shows the way not taken faintly; a roundabout shows its ring and the
// arm out; arrival is a flag.
//
// The geometry follows WestPlay's ManeuverGlyph.tsx (GPL-3.0-or-later,
// github.com/enes-less/WestPlay — see docs/westplay-reference-study.md
// §2.7), adapted to DirectionStep's types and angle.

import type { DirectionStep } from "~/assets/utils/routing/directions";

export interface GlyphPath {
    d: string;
    /** Relative opacity: the way not taken is drawn faintly. */
    opacity?: number;
    /** Filled (arrowheads, flags) rather than stroked. */
    fill?: boolean;
}

type GlyphStep = Pick<DirectionStep, "type" | "angle" | "exitCount">;

/** How faint the way not taken is. */
const FAINT = 0.35;
/** How far an arrowhead's tip reaches past its line's end. */
const ARROW_TIP = 3;
/** The square's edges a tip stays inside (its stroke reaching a little
 * further). */
const EDGE_NEAR = 2.5;
const EDGE_FAR = 45.5;

/** A unit direction for an angle (degrees, clockwise from straight up). */
function along(angle: number): [number, number] {
    const radians = (angle * Math.PI) / 180;
    return [Math.sin(radians), -Math.cos(radians)];
}

/** A line from `from` to `to`, ending in an arrowhead pointing along it. */
function arrow(
    from: [number, number],
    to: [number, number],
    opacity = 1,
): GlyphPath[] {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    const d: [number, number] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    const across: [number, number] = [-d[1], d[0]];
    const tip: [number, number] = [to[0] + d[0] * ARROW_TIP, to[1] + d[1] * ARROW_TIP];
    const back = (k: number, side: number): string =>
        `${to[0] - d[0] * k + across[0] * side} ${to[1] - d[1] * k + across[1] * side}`;
    return [
        {
            d: `M${from[0]} ${from[1]} L${to[0] - d[0] * ARROW_TIP} ${to[1] - d[1] * ARROW_TIP}`,
            opacity,
        },
        { d: `M${tip[0]} ${tip[1]} L${back(5, 6.5)} L${back(5, -6.5)} Z`, opacity, fill: true },
    ];
}

const stem: GlyphPath = { d: "M24 44V26" };

/** The paths of `step`'s glyph, in draw order. Every turn type is covered;
 * unknown or data-less turns fall back to a plain up arrow. */
export function maneuverGlyph(step: GlyphStep): GlyphPath[] {
    switch (step.type) {
        case "destination":
            return [{ d: "M15 43V7" }, { d: "M15 8h20l-5 8 5 8H15", fill: true }];
        case "u-turn":
            return [{ d: "M31 44V21a7 7 0 0 0-14 0v6" }, ...arrow([17, 24], [17, 33])];
        case "slight-left":
        case "slight-right":
        case "left":
        case "right":
        case "sharp-left":
        case "sharp-right": {
            const angle = step.angle ?? (step.type.endsWith("left") ? -45 : 45);
            const [dx, dy] = along(angle);
            return [stem, ...arrow([24, 26], [24 + dx * 15, 26 + dy * 15])];
        }
        case "exit-highway": {
            const side = (step.angle ?? 45) >= 0 ? 1 : -1;
            return [
                stem,
                ...arrow([24, 26], [24, 6], FAINT),
                ...arrow([24, 30], [24 + side * 14, 12]),
            ];
        }
        case "roundabout": {
            // Round anticlockwise from the bottom of the ring to the exit
            // (driving on the right), then out along it. Without the exit's
            // own angle the arm stands at the second exit's place.
            const out = 60;
            const [cx, cy, r] = [24, 23, 8.5];
            const [dx, dy] = along(out);
            const exitAt: [number, number] = [cx + r * dx, cy + r * dy];
            const large = out < 0 ? 1 : 0;
            // As long as the arm can be with its arrowhead's tip still
            // inside the square.
            const room = (from: number, d: number) =>
                d > 0 ? (EDGE_FAR - from) / d : d < 0 ? (EDGE_NEAR - from) / d : Infinity;
            const arm = Math.min(11, room(exitAt[0], dx) - ARROW_TIP, room(exitAt[1], dy) - ARROW_TIP);
            return [
                { d: `M${cx} ${cy - r} A${r} ${r} 0 1 0 ${cx} ${cy + r} A${r} ${r} 0 1 0 ${cx} ${cy - r}`, opacity: FAINT },
                { d: `M24 44V${cy + r} A${r} ${r} 0 ${large} 0 ${exitAt[0]} ${exitAt[1]}` },
                ...arrow(exitAt, [exitAt[0] + dx * arm, exitAt[1] + dy * arm]),
            ];
        }
        case "depart":
        case "straight":
        case "ferry":
        default:
            return [stem, ...arrow([24, 26], [24, 11])];
    }
}
