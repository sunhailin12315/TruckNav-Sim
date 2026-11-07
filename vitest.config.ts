import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests target the pure routing/map helpers under app/assets/utils.
// The ~ alias mirrors Nuxt's srcDir (app/).
export default defineConfig({
    resolve: {
        alias: {
            "~": fileURLToPath(new URL("./app", import.meta.url)),
            "@": fileURLToPath(new URL("./app", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
