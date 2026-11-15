/**
 * Builds the map-scan worker bundle consumed by the Electron main process.
 *
 * Entry:   scripts/scan-worker/entry.ts (imports @truckermudgeon/* sources)
 * Output:  electron/resources/scan/scan-worker.mjs
 *          electron/resources/scan/build/Release/{cityhash,gdeflate}.node
 *
 * The truckermudgeon/maps sources live outside this repo (they carry local
 * compatibility patches for current game builds). Point TRUCKNAV_SCAN_TOOLS_DIR
 * at a prepared checkout — default: D:\trucknav-map-tools\maps.
 * See docs/map-scan-pipeline.md for the full pipeline documentation.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolsDir =
    process.env.TRUCKNAV_SCAN_TOOLS_DIR ?? "D:\\trucknav-map-tools\\maps";
const outDir = path.join(repoRoot, "electron", "resources", "scan");

if (!existsSync(toolsDir)) {
    console.error(
        `[build:scan] scan tools not found at ${toolsDir}\n` +
            `Set TRUCKNAV_SCAN_TOOLS_DIR to a truckermudgeon/maps checkout ` +
            `(with the 1.62 compatibility patches) and retry.\n` +
            `See docs/map-scan-pipeline.md.`,
    );
    process.exit(1);
}
for (const node of ["cityhash.node", "gdeflate.node"]) {
    const p = path.join(toolsDir, "packages", "clis", "parser", "build", "Release", node);
    if (!existsSync(p)) {
        console.error(`[build:scan] native module missing: ${p}\n` +
            `Build the parser addon first: npm run build -w packages/clis/parser (in ${toolsDir})`);
        process.exit(1);
    }
}

/**
 * Resolves "@truckermudgeon/<pkg>[/<sub>]" to TS sources inside the tools
 * checkout. The clis packages have no package.json exports, so map package
 * names to directories directly.
 */
const packageDirs = {
    parser: path.join(toolsDir, "packages", "clis", "parser"),
    generator: path.join(toolsDir, "packages", "clis", "generator"),
    io: path.join(toolsDir, "packages", "libs", "io"),
    map: path.join(toolsDir, "packages", "libs", "map"),
    base: path.join(toolsDir, "packages", "libs", "base"),
    ui: path.join(toolsDir, "packages", "libs", "ui"),
    apis: path.join(toolsDir, "packages", "apis"),
};

const toolsResolverPlugin = {
    name: "truckermudgeon-sources",
    setup(build) {
        build.onResolve({ filter: /^@truckermudgeon\// }, (args) => {
            const rest = args.path.slice("@truckermudgeon/".length);
            const [pkg, ...sub] = rest.split("/");
            const dir = packageDirs[pkg];
            if (!dir) return { errors: [{ text: `unknown @truckermudgeon/${pkg}` }] };
            if (sub.length === 0) {
                return { path: path.join(dir, "index.ts") };
            }
            return { path: path.join(dir, ...sub) + ".ts" };
        });
    },
};

mkdirSync(path.join(outDir, "build", "Release"), { recursive: true });
// The runtime `bindings` package walks up from the bundle file looking for a
// package.json to treat as the module root, then tries build/Release/*.node
// under it. Without one here it would latch onto electron/package.json.
writeFileSync(
    path.join(outDir, "package.json"),
    JSON.stringify({ name: "trucknav-scan-worker", private: true }),
);

const result = await esbuild.build({
    entryPoints: [path.join(repoRoot, "scripts", "scan-worker", "entry.ts")],
    outfile: path.join(outDir, "scan-worker.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    logLevel: "info",
    metafile: true,
    plugins: [toolsResolverPlugin],
    // CJS deps bundled into an ESM output hit esbuild's dynamic-require shim;
    // give them a real require bound to the bundle's own URL.
    banner: {
        js: "import { createRequire as __scanCreateRequire } from 'node:module';\nvar require = __scanCreateRequire(import.meta.url);",
    },
    conditions: ["node"],
});

const warnings = result.warnings?.length ?? 0;
for (const node of ["cityhash.node", "gdeflate.node"]) {
    copyFileSync(
        path.join(toolsDir, "packages", "clis", "parser", "build", "Release", node),
        path.join(outDir, "build", "Release", node),
    );
}

const out = result.metafile.outputs[path.join(outDir, "scan-worker.mjs").replace(/\\/g, "/")] ??
    Object.values(result.metafile.outputs)[0];
console.log(
    `[build:scan] ok: scan-worker.mjs (${Math.round(out.bytes / 1024)} KiB) + 2 native modules -> ${outDir}`,
);
