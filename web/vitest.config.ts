import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The same "@/…" imports as tsconfig.json, so tests can load pages and routes.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
