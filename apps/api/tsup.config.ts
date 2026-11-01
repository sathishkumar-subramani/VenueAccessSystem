import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/seed.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Workspace packages are source-only (`main` points at .ts), so they must be
  // bundled in. Render then runs one self-contained file and never has to
  // resolve a pnpm workspace symlink at runtime.
  noExternal: [/^@venue\//],
});
