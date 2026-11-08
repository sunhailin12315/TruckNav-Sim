#!/usr/bin/env node
// Downloads the offline neural TTS model for the Electron app into
// electron/tts-models/. Default: vits-melo-tts-zh_en (Chinese + English,
// ~163 MB) from the k2-fsa sherpa-onnx release assets. Other models can be
// fetched by name, e.g.:
//   node scripts/download-tts-model.mjs --model vits-zh-hf-theresa-q8
// Usage: node scripts/download-tts-model.mjs [--model <name>]

import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const MODEL = modelIdx !== -1 ? args[modelIdx + 1] : "vits-melo-tts-zh_en";

if (!MODEL || MODEL.startsWith("--")) {
    console.error("Usage: node scripts/download-tts-model.mjs [--model <name>]");
    process.exit(1);
}

const MODELS_BASE =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";
const url = `${MODELS_BASE}/${MODEL}.tar.bz2`;

const here = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = path.join(here, "..", "electron", "tts-models");
const targetDir = path.join(targetRoot, MODEL);
const archivePath = path.join(targetRoot, `${MODEL}.tar.bz2`);

if (existsSync(targetDir)) {
    console.log(`Model already present: ${targetDir}`);
    console.log("Delete it first if you want to re-download.");
    process.exit(0);
}

mkdirSync(targetRoot, { recursive: true });

// A previous run may have downloaded fine and only failed to extract —
// reuse the archive instead of re-fetching 160 MB.
const haveArchive =
    existsSync(archivePath) && statSync(archivePath).size > 50 * 1048576;

if (!haveArchive) {
    console.log(`Downloading ${url}`);
    console.log("(this can take a while — the archive is over 100 MB)");

    // Follow redirects manually: GitHub release assets redirect to S3.
    let response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
        console.error(`Download failed: HTTP ${response.status}`);
        process.exit(1);
    }

    const total = Number(response.headers.get("content-length") || 0);
    const file = createWriteStream(archivePath);
    let received = 0;
    let lastLogged = -1;

    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (!file.write(Buffer.from(value))) {
            await new Promise((resolve) => file.once("drain", resolve));
        }
        if (total > 0) {
            const percent = Math.floor((received / total) * 100);
            if (percent !== lastLogged && percent % 5 === 0) {
                lastLogged = percent;
                console.log(
                    `  ${percent}% (${(received / 1048576).toFixed(0)} MB)`,
                );
            }
        }
    }
    file.end();
    console.log(
        `Downloaded ${(statSync(archivePath).size / 1048576).toFixed(1)} MB, extracting...`,
    );
} else {
    console.log("Reusing previously downloaded archive, extracting...");
}

// Extract with a relative archive name and cwd: an absolute Windows path
// ("D:\...") is parsed by GNU tar as a remote host:file and fails.
const tar = spawnSync("tar", ["-xjf", `${MODEL}.tar.bz2`], {
    cwd: targetRoot,
    stdio: "inherit",
});
if (tar.status !== 0 || !existsSync(path.join(targetRoot, MODEL))) {
    console.error(
        `Extraction failed (tar exit ${tar.status}). The archive is kept at:\n  ${archivePath}`,
    );
    process.exit(1);
}

const expected = [
    "model.onnx",
    "tokens.txt",
    "lexicon.txt",
    path.join("dict"),
];
const missing = expected.filter((f) => !existsSync(path.join(targetDir, f)));
if (missing.length > 0) {
    console.error(
        `Warning: expected model files missing in ${targetDir}: ${missing.join(", ")}`,
    );
    await rm(targetDir, { recursive: true, force: true });
    process.exit(1);
}

await rm(archivePath, { force: true });
console.log(`Done. Model extracted to:\n  ${targetDir}`);
