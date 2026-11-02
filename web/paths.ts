// Every route of the app, in one place: pages never hard-code a URL.
// Two symmetric spaces, /recruiter/… and /candidate/…; ids stay in the
// query string (?id=, ?q=) like tournament's signal-router routes.
export const paths = {
  home: '/', // S0
  // sections of the landing: same page, one clean URL each (no #hash)
  principle: '/principe',
  how: '/comment-ca-marche',
  forCandidates: '/pour-les-candidats',
  faq: '/faq',
  login: '/login', // company space: sign in (U3)
  signup: '/signup', // company space: create a company (U3)
  recruiter: '/recruiter', // R1 Mes épreuves
  newAssessment: '/recruiter/new', // R2 + R3 génération
  review: '/recruiter/review', // R4 ?id=
  assessment: '/recruiter/assessment', // R5 ?id=
  report: '/recruiter/report', // R6 ?id=
  candidate: '/candidate', // C1 accueil et consentement
  workspace: '/candidate/workspace', // C2 + C3 soumission
  rules: '/candidate/rules', // C4
  questions: '/candidate/questions', // C5 / C6 ?q=
  done: '/candidate/done', // C7
  components: '/dev/components', // planche de composants
} as const

export const isCandidatePath = (path: string) =>
  path === paths.candidate || path.startsWith(`${paths.candidate}/`)

export const isRecruiterPath = (path: string) =>
  path === paths.recruiter || path.startsWith(`${paths.recruiter}/`)
