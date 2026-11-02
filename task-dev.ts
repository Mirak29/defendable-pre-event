import { config } from './build-config.ts'
import { context } from 'npm:esbuild'
import api from '/api/server.ts'

const ctx = await context({
  ...config,
  entryPoints: { ...config.entryPoints, index: 'web/debug-app.ts' },
  sourcemap: 'both',
})

await ctx.watch()

Deno.mkdirSync('dist', { recursive: true })
Deno.copyFileSync('web/index.html', 'dist/index.html')

Deno.mkdirSync('dist/assets/styles', { recursive: true })
for (const entry of Deno.readDirSync('web/assets/styles')) {
  if (entry.isFile && entry.name.endsWith('.css')) {
    Deno.copyFileSync(
      `web/assets/styles/${entry.name}`,
      `dist/assets/styles/${entry.name}`,
    )
  }
}
const { port } = await ctx.serve({ servedir: 'dist', port: 7575 })

const getForwaredPath = (path: string) => {
  if (path === '/esbuild') return path // server event for live reload
  if (path.includes('.')) return path
  return '/'
}

const generateTestCoverage = new Deno.Command('deno', {
  args: ['test', '--no-check', '--coverage=dist/.cov', '--reporter=dot'],
})

const generateCoverageHTML = new Deno.Command('deno', {
  args: ['coverage', '--html', 'dist/.cov'],
})

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api')) return api.fetch(request)
    if (url.pathname.startsWith('/.cov') && url.pathname.length < 11) {
      return new Response(null, {
        status: 301,
        headers: { location: '/.cov/html/index.html' },
      })
    }
    if (url.pathname === '/.cov/html/index.html') {
      await generateTestCoverage.spawn().status
      await generateCoverageHTML.spawn().status
    }
    const pathname = getForwaredPath(url.pathname)
    const apiUrl = `http://localhost:${port}${pathname}${url.hash}${url.search}`
    const { headers, method, signal, body } = request
    return fetch(apiUrl, { headers, method, signal, body, redirect: 'manual' })
  },
}
