import {
  blue,
  brightMagenta,
  cyan,
  gray,
  red,
  yellow,
} from 'jsr:@std/fmt/colors'
import { compress } from 'https://deno.land/x/brotli@0.1.7/mod.ts' // not on JSR yet
import { config } from './build-config.ts'
import { build } from 'npm:esbuild'

// DIST_DIR: another folder for a second server (QA: dist-qa), default dist
const outdir = Deno.env.get('DIST_DIR') || 'dist'
const start = Date.now()
const { metafile } = await build({
  ...config,
  outdir,
  sourcemap: false,
  minify: true,
  metafile: true,
})

const unitColors: Record<string, (s: string) => string> = {
  B: blue,
  kB: yellow,
}

const toUnits = (xp: number) => {
  const e = (Math.log(xp) / Math.log(1000)) | 1
  const unit = `${'kMGTPEZY'[e - 1] || ''}B`
  const color = unitColors[unit] || red
  const num = xp / Math.pow(1000, e)
  const round = Math.round(num)
  const value = round > 100 ? String(round) : num.toFixed(round > 9 ? 1 : 2)
  const pad = ' '.repeat(Math.max(6 - (unit.length + value.length), 0))

  return `${pad}${brightMagenta(value)}${color(unit)}`
}

const allImportsList = Object.entries(metafile.inputs).flatMap(
  ([source, { imports }]) => imports.map((s) => ({ ...s, source })),
)

const allImports = Object.groupBy(allImportsList, (e) => e.path)

const percent = (ratio: number) => gray(`(${(ratio * 100).toFixed(2)}%)`)

// TODO: merge imports
// find all imports that are not connected to our files
type Pkg = { from: string; name: string; size: number }

const outputs = Object.entries(metafile.outputs)
for (const [outfile, { bytes, entryPoint, inputs }] of outputs) {
  const compressed = compress(Deno.readFileSync(outfile))
  Deno.writeFileSync(`${outfile}.br`, compressed)
  const deps: Pkg[] = []
  const output: Record<string, {
    size: number
    files: string[]
    dependencies: typeof deps
    path: string
    totalSize: number
  }> = {}
  for (const [path, { bytesInOutput }] of Object.entries(inputs)) {
    const imports = allImports[path] || []
    const [firstImport] = imports
    if (!firstImport) continue
    const original = firstImport.original || ''
    const firstChar = original[0]
    if (!firstImport || firstChar === '.' || firstChar === '/') continue
    const files: string[] = []
    let firstSrc
    for (const { source } of imports) {
      if (source.startsWith('.')) {
        firstSrc = source
      } else {
        files.push(source)
      }
    }
    if (files.length) {
      output[original] = {
        size: bytesInOutput,
        files,
        path,
        dependencies: [],
        totalSize: bytesInOutput,
      }
      continue
    }
    if (!firstSrc) continue
    deps.push({
      from: allImports[firstSrc]?.[0]?.original || '',
      name: original,
      size: bytesInOutput,
    })
  }
  const findParent = (pkgFrom?: string) => {
    if (!pkgFrom || output[pkgFrom]) return pkgFrom
    return findParent(deps.find(({ name }) => name === pkgFrom)?.from)
  }
  for (const pkg of deps) {
    const parent = output[findParent(pkg.from)!]
    if (!parent) continue
    parent.dependencies.push(pkg)
    parent.totalSize += pkg.size
  }
  const totalPkg = Object.values(output).reduce((a, b) => a + b.totalSize, 0)
  const compressedPct = percent(1 - compressed.length / bytes)
  const pkgText = totalPkg
    ? `\n  from-packages: ${toUnits(totalPkg)} ${percent(totalPkg / bytes)}`
    : ''

  console.log(`
${toUnits(bytes)} ${entryPoint}
${toUnits(compressed.length)} ${cyan(outfile)} ${compressedPct}${pkgText}`)

  const entries = Object.entries(output)
    .sort(([_, a], [__, b]) => b.totalSize - a.totalSize)

  for (const [dep, { path, size, files, dependencies }] of entries) {
    const prefix = path.includes('/registry.npmjs.org/') ? gray('npm:') : ''
    const totalSize = dependencies.reduce(
      (total, pkg) => total + pkg.size,
      size,
    )

    const depNames = `(${dependencies.map((pkg) => pkg.name).join(', ')})`
      .replace('()', '')

    const pkgName = [blue(dep.replace('npm:', '')), gray(depNames)].join(' ')
      .trim()

    console.log(`\n  ${toUnits(totalSize)} ${prefix}${pkgName}`)
    for (const file of files) console.log(`    ${file}`)
  }
}
// Bundle CSS and inject into HTML
const cssResult = await build({
  entryPoints: ['web/assets/styles/style.css'],
  bundle: true,
  minify: true,
  write: false,
})
const css = new TextDecoder().decode(cssResult.outputFiles[0].contents)
const html = Deno.readTextFileSync('web/index.html')
  .replace(
    '<link rel="stylesheet" href="assets/styles/style.css" />',
    `<style>${css}</style>`,
  )
Deno.writeTextFileSync(`${outdir}/index.html`, html)

console.log('\nduration:', `${yellow(String((Date.now() - start) / 1000))}s`)
