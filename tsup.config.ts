import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/cli.ts"],
  format: ["esm"],
  minify: false,
  platform: "node",
  shims: false,
  sourcemap: true,
  splitting: false,
  target: "node22"
});
