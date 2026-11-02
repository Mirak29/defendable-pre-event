// Demo data of the brief (§3), used everywhere in a consistent way.
// Texts are taken verbatim from the Claude Design prototype (R4, C2).
import type {
  AiTrace,
  AssessmentSpec,
  CandidateResults,
  Method,
  TestCase,
  TestStep,
} from '/web/types.ts'

const SUPER = { model: 'Nemotron 3 Super', where: 'build.nvidia.com' }
const NANO = { model: 'Nemotron 3 Nano', where: 'NVIDIA Brev (GPU)' }

// AI traces of the demo, values of the prototype
export const demoTraces = {
  prefill: {
    ...SUPER,
    latencyMs: 2300,
    tokensIn: 214,
    tokensOut: 96,
    at: '2026-09-22T10:12:41',
  },
  needAnalysis: {
    ...SUPER,
    latencyMs: 3100,
    tokensIn: 412,
    tokensOut: 380,
    at: '2026-09-22T10:14:02',
  },
  testsGeneration: {
    ...SUPER,
    latencyMs: 5600,
    tokensIn: 6530,
    tokensOut: 4205,
    at: '2026-09-22T10:14:15',
  },
  generation: {
    ...SUPER,
    latencyMs: 4200,
    tokensIn: 1842,
    tokensOut: 6120,
    at: '2026-09-22T10:14:08',
  },
  analysis: {
    ...NANO,
    latencyMs: 6400,
    tokensIn: 5902,
    tokensOut: 1870,
    at: '2026-09-22T16:48:12',
  },
  assistant: {
    ...NANO,
    latencyMs: 1100,
    tokensIn: 214,
    tokensOut: 168,
    at: '2026-09-23T11:02:37',
  },
  replay: {
    ...SUPER,
    latencyMs: 100,
    tokensIn: 1842,
    tokensOut: 6120,
    at: '2026-09-22T10:14:08',
    replay: true,
  },
} satisfies Record<string, AiTrace>

export const demoJobDescription =
  'Nous recrutons un·e développeur·se backend TypeScript de niveau intermédiaire pour notre service de liens marketing. Il ou elle conçoit des API REST, valide les données entrantes, gère proprement les erreurs et écrit des tests. Une expérience PostgreSQL est appréciée.'

export const skillCatalog = [
  'Conception d’API REST',
  'Validation des données',
  'Gestion des erreurs',
  'Tests automatisés',
  'PostgreSQL',
  'Performance',
  'Sécurité applicative',
  'Systèmes distribués',
  'Architecture du code',
  'Git',
] as const

// How each catalog skill can be evaluated in a Deno HTTP API exercise
// (R2 "Aperçu du cadrage"). Unknown skills fall back to Questions.
export const skillMethods: Record<string, Method[]> = {
  'Conception d’API REST': ['Tests', 'Questions'],
  'Validation des données': ['Tests', 'Analyse du code'],
  'Gestion des erreurs': ['Tests'],
  'Tests automatisés': ['Analyse du code'],
  'PostgreSQL': ['Questions'],
  'Performance': ['Analyse du code', 'Questions'],
  'Sécurité applicative': ['Tests', 'Analyse du code'],
  'Systèmes distribués': ['Questions'],
  'Architecture du code': ['Analyse du code'],
  'Git': ['Questions'],
}

export const demoPrefilledSkills = skillCatalog.slice(0, 5)

const s = (request: string, response: string): TestStep => ({
  request,
  response,
})
const LINK = 'POST /links {"url":"https://example.com","alias":"promo"}'

const tests: TestCase[] = [
  {
    id: 'T1',
    title: 'Crée un lien avec alias',
    route: 'POST /links',
    condition: 'avec l’alias “promo”',
    expected: '201',
    visibility: 'public',
    requirementIds: ['R1'],
    steps: [s(LINK, '201 · {"alias":"promo","url":"https://example.com"}')],
  },
  {
    id: 'T2',
    title: 'Crée un lien sans alias, alias généré',
    route: 'POST /links',
    condition: 'sans alias, alias généré',
    expected: '201',
    visibility: 'public',
    requirementIds: ['R1'],
    steps: [
      s(
        'POST /links {"url":"https://example.com"}',
        '201 · alias : chaîne non vide',
      ),
    ],
  },
  {
    id: 'T3',
    title: 'Redirige vers l’URL d’origine',
    route: 'GET /promo',
    condition: 'après création',
    expected: '302 + Location',
    visibility: 'public',
    requirementIds: ['R2'],
    steps: [
      s(LINK, '201'),
      s('GET /promo', '302 · Location: https://example.com'),
    ],
  },
  {
    id: 'T4',
    title: 'Alias inconnu',
    route: 'GET /inconnu',
    condition: 'sans lien créé',
    expected: '404',
    visibility: 'public',
    requirementIds: ['R5'],
    steps: [s('GET /inconnu', '404')],
  },
  {
    id: 'T5',
    title: 'Alias déjà utilisé',
    route: 'POST /links',
    condition: 'deux fois avec l’alias “promo”',
    expected: '409',
    visibility: 'public',
    requirementIds: ['R4'],
    steps: [
      s('POST /links {"url":"https://a.com","alias":"promo"}', '201'),
      s('POST /links {"url":"https://b.com","alias":"promo"}', '409'),
    ],
  },
  {
    id: 'T6',
    title: 'Corps sans champ url',
    route: 'POST /links',
    condition: 'sans champ url',
    expected: '400',
    visibility: 'public',
    requirementIds: ['R1'],
    steps: [s('POST /links {"alias":"vide"}', '400')],
  },
  {
    id: 'T7',
    title: 'Les statistiques comptent les redirections',
    route: 'GET /links/promo/stats',
    condition: 'après deux GET /promo',
    expected: 'clicks = 2',
    visibility: 'public',
    requirementIds: ['R6'],
    steps: [
      s(LINK, '201'),
      s('GET /promo (×2)', '302'),
      s('GET /links/promo/stats', '200 · {"clicks":2}'),
    ],
  },
  {
    id: 'T8',
    title: 'Supprime un lien',
    route: 'DELETE /links/promo',
    condition: 'puis GET /promo',
    expected: '204, puis 404',
    visibility: 'public',
    requirementIds: ['R5', 'R1'],
    steps: [
      s(LINK, '201'),
      s('DELETE /links/promo', '204'),
      s('GET /promo', '404'),
    ],
  },
  {
    id: 'T9',
    title: 'Refuse une URL « javascript: »',
    route: 'POST /links',
    condition: 'avec une URL “javascript:”',
    expected: '400',
    visibility: 'caché',
    requirementIds: ['R3'],
    steps: [
      s('POST /links {"url":"javascript:alert(1)","alias":"t9"}', '400'),
    ],
  },
  {
    id: 'T10',
    title: 'Alias de plus de 32 caractères',
    route: 'POST /links',
    condition: 'avec un alias de 33 caractères',
    expected: '400',
    visibility: 'caché',
    requirementIds: ['R1'],
    steps: [
      s(
        'POST /links {"url":"https://example.com","alias":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
        '400',
      ),
    ],
  },
  {
    id: 'T11',
    title: 'Statistiques d’un alias inconnu',
    route: 'GET /links/inconnu/stats',
    condition: 'sans lien créé',
    expected: '404',
    visibility: 'caché',
    requirementIds: ['R5'],
    steps: [s('GET /links/inconnu/stats', '404')],
  },
]

export const demoAssessment: AssessmentSpec = {
  title: 'Service de liens courts pour campagnes marketing',
  company: 'Linkly',
  format: 'API HTTP en TypeScript (Deno)',
  durationMin: 90,
  level: 'intermediate',
  jobDescription: demoJobDescription,
  context:
    'Linkly aide les équipes marketing à diffuser des liens courts dans leurs campagnes. Vous rejoignez l’équipe backend et reprenez le service qui crée ces liens, redirige les visiteurs et compte les clics.',
  mission:
    'Votre mission : implémenter l’API HTTP décrite ci-dessous, avec vos propres tests.',
  candidateBrief: {
    context:
      'Linkly fournit aux équipes marketing des liens courts pour leurs campagnes. Chaque lien redirige vers une page d’atterrissage et compte ses clics.',
    mission:
      'Implémentez l’API HTTP du service en TypeScript avec Deno. Un stockage en mémoire suffit.',
  },
  constraints: [
    'Pas de base de données : stockage en mémoire.',
    'Aucune dépendance externe hors celles de deno.json.',
    'Alias de 32 caractères maximum : lettres, chiffres, « - » et « _ ».',
    'Réponses au format JSON, sauf redirection et suppression.',
  ],
  routes: [
    {
      method: 'POST',
      path: '/links',
      description: 'Créer un lien, alias facultatif',
      codes: [201, 400, 409],
    },
    {
      method: 'GET',
      path: '/:alias',
      description: 'Redirection',
      codes: [302, 404],
    },
    {
      method: 'GET',
      path: '/links/:alias/stats',
      description: 'Nombre de clics',
      codes: [200, 404],
    },
    {
      method: 'DELETE',
      path: '/links/:alias',
      description: 'Supprimer un lien',
      codes: [204, 404],
    },
  ],
  requirements: [
    {
      id: 'R1',
      title: 'Créer un lien court',
      statement:
        'POST /links crée un lien et renvoie 201. L’alias est facultatif : il est généré s’il est absent.',
      why:
        'c’est le cœur du service ; teste la conception d’une route de création et les codes de statut.',
      skills: ['API REST'],
    },
    {
      id: 'R2',
      title: 'Rediriger vers l’URL d’origine',
      statement: 'GET /:alias répond 302 avec l’en-tête Location.',
      why: 'vérifie la maîtrise des redirections HTTP.',
      skills: ['API REST'],
    },
    {
      id: 'R3',
      title: 'N’accepter que des URL http ou https',
      statement: 'Toute autre URL est refusée avec un 400.',
      why:
        'un service de redirection qui accepte n’importe quel schéma expose ses utilisateurs à des liens malveillants.',
      skills: ['Validation des données', 'Sécurité'],
    },
    {
      id: 'R4',
      title: 'Refuser un alias déjà utilisé (409)',
      statement:
        'Une création avec un alias existant renvoie 409 et ne modifie pas le lien existant.',
      why: 'teste une contrainte d’unicité métier.',
      skills: ['Validation', 'Gestion des erreurs'],
    },
    {
      id: 'R5',
      title: 'Répondre 404 pour un alias inconnu',
      statement:
        'Redirection, statistiques et suppression renvoient 404 si l’alias n’existe pas.',
      why: 'cas limite classique d’une API.',
      skills: ['Gestion des erreurs'],
    },
    {
      id: 'R6',
      title: 'Compter les clics',
      statement:
        'Chaque redirection incrémente le compteur exposé par GET /links/:alias/stats.',
      why: 'un état qui évolue ; teste la cohérence des données.',
      skills: ['API REST', 'Tests'],
    },
  ],
  skills: [
    {
      name: 'Conception d’API REST',
      importance: 'haute',
      methods: ['Tests', 'Questions'],
      justification:
        'Quatre routes à concevoir, avec des codes de statut précis.',
    },
    {
      name: 'Validation des données',
      importance: 'haute',
      methods: ['Tests', 'Analyse du code'],
      justification:
        'Le service reçoit des URL et des alias fournis par des tiers.',
    },
    {
      name: 'Gestion des erreurs',
      importance: 'moyenne',
      methods: ['Tests'],
      justification: 'Plusieurs cas limites attendus : 400, 404 et 409.',
    },
    {
      name: 'Tests automatisés',
      importance: 'moyenne',
      methods: ['Analyse du code'],
      justification:
        'L’offre demande d’écrire des tests ; ceux du candidat sont analysés.',
    },
    {
      name: 'PostgreSQL',
      importance: 'basse',
      methods: ['Questions'],
      justification:
        'Mentionnée comme appréciée dans l’offre. Évalué par des questions : l’environnement n’a pas de base de données.',
    },
  ],
  tests,
}

export const demoCandidate = {
  pseudonym: 'Candidat A7F3', // never a real name
  token: 'demo-a7f3',
  declaredAiTools: ['ChatGPT', 'GitHub Copilot'],
}

const passed = (id: string, durationMs: number) => ({
  id,
  passed: true,
  durationMs,
})

export const demoResults: CandidateResults = {
  publicTests: [
    passed('T1', 12),
    passed('T2', 9),
    passed('T3', 8),
    passed('T4', 5),
    passed('T5', 11),
    passed('T6', 4),
    passed('T7', 14),
    passed('T8', 10),
  ],
  hiddenTests: [
    {
      id: 'T9',
      passed: false,
      durationMs: 6,
      expected: '400',
      received: '201',
      request: 'POST /links {"url":"javascript:alert(1)","alias":"t9"}',
    },
    passed('T10', 5),
    passed('T11', 4),
  ],
  ownTests: { passed: 6, total: 6, runs: 9 },
  typeErrors: 0,
  buildMinutes: 72,
  questionsMinutes: 17,
}
