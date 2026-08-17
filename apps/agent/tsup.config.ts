import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/docker-broker-entry.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  splitting: false,
  shims: true,
  noExternal: [/.*/u],
  banner: {
    js: 'import { createRequire as __dashboardCreateRequire } from "node:module"; const require = __dashboardCreateRequire(import.meta.url);',
  },
});
