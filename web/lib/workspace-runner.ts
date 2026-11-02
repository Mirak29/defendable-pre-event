// Console output states of the prototype, replayed by `?sortie=` (C2); real
// runs come from the Deno sandbox (api/sandbox.ts, workspace-state.ts).

export type OutputVariant =
  | 'normal'
  | 'timeout'
  | 'tronquee'
  | 'import'
  | 'erreur'

export type OutputLine = {
  text: string
  tone?: 'muted' | 'error' | 'ok' | 'warn' | 'indent-error'
}

export type RunOutput = {
  command: string
  lines: OutputLine[]
  status: { tone: 'ok' | 'warn' | 'error'; text: string; icon: string }
}

import { t } from '/web/lib/i18n.ts'

export const OUTPUT_LIMIT_KB = 64
export const RUN_TIMEOUT_S = 10

export const runPlayground = (variant: OutputVariant): RunOutput => {
  const command = '$ deno run playground.ts'
  switch (variant) {
    case 'timeout':
      return {
        command,
        lines: [{
          text: t(
            'Serveur à l’écoute sur http://localhost:8000/',
            'Server listening on http://localhost:8000/',
          ),
        }],
        status: {
          tone: 'warn',
          icon: 'timer-off',
          text: t(
            `Arrêté après ${RUN_TIMEOUT_S} s : le programme ne s’est pas terminé. Les serveurs et les boucles infinies sont interrompus.`,
            `Stopped after ${RUN_TIMEOUT_S} s: the program did not end. Servers and infinite loops are interrupted.`,
          ),
        },
      }
    case 'tronquee':
      return {
        command,
        lines: Array.from({ length: 8 }, (_, i) => ({
          text: `201 { alias: "lot-${
            4817 + i
          }", url: "https://example.com/campagne/${i}" }`,
        })),
        status: {
          tone: 'warn',
          icon: 'scissors',
          text: t(
            `Sortie tronquée à ${OUTPUT_LIMIT_KB} Ko`,
            `Output cut at ${OUTPUT_LIMIT_KB} KB`,
          ),
        },
      }
    case 'import':
      return {
        command,
        lines: [{
          text: 'import { nanoid } from "npm:nanoid";',
          tone: 'muted',
        }],
        status: {
          tone: 'warn',
          icon: 'package-x',
          text: t(
            'Import non autorisé : seules les dépendances listées dans deno.json sont disponibles hors ligne. Terminé en 0,2 s · code 1',
            'Import not allowed: only the dependencies listed in deno.json are available offline. Finished in 0.2 s · code 1',
          ),
        },
      }
    case 'erreur':
      return {
        command,
        lines: [
          {
            text:
              "error: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'url')",
            tone: 'error',
          },
          {
            text:
              'at parseCreateLink (file:///workspace/src/validation.ts:27:10)',
            tone: 'indent-error',
          },
          {
            text: 'at handler (file:///workspace/src/app.ts:25:19)',
            tone: 'indent-error',
          },
          {
            text: 'at file:///workspace/playground.ts:3:19',
            tone: 'indent-error',
          },
        ],
        status: {
          tone: 'error',
          icon: 'circle-x',
          text: t(
            'Erreur d’exécution · terminé en 0,3 s · code 1',
            'Runtime error · finished in 0.3 s · code 1',
          ),
        },
      }
    default:
      return {
        command,
        lines: [{
          text: '201 { alias: "promo", url: "https://example.com" }',
        }],
        status: {
          tone: 'ok',
          icon: 'circle-check',
          text: t('Terminé en 0,8 s · code 0', 'Finished in 0.8 s · code 0'),
        },
      }
  }
}
