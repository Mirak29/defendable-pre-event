# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

Defendable: a developer assessment platform for the AI era (hackathon
prototype). A recruiter generates an assessment from a job description; the
candidate builds a Deno HTTP API using AI freely, then answers 10 questions
generated from their own code in a locked phase; the recruiter reads a report
that separates verified facts from AI interpretations, with no global score. The
UI is in French (vouvoiement); code, comments and identifiers are in English.

References, read them before a task:

- **Architecture reference: `../tournament`** (01-edu). Every pattern here is
  copied from it (build, API, DB, router, UI primitives, studio editor). Look
  there first before inventing a new pattern.
- **Product reference: `C:\Users\abdou\Downloads\Brief Hack GMC`**: the brief
  (`uploads/prompt-claude-design.md`, screens, demo data, forbidden features)
  and the Claude Design prototype (`*.dc.html`). Texts and demo data are taken
  verbatim from them. The `_ds/nocturne-*` design system is not used.
- Task plan (T0…T7), progress and decisions: `PLAN.md`. Update its « Avancement
  » table when a phase is done.

## Workflow

Never push to `master`: each pass is a branch and a pull request. The
`.githooks/pre-push` hook (enabled with `git config core.hooksPath .githooks`)
refuses direct pushes to `master`.

## Commands

Deno only (no Node, no npm scripts).

```bash
deno task seed        # reset defendable.db with the demo assessment + candidate
deno task dev         # dev server on :8000 + tests, fmt and lint in watch mode
deno task test        # all tests (.env-test, in-memory SQLite)
deno test --env-file=.env-test -A --no-check web/lib/format.test.js   # one file
deno test --env-file=.env-test -A --no-check --filter "assessment checks"  # one test
deno task check       # type-check (pass entry points: deno check web/app.tsx api/server.ts)
deno task lint
deno task fmt         # single quotes, no semicolons, 80 cols
deno task prod        # minified build (task-prod.ts) + prod-server.ts
deno task qa:serve    # QA server: prod build in dist-qa/, port 8100, qa.db, no AI key
deno task qa          # Puppeteer end-to-end tests (qa/), needs qa:serve running
deno task qa:single QA-2
deno task qa:audit    # accessibility + responsive audit of every screen
```

`deno task seed` cannot delete `defendable.db` while the dev server holds it
(Windows): stop the server first. `task-dev.ts` copies `web/index.html` and
`web/assets/styles/*.css` into `dist/` only at startup: restart the dev server
after editing them. `@01edu/db` reads `DATABASE_PATH` itself, so keep it set in
the `.env-*` files.

## Architecture

- **Server** (`api/`): `server.ts` wraps `routeHandler` from `routes.ts`, where
  every endpoint is a `route({ fn, input, output, description })` keyed
  `'METHOD/api/path'` with `@01edu/api/validator` schemas. `schema.ts` runs
  `migrations/NNN-migration.js` then declares tables with `createTable` and the
  event log with `initEntries` (entry type ids in `entries.ts`). The web client
  is typed from `RouteDefinitions` (`web/lib/api.ts`).
- **Web** (`web/`): Preact + `@preact/signals`, routing by
  `@01edu/signal-router` (`url.path`, `url.params`, `navigate`, `<A>`).
  `app.tsx` maps paths to pages; every URL lives in `web/paths.ts` (two
  symmetric spaces `/recruiter/…` and `/candidate/…`, ids in the query string),
  never hard-code a path. `web/screens.ts` lists the screens of the brief;
  `fullscreen` ones (workspace, rules, questions) hide the top bar and are
  wrapped in `DesktopOnly` (≥ 1280 px).
- **Domain (api/)**: `assessment.ts` (R1–R5: 4-step generation job,
  regeneration, approval), `candidate.ts` (C1–C7: cookie session
  `dfd_candidate`, server clock and auto-submission, files, runs, answers,
  assistant, integrity), `analysis.ts` (C4 job: hidden tests, code analysis, 10
  questions), `report.ts` (R6 job and human decision), `reference.ts` (R3 step
  4: a reference solution written from the candidate brief only runs the
  evaluation tests; unfair tests are excluded, remaining failures block
  approval). Long jobs run in the background, store their `Progress` on the row
  and insert entries (`*_STEP`, `CANDIDATE_REPORT_READY`…) that `GET/api/events`
  forwards; the page refetches (`web/lib/events.ts`, tournament's `onEvent`).
- **Sandbox** (`api/sandbox.ts`): candidate code runs in a `deno` subprocess
  (temp dir, deny net/env/run/write, `--cached-only`, 10 s, 64 KB, queue of 2).
  Evaluation tests are readable steps (`api/test-steps.ts`: `"POST /links {…}"`
  → `"201 · {…}"`) run against `handler(req)` of `src/app.ts`, one fresh worker
  per test. Prediction QCMs are checked by executing their requests
  (`probeRequests`).
- **AI** (`api/llm.ts`): `ask({ task, tier, system, prompt, parse, demo })`,
  tiers chosen on measurements (README): `precise` = Nemotron 3 Ultra (every
  heavy step), `super` = Nemotron 3 Super (fallback, prefill, assistant, double
  keys), `nano` = Lightning (unused until served on Brev); JSON mode; every
  failed attempt is kept with a readable reason (`AiFailure` on traces, progress
  and errors, shown under « Pourquoi ? »); model claims about the API behaviour
  carry a `proof` run in the sandbox (`refuteProofs`); main model → fallback
  model → replay cache (`fixtures/replay-cache/`, or the `demo` answer of the
  brief). Without `NVIDIA_API_KEY` everything replays (grey badges). Every model
  answer goes through a `parse` validator (`api/lib/check.ts`); citations are
  checked against the real code and discarded when unverifiable.
- **State (web/)**: module-level signals over `api[...]` (tournament's
  api-client): `web/lib/assessment-store.ts` (followed assessment = `?id=`),
  `web/lib/candidate-store.ts` (session `me`, `serverNow`),
  `web/lib/report-store.ts` (`?candidate=`),
  `web/pages/workspace/workspace-state.ts` (auto-save, `deno check`, runs),
  `web/pages/questions/questions-state.ts`. Pages never hold server data
  themselves.
- **Shared code**: `web/types.ts` and `web/lib/assessment-checks.ts` are used by
  the API too; the web only imports _types_ from `api/`.
- **Demo data**: `fixtures/demo.ts` (assessment, tests, results, AI traces),
  `fixtures/demo-files.ts` (candidate files, extracted from the prototype),
  `fixtures/questions.ts`, `fixtures/report.ts`. `task-db-seed.ts` stores them
  (approved Linkly assessment, finished "Candidat A7F3"); they are also the
  `demo` answers of the replay cache. Tests check they stay consistent with the
  brief (cited line ranges must point at the right code). `api/journey.test.js`
  plays the whole journey on the real routes.
- **Prototype states** are reachable through query params rather than hidden:
  `?etat=vide` (R1), `?etat=repli|echec` (R2), `?variante=echec` (R4),
  `?sortie=timeout|tronquee|import|erreur` and `?soumission=expire` (C2),
  `?etat=pret` (C4), `?etat=30s|sortie|plein-ecran|expire|collage` (C6). Guided
  demo: state in `web/lib/demo.ts`, floating panel in `web/ui/demo-panel.tsx`
  (step per route; « Étape suivante » calls the same exported action as the
  screen's main button, e.g. `beginBuild`, `submitDeclaration`,
  `beginQuestions`, so keep those exported when editing a screen).
- **Workspace editor**: CodeJar (`web/vendor/codejar`) wired like tournament's
  studio; syntax colors and the type-error underline use the CSS Custom
  Highlight API (`web/lib/code-highlight.ts` + `::highlight()` rules in
  `style.css`), fed by `web/lib/code-tokens.ts`, the same tokenizer as the
  read-only `CodeView`.

## QA

`qa/` mirrors tournament's QA (declarative steps in `qa/lib/commands.ts`,
`qa/tests-definitions/QA-X.ts`, seeded data `qa/tests-data/QA-X.json` via
`fixtures/seed.ts`). Selectors are `data-test="…"` attributes: keep them when
editing a screen of the journey. The QA server replays the AI answers, so the
journey is deterministic.

## Styling rules (Twind)

- Styles go in the `tw` prop. Colors are semantic tokens from `web/theme.ts`
  (`surface-*`, `content-*`, `border-*`, `accent`, `ok/err/warn`, `ai`, `hl`,
  `code-*`) built with `light-dark()`, so dark mode follows `color-scheme` and
  needs no `dark:` variants. Violet (`ai*`) is reserved for what the AI produces
  or interprets; every status shows an icon and a label.
- This Twind (`@twind/preact`, same as tournament) is not Tailwind v3. These
  generate nothing: arbitrary properties (`[tab-size:2]`), `grid-cols-[…]`,
  `decoration-*`, `underline-offset-*`, `scroll-mt-*`, `max-h-none`,
  `opacity-45`. Use named grid templates from `theme.extend.gridTemplateColumns`
  in `app.tsx`, inline `style` for odd properties, `opacity-[.45]`-like values.
  Unknown class names in `tw` are dropped: pass plain CSS classes via `class`.
- Never build JSX at module level: `h` only becomes global when `app.tsx` runs.
- Fonts (from wurus.app): Unbounded for `h1/h2` (`font-display`), Bricolage
  Grotesque for text (`font-main`), Space Mono for labels and code
  (`font-mono`), Nasalization for the DEFENDABLE wordmark (`font-brand`).
- Icons are inline Lucide 0.469.0 SVGs in `web/assets/icons.tsx`, generated from
  `lucide-static`; add new ones there, keep the list sorted.
