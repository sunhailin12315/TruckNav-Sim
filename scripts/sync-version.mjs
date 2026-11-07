// Single source of truth for the app version is the root package.json.
// Run `npm run version:sync` after bumping it to propagate the version to
// the platform manifests that need it (electron, android).
// `versionCode` in android/app/build.gradle stays manual.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const rootPkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf-8"),
);
const version = rootPkg.version;

if (!version) {
    console.error("[version:sync] No version field in root package.json");
    process.exit(1);
}

// electron/package.json
const electronPkgPath = path.join(root, "electron", "package.json");
const electronPkg = JSON.parse(readFileSync(electronPkgPath, "utf-8"));
if (electronPkg.version !== version) {
    electronPkg.version = version;
    writeFileSync(
        electronPkgPath,
        JSON.stringify(electronPkg, null, 4) + "\n",
    );
    console.log(`[version:sync] electron/package.json -> ${version}`);
} else {
    console.log(`[version:sync] electron/package.json already at ${version}`);
}

// android/app/build.gradle (versionName only)
const gradlePath = path.join(root, "android", "app", "build.gradle");
const gradle = readFileSync(gradlePath, "utf-8");
const updated = gradle.replace(
    /versionName "[^"]*"/,
    `versionName "${version}"`,
);
if (updated !== gradle) {
    writeFileSync(gradlePath, updated);
    console.log(`[version:sync] android/app/build.gradle -> ${version}`);
} else {
    console.log(`[version:sync] android/app/build.gradle already at ${version}`);
}
