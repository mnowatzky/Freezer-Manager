// Production build: bundles the API and the migration runner, including all npm dependencies
// and the TypeScript sources of @freezer/shared, into self-contained files in dist/.
// The runtime image then needs no node_modules at all.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outExtension: { ".js": ".mjs" }, // ESM without needing a package.json next to it
  sourcemap: true,
  logLevel: "info",
  // Some dependencies are CommonJS and call require(); give the ESM bundle a real one.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
