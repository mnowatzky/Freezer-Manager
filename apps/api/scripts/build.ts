// Production build: bundles the API and the migration runner, including all npm dependencies
// and the TypeScript sources of @freezer/shared, into self-contained files in dist/.
// The runtime image then needs no node_modules at all.
import { buildInfo } from "@freezer/shared/build-info";
import { build } from "esbuild";

const info = buildInfo();

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
  // Bake the version in: the runtime image has neither the build args, package.json nor git.
  define: {
    "process.env.APP_VERSION": JSON.stringify(info.version),
    "process.env.APP_COMMIT": JSON.stringify(info.commit),
  },
  // Some dependencies are CommonJS and call require(); give the ESM bundle a real one.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
