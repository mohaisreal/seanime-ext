// Build a manifest with an embedded payload for installation before publishing.
const { readFileSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
const manifest = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf8"))
delete manifest.payloadURI
delete manifest.manifestURI
delete manifest.readme
manifest.payload = readFileSync(join(__dirname, "main.ts"), "utf8")
const output = join(__dirname, "mangaunion.json")
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n")
console.log(output)
