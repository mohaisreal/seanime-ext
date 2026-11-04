const { readFileSync, writeFileSync, copyFileSync, existsSync } = require("node:fs")
const { join, resolve } = require("node:path")

const manifest = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf8"))
const portable = { ...manifest, payload: readFileSync(join(__dirname, "main.ts"), "utf8") }
delete portable.payloadURI
const portablePath = join(__dirname, "custom-manga-metadata.json")
writeFileSync(portablePath, JSON.stringify(portable, null, 2) + "\n")
console.log(`Instalable: ${portablePath}`)
const installDev = process.argv.includes("--install-dev")
let installPath = portablePath
if (installDev || process.argv.includes("--development")) {
    const development = { ...manifest, manifestURI: "", payloadURI: resolve(__dirname, "main.ts").replace(/\\/g, "/"), isDevelopment: true }
    installPath = join(__dirname, "custom-manga-metadata.development.json")
    writeFileSync(installPath, JSON.stringify(development, null, 2) + "\n")
    console.log(`Desarrollo: ${installPath}`)
}
if (installDev || process.argv.includes("--install")) {
    const directory = join(process.env.APPDATA || "", "Seanime", "extensions")
    if (!process.env.APPDATA || !existsSync(directory)) throw new Error("No se encontró la carpeta de extensiones de Seanime.")
    const target = join(directory, "custom-manga-metadata.json")
    if (existsSync(target) && !process.argv.includes("--replace")) throw new Error(`Ya existe ${target}. Usa --replace para sustituirlo.`)
    copyFileSync(installPath, target)
    console.log(`${installDev ? "Desarrollo" : "Versión estable"} instalado: ${target}`)
}
