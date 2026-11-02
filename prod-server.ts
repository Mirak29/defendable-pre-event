import api from './api/server.ts'
import { serveDir } from 'jsr:@std/http/file-server'
import { BASE_URL } from '/api/lib/env.ts'
import { log } from '/api/lib/log.ts'
import { ensureDemoData } from '/fixtures/seed.ts'

// SEED_DEMO=1 (the Docker image): the demo space always has the assessment of
// the brief and its report, even on a fresh volume
if (Deno.env.get('SEED_DEMO') === '1') {
  const { assessmentId, englishAssessmentId, seeded } = ensureDemoData()
  log.info('demo-data', { assessmentId, englishAssessmentId, seeded })
}

// DIST_DIR: the folder built by task-prod.ts (QA: dist-qa), default dist
const dist = `${import.meta.dirname}/${Deno.env.get('DIST_DIR') || 'dist'}`
const html = Deno.readTextFileSync(`${dist}/index.html`)
  .replace(
    '<base href="/" />',
    `<base href="${BASE_URL}" />`,
  )
const encoder = new TextEncoder()
const indexHtml = encoder.encode(html)
const port = Number(Deno.env.get('PORT')) || 8000
const serveDirOpts = { fsRoot: dist }
const htmlContent = { headers: { 'Content-Type': 'text/html' } }
Deno.serve({ port }, (req) => {
  const { pathname } = new URL(req.url)

  if (pathname.startsWith('/api/')) {
    return api.fetch(req)
  }

  if (pathname.includes('.')) {
    return serveDir(req, serveDirOpts)
  }

  return new Response(indexHtml, htmlContent)
})
