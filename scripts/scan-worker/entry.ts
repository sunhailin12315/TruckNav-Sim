/**
 * Scan-worker bundle entry: parses a local ETS2/ATS install in-memory and
 * emits TruckNav map data (roadnetwork bins + map-data JSONs).
 *
 * Runs as a plain Node process (spawned with ELECTRON_RUN_AS_NODE=1 by the
 * main process) to keep the multi-GB heap off the renderer/main processes.
 *
 * Progress is reported as one JSON object per stdout line:
 *   {type:"progress", phase, percent, detail?}
 *   {type:"log", message}
 *   {type:"done", stats} | {type:"error", message}
 *
 * Usage: node scan-worker.mjs --gameDir <dir> --out <dir> --game ets2
 */
import fs from "node:fs";
import path from "node:path";

import { generateGraph } from "@truckermudgeon/generator/graph/graph";
import { graphMapDataKeys } from "@truckermudgeon/generator/graph/graph";
import { readMapData } from "@truckermudgeon/io";
import type { FileSource } from "@truckermudgeon/io/file-source";
import type { MapData } from "@truckermudgeon/map/types";
import { toSplinePoints } from "@truckermudgeon/base/geom";
import { parseMapFiles } from "@truckermudgeon/parser/game-files/map-files-parser";
import { bearingRad, mapGuardToDlc, toWgs84 } from "./convert";

// Same patch as libs/io/write.ts: parser output carries bigint uids, and the
// in-memory FileSource serializes them through JSON. The io package declares
// sideEffects:false, so its own patch gets tree-shaken out of the bundle.
(BigInt.prototype as any).toJSON = function () {
    return this.toString(16);
};

// --- progress plumbing ----------------------------------------------------

function emit(line: Record<string, unknown>) {
    process.stdout.write(JSON.stringify(line) + "\n");
}

function progress(phase: string, percent: number, detail?: string) {
    emit({ type: "progress", phase, percent: Math.round(percent), detail });
}

// --- in-memory FileSource (avoids ~500 MB of intermediate JSON on disk) ----

function memoryFileSource(mapData: MapData, map: "usa" | "europe"): FileSource {
    const cache = new Map<string, string>();
    const keyFromName = (name: string) =>
        name.startsWith(`${map}-`) ? name.slice(map.length + 1, -".json".length) : null;
    return {
        has(name) {
            const key = keyFromName(name);
            return key != null && key in mapData;
        },
        readUtf8(name) {
            const key = keyFromName(name);
            if (key == null || !(key in mapData)) {
                throw new Error(`memory source has no ${name}`);
            }
            if (!cache.has(name)) {
                cache.set(
                    name,
                    JSON.stringify((mapData as Record<string, unknown[]>)[key]),
                );
            }
            return cache.get(name)!;
        },
        describe: () => "memory",
    };
}

// --- TruckNav conversion (port of to-trucknav.mts) -------------------------

interface ConvertInput {
    graphData: { graph: Map<bigint, { forward: any[]; backward: any[] }> };
    mapData: MapData;
    map: "usa" | "europe";
    version: string;
    outDir: string;
}

export function convertToTruckNav({ graphData, mapData, map, version, outDir }: ConvertInput) {
    const nodesByUid = new Map<bigint, any>();
    for (const n of mapData.nodes) nodesByUid.set(n.uid, n);
    if (nodesByUid.size === 0) throw new Error("no parsed nodes");

    const roadByNodes = new Map<string, any>();
    for (const r of mapData.roads) {
        roadByNodes.set(`${r.startNodeUid}->${r.endNodeUid}`, r);
        roadByNodes.set(`${r.endNodeUid}->${r.startNodeUid}`, r);
    }

    // renumber graph vertices to dense ints (Float32-safe node ids)
    const allUids = new Set<bigint>();
    for (const [uid, entry] of graphData.graph) {
        allUids.add(uid);
        for (const nb of [...entry.forward, ...entry.backward]) {
            allUids.add(nb.nodeUid);
        }
    }
    const sortedUids = [...allUids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const idOf = new Map<bigint, number>();
    sortedUids.forEach((uid, i) => idOf.set(uid, i));

    const geometry: number[] = [];
    const edges: number[][] = [];
    const unknownGuards = new Set<number>();

    let edgeDone = 0;
    const totalEdges = [...graphData.graph.values()].reduce(
        (sum, e) => sum + e.forward.length + e.backward.length,
        0,
    );

    for (const [uid, entry] of graphData.graph) {
        const uNode = nodesByUid.get(uid);
        if (!uNode) continue;
        for (const dir of ["forward", "backward"] as const) {
            for (const nb of entry[dir]) {
                const vNode = nodesByUid.get(nb.nodeUid);
                if (!vNode) continue;

                // spline along the road item; straight line for prefab/hack edges
                const road = roadByNodes.get(`${uid}->${nb.nodeUid}`);
                const pts: Array<[number, number]> = road
                    ? toSplinePoints(
                          { position: [uNode.x, uNode.y], rotation: uNode.rotation },
                          { position: [vNode.x, vNode.y], rotation: vNode.rotation },
                      ).map((p: any) => [p[0], p[1]] as [number, number])
                    : [
                          [uNode.x, uNode.y],
                          [vNode.x, vNode.y],
                      ];
                const wgs = pts.map(([x, y]) => toWgs84(x, y));

                const startIndex = geometry.length;
                for (const [lng, lat] of wgs) geometry.push(lng, lat);

                const { dlc, unknown } = mapGuardToDlc(nb.dlcGuard);
                if (unknown) unknownGuards.add(nb.dlcGuard);

                const b = bearingRad(wgs[0], wgs[wgs.length - 1]);
                edges.push([
                    idOf.get(uid)!,
                    idOf.get(nb.nodeUid)!,
                    // CLI graphSerializer rounds distance to 2 decimals;
                    // match it so scans are byte-reproducible against the
                    // documented CLI pipeline.
                    nb.distance != null ? Number(nb.distance.toFixed(2)) : 1,
                    b,
                    b,
                    nb.isFerry ? 1 : 0,
                    dlc ?? 0,
                    0, // vPrefabId unknown in scan data
                    startIndex,
                    wgs.length,
                    0, // maneuverType
                    0, // exitNumber
                ]);
                if (++edgeDone % 50000 === 0) {
                    progress("convert", 80 + (edgeDone / totalEdges) * 10);
                }
            }
        }
    }
    if (unknownGuards.size) {
        emit({
            type: "log",
            message: `unknown dlc guards mapped to 0: ${[...unknownGuards].join(",")}`,
        });
    }

    // graph.bin: Float32, 12 values per directed edge
    const roadnetworkDir = path.join(outDir, "roadnetwork");
    const mapDataDir = path.join(outDir, "map-data");
    fs.mkdirSync(roadnetworkDir, { recursive: true });
    fs.mkdirSync(mapDataDir, { recursive: true });

    const graphF32 = new Float32Array(edges.length * 12);
    edges.forEach((e, i) => graphF32.set(e, i * 12));
    fs.writeFileSync(
        path.join(roadnetworkDir, "graph.bin"),
        Buffer.from(graphF32.buffer),
    );

    const geoF32 = new Float32Array(geometry);
    fs.writeFileSync(
        path.join(roadnetworkDir, "geometry.bin"),
        Buffer.from(geoF32.buffer),
    );

    // cities.json: app converts game-plane coords itself (CityData.ts)
    const cities = (mapData.cities as any[]).map(c => ({
        token: c.token,
        name: c.name,
        countryToken: c.countryToken,
        population: c.population ?? 0,
        x: c.x,
        y: c.y,
        areas: (c.areas ?? []).map((a: any) => ({
            uid: String(a.uid),
            type: a.type ?? 12,
            x: a.x,
            y: a.y,
            width: a.width,
            height: a.height,
            hidden: !!a.hidden,
        })),
    }));
    fs.writeFileSync(
        path.join(mapDataDir, "cities.json"),
        JSON.stringify(cities),
    );

    // scale.json: app defaults (CityData.ts fallback values)
    fs.writeFileSync(
        path.join(mapDataDir, "scale.json"),
        JSON.stringify({ ruralScale: 19, urbanScale: 3, hasUkRule: true }),
    );

    const stats = {
        nodes: sortedUids.length,
        edges: edges.length,
        cities: cities.length,
        gameVersion: version,
    };

    // manifest.json: lets the renderer list scanned maps with metadata
    fs.writeFileSync(
        path.join(outDir, "manifest.json"),
        JSON.stringify({
            kind: "map-scan",
            game: map === "usa" ? "ats" : "ets2",
            gameVersion: version,
            scannedAt: new Date().toISOString(),
            ...stats,
        }),
    );

    return stats;
}

// --- main ------------------------------------------------------------------

function parseArgs() {
    const args: Record<string, string> = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i]?.replace(/^--/, "");
        const next = argv[i + 1];
        if (key && next && !next.startsWith("--")) {
            args[key] = next;
            i++;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs();
    const gameDir = args.gameDir;
    const outDir = args.out;
    const game = args.game === "ats" ? "ats" : "ets2";
    if (!gameDir || !outDir) {
        emit({ type: "error", message: "usage: --gameDir <dir> --out <dir> [--game ets2|ats]" });
        process.exit(2);
    }
    if (!fs.existsSync(gameDir)) {
        emit({ type: "error", message: `game dir not found: ${gameDir}` });
        process.exit(2);
    }

    progress("prepare", 1);

    const scsFilePaths = fs
        .readdirSync(gameDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith(".scs"))
        .map(e => path.join(gameDir, e.name));
    emit({
        type: "log",
        message: `scanning ${scsFilePaths.length} .scs archives from ${gameDir}`,
    });

    progress("sectors", 5, `0 archives queued`);
    const { data, map, version, mapData } = parseMapFiles(scsFilePaths, {
        includeDlc: true,
        mode: "all",
        onProgress: (done, total) => progress("sectors", 5 + (done / total) * 50, `${done}/${total} sectors`),
    });
    if (data !== "all") {
        emit({ type: "error", message: `unexpected parse mode: ${data}` });
        process.exit(2);
    }
    const expectedMap = game === "ats" ? "usa" : "europe";
    if (map !== expectedMap) {
        emit({ type: "error", message: `game files are for ${map}, expected ${expectedMap}` });
        process.exit(2);
    }
    emit({ type: "log", message: `game version ${version}, ${mapData.nodes.length} nodes parsed` });

    progress("graph", 60);
    const memorySource = memoryFileSource(mapData, map);
    const tsMapData = readMapData(memorySource, map, { mapDataKeys: graphMapDataKeys });
    const { graph: graphMap } = generateGraph(tsMapData as any);
    emit({ type: "log", message: `graph built: ${graphMap.size} vertices` });

    progress("convert", 80);
    const stats = convertToTruckNav({
        graphData: { graph: graphMap },
        mapData,
        map,
        version,
        outDir,
    });

    progress("done", 100);
    emit({ type: "done", stats });
}

main().catch(err => {
    emit({ type: "error", message: String(err?.stack ?? err) });
    process.exit(1);
});
