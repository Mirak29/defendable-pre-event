import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader'
import type { BuildOptions } from 'npm:esbuild@0.25.5'
// check to update to 25.6 once @luca/esbuild-deno-loader use the newer
// build type

export const config: BuildOptions = {
  entryPoints: { index: 'web/app.tsx' },
  plugins: [...denoPlugins()],
  format: 'esm',
  bundle: true,
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  outdir: 'dist',
} as const
