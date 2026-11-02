import { paths } from '/web/paths.ts'
// Screens of the brief (§4), in the order of the clickable journey (§7.5).
// `fullscreen` screens hide the global top bar (workspace and questions).
export type Screen = {
  space: 'public' | 'recruiter' | 'candidate'
  code: string
  title: string
  path: string
  prototype: string
  task: string
  fullscreen?: boolean
}

export const screens: Screen[] = [
  {
    space: 'public',
    code: 'S0',
    title: 'Accueil',
    path: paths.home,
    prototype: 'S0-Accueil.dc.html',
    task: 'U1',
  },
  {
    space: 'recruiter',
    code: 'R1',
    title: 'Mes épreuves',
    path: paths.recruiter,
    prototype: 'R1-Mes-epreuves.dc.html',
    task: 'T2.2',
  },
  {
    space: 'recruiter',
    code: 'R2',
    title: 'Nouvelle épreuve',
    path: paths.newAssessment,
    prototype: 'R2-Nouvelle-epreuve.dc.html',
    task: 'T2.3',
  },
  {
    space: 'recruiter',
    code: 'R4',
    title: 'Revue et validation de l’épreuve',
    path: paths.review,
    prototype: 'R4-Revue.dc.html',
    task: 'T2.6',
  },
  {
    space: 'recruiter',
    code: 'R5',
    title: 'Épreuve approuvée',
    path: paths.assessment,
    prototype: 'R5-Epreuve-approuvee.dc.html',
    task: 'T2.10',
  },
  {
    space: 'candidate',
    code: 'C1',
    title: 'Accueil candidat et consentement',
    path: paths.candidate,
    prototype: 'C1-Consentement.dc.html',
    task: 'T3.1',
  },
  {
    space: 'candidate',
    code: 'C2',
    title: 'Workspace',
    path: paths.workspace,
    prototype: 'C2-Workspace.dc.html',
    task: 'T3.2',
    fullscreen: true,
  },
  {
    space: 'candidate',
    code: 'C4',
    title: 'Règles de la phase de questions',
    path: paths.rules,
    prototype: 'C4-Regles-questions.dc.html',
    task: 'T3.8',
    fullscreen: true,
  },
  {
    space: 'candidate',
    code: 'C5',
    title: 'Questions',
    path: paths.questions,
    prototype: 'C5-QCM.dc.html',
    task: 'T3.9',
    fullscreen: true,
  },
  {
    space: 'candidate',
    code: 'C7',
    title: 'Fin',
    path: paths.done,
    prototype: 'C7-Fin.dc.html',
    task: 'T3.13',
  },
  {
    space: 'recruiter',
    code: 'R6',
    title: 'Rapport d’évaluation',
    path: paths.report,
    prototype: 'R6-Rapport.dc.html',
    task: 'T4.1',
  },
  {
    space: 'public',
    code: 'UI',
    title: 'Planche de composants',
    path: paths.components,
    prototype: 'Composants.dc.html',
    task: 'T1.9',
  },
]
