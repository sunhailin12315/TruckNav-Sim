// Pure follow-camera math, ported in spirit from WestPlay's camera.ts
// (see docs/westplay-reference-study.md §2.3): a sample buffer rendered with
// a small fixed delay, frame-rate independent damping, and a speed-based
// zoom that keeps the same amount of road ahead on screen.
//
// Conventions (match TruckNav-Sim telemetry, not WestPlay's):
// - coords are MapLibre [lng, lat] degrees;
// - heading is degrees clockwise from north;
// - speed is km/h.
// Pure and testable; the caller owns the MapLibre map and the rAF loop.

/** A telemetry pose as the camera consumes it. */
export interface TruckSample {
    /** When it arrived, ms (performance.now()). */
    time: number;
    coords: [number, number];
    heading: number;
    speedKph: number;
}

/** How far behind the latest sample the camera runs, so it always has two
 * samples to move between and never has to extrapolate. */
export const FOLLOW_DELAY_MS = 70;

/** How long the map is left where it was moved before it recentres itself,
 * ms (CarPlay's unhurried re-lock; was 1.5 s here). */
export const AUTO_RECENTRE_MS = 15_000;

/** How far the player may zoom the following camera in or out from its
 * speed-based zoom (zoom levels): pulled out over a region, or in to a
 * junction, without losing the camera's feel for speed. */
export const ZOOM_OFFSET_LIMITS: readonly [number, number] = [-3, 1.5];

/** Time constants (ms) for the damped poses: center tightest, zoom slowest. */
export const DAMP_TAU = { center: 150, bearing: 180, zoom: 250 } as const;

/** ETS2 world map zooms (minZoom 5, maxZoom 13, navigation starts at 11):
 * close in town, further out on the motorway, so the road ahead keeps the
 * same time on screen between 20 and 90 km/h. */
export function zoomForSpeed(speedKph: number): number {
    const t = Math.min(1, Math.max(0, (speedKph - 20) / 70));
    const eased = t * t * (3 - 2 * t);
    return 11.4 - eased * 1.4;
}

/** The signed difference `to - from` between two bearings, -180..180. */
export function bearingDelta(from: number, to: number): number {
    return ((((to - from) % 360) + 540) % 360) - 180;
}

/** The truck at `time`, between the samples around it (the last one if
 * `time` is past it). Headings turn the short way round. */
export function truckAt(
    samples: readonly TruckSample[],
    time: number,
): TruckSample | null {
    if (samples.length === 0) return null;
    const last = samples[samples.length - 1]!;
    if (time >= last.time) return last;
    for (let i = samples.length - 1; i > 0; i--) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        if (time >= a.time) {
            const t =
                b.time === a.time ? 1 : (time - a.time) / (b.time - a.time);
            const lerp = (u: number, v: number) => u + (v - u) * t;
            const turn = bearingDelta(a.heading, b.heading);
            return {
                time,
                coords: [
                    lerp(a.coords[0], b.coords[0]),
                    lerp(a.coords[1], b.coords[1]),
                ],
                heading: (((a.heading + turn * t) % 360) + 360) % 360,
                speedKph: lerp(a.speedKph, b.speedKph),
            };
        }
    }
    return samples[0]!;
}

/** Exponential smoothing towards `target` with time constant `tau` (ms):
 * frame-rate independent. */
export function damp(
    current: number,
    target: number,
    dtMs: number,
    tau: number,
): number {
    return target + (current - target) * Math.exp(-dtMs / tau);
}

/** `damp` for bearings, the short way round. */
export function dampBearing(
    current: number,
    target: number,
    dtMs: number,
    tau: number,
): number {
    const next =
        current + bearingDelta(current, target) * (1 - Math.exp(-dtMs / tau));
    return ((next % 360) + 360) % 360;
}

export function clampZoomOffset(offset: number): number {
    return Math.min(
        ZOOM_OFFSET_LIMITS[1],
        Math.max(ZOOM_OFFSET_LIMITS[0], offset),
    );
}

/** The zoom offset that puts the following camera at `zoom` at this speed:
 * a zoom the player chose while browsing, kept when the map goes back to
 * following (and still varying with speed from there). */
export function zoomOffsetFor(zoom: number, speedKph: number): number {
    return clampZoomOffset(zoom - zoomForSpeed(speedKph));
}

/** Whether a damped pose has settled close enough to skip a repaint:
 * nearer than about a centimetre here, a hundredth of a zoom level, a
 * hundredth of a degree. */
export function samePose(
    a: { center: [number, number]; zoom: number; bearing: number },
    b: { center: [number, number]; zoom: number; bearing: number },
): boolean {
    return (
        Math.abs(a.center[0] - b.center[0]) < 1e-7 &&
        Math.abs(a.center[1] - b.center[1]) < 1e-7 &&
        Math.abs(a.zoom - b.zoom) < 1e-2 &&
        Math.abs(bearingDelta(a.bearing, b.bearing)) < 1e-2
    );
}
