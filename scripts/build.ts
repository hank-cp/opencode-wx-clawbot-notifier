// Bundle the server plugin entrypoint with Bun.
// - target: node —— the OpenCode server may run under Node (Desktop/Electron sidecar)
// - @opencode/plugin is external —— the host provides its own instance
const result = await Bun.build({
  target: "node",
  format: "esm",
  external: ["@opencode/plugin"],
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  naming: { entry: "index.js" },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("built dist/index.js")
