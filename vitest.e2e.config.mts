import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pruebas de punta a punta (`npm run e2e:reservas`): un Chrome real, dos "celulares" y la app corriendo contra una
 * base local aparte. NO forman parte de `npm run verificar` (necesitan Chrome instalado y levantan un servidor).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/lib/vacio.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    // Arrancar `next dev` y compilar la primera página tarda; cada paso del recorrido, no.
    hookTimeout: 240_000,
    testTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
