import {
  Check,
  CodeXml,
  FileSearch,
  FileText,
  MessagesSquare,
  ShieldCheck,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

// functions: the texts follow the language
const steps = () => [
  {
    icon: FileText,
    title: t('Une offre. Une épreuve.', 'One job offer. One assessment.'),
    text: t(
      'L’IA prépare une mission et des tests depuis votre offre. Une solution de référence les éprouve en bac à sable avant votre validation.',
      'AI prepares a task and its tests from your job offer. A reference solution tries them in a sandbox before you approve them.',
    ),
  },
  {
    icon: CodeXml,
    title: t('Coder, avec son IA.', 'Code, with their AI.'),
    text: t(
      'Le candidat construit son API dans un environnement dédié. Les outils d’IA sont autorisés et leur usage est déclaré.',
      'Candidates build their API in a dedicated environment. AI tools are allowed and their use is declared.',
    ),
  },
  {
    icon: MessagesSquare,
    title: t('Défendre ses choix.', 'Defend their choices.'),
    text: t(
      '10 questions tirées de son propre code, sans aide : prédictions, compréhension et réponses libres.',
      '10 questions drawn from their own code, without help: predictions, understanding and open answers.',
    ),
  },
  {
    icon: FileSearch,
    title: t('Décider, avec des faits.', 'Decide, with facts.'),
    text: t(
      'Exécutions, réponses et points à discuter se retrouvent dans un rapport. Vous conduisez l’entretien, vous prenez la décision.',
      'Runs, answers and points to discuss end up in a report. You lead the interview, you make the decision.',
    ),
  },
]

const faq = () => [
  [
    t(
      'Le candidat peut-il utiliser ChatGPT ?',
      'Can the candidate use ChatGPT?',
    ),
    t(
      'Oui, pendant la construction. L’usage de l’IA est autorisé et déclaré. La phase de questions se déroule ensuite sans aide, sur le code soumis.',
      'Yes, while building. The use of AI is allowed and declared. The question phase then takes place without help, on the submitted code.',
    ),
  ],
  [
    t(
      'Comment savez-vous que la réponse est fausse ?',
      'How do you know an answer is wrong?',
    ),
    t(
      'Les comportements exécutables sont confrontés à des tests dans le bac à sable. Les interprétations de l’IA et les contradictions à discuter restent présentées séparément des faits vérifiés. Une seconde clé contribue à vérifier les réponses.',
      'Executable behaviours are checked against tests in the sandbox. AI interpretations and contradictions to discuss stay apart from verified facts. A second key helps check the answers.',
    ),
  ],
  [
    t('Pourquoi pas de score ?', 'Why no score?'),
    t(
      'Un score résume trop vite ce qui mérite une conversation. Le rapport présente des indicateurs par compétence, les réponses et les preuves. La décision de recrutement vous appartient.',
      'A score sums up too quickly what deserves a conversation. The report shows indicators per skill, the answers and the evidence. The hiring decision is yours.',
    ),
  ],
  [
    t('Quelles données sont conservées ?', 'What data is kept?'),
    t(
      'Le code, les exécutions, les réponses, l’usage déclaré de l’IA et les événements d’intégrité tels que les sorties de page. Aucune webcam, aucun microphone et aucun enregistrement d’écran.',
      'The code, the runs, the answers, the declared use of AI and integrity events such as leaving the page. No webcam, no microphone and no screen recording.',
    ),
  ],
  [
    t(
      'Combien de temps dure une épreuve ?',
      'How long does an assessment take?',
    ),
    t(
      'Le recruteur choisit 60, 90 ou 120 minutes pour la construction. Une phase de questions chronométrée suit la soumission du code.',
      'The recruiter picks 60, 90 or 120 minutes for building. A timed question phase follows the code submission.',
    ),
  ],
]

export const LandingSections = () => (
  <>
    <section
      id='principe'
      tabIndex={-1}
      class='landing-section'
      aria-labelledby='principle-title'
    >
      <p class='landing-eyebrow'>{t('01 / LE PRINCIPE', '01 / THE IDEA')}</p>
      <h2 id='principle-title'>
        {t('Le code ne prouve plus rien.', 'Code no longer proves anything.')}
        <br />
        <span tw='text-content-secondary'>
          {t('Sa compréhension, si.', 'Understanding it does.')}
        </span>
      </h2>
      <div tw='grid md:grid-cols-3 gap-6 mt-9'>
        {[
          t(
            'L’IA écrit une API en quelques minutes.',
            'AI writes an API in a few minutes.',
          ),
          t(
            'Le code livré seul ne suffit plus à évaluer la personne.',
            'Shipped code alone is no longer enough to assess a person.',
          ),
          t(
            'Autoriser l’IA permet d’évaluer le métier tel qu’il se pratique.',
            'Allowing AI assesses the job as it is really done.',
          ),
        ].map((text, i) => (
          <div key={i} tw='border-t border-border-strong pt-5'>
            <span tw='font-mono text-xs text-accent-text'>0{i + 1}</span>
            <p tw='text-lg mt-3 leading-relaxed'>{text}</p>
          </div>
        ))}
      </div>
    </section>
    <section
      id='comment'
      tabIndex={-1}
      class='landing-section'
      aria-labelledby='how-title'
    >
      <p class='landing-eyebrow'>
        {t('02 / COMMENT ÇA MARCHE', '02 / HOW IT WORKS')}
      </p>
      <h2 id='how-title'>
        {t('Un parcours. Des preuves.', 'One journey. Evidence.')}
        <br />
        {t('Une vraie conversation.', 'A real conversation.')}
      </h2>
      <ol tw='grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-9'>
        {steps().map(({ icon: Icon, title, text }, i) => (
          <li key={i} tw='card p-6'>
            <div tw='flex items-center justify-between mb-8'>
              <Icon tw='w-6 h-6 text-content-secondary' />
              <span tw='font-mono text-xs text-content-secondary'>
                0{i + 1}
              </span>
            </div>
            <h3 tw='font-semibold text-lg mb-3'>{title}</h3>
            <p tw='text-sm text-content-secondary leading-relaxed'>{text}</p>
          </li>
        ))}
      </ol>
    </section>
    <section
      class='landing-section landing-report'
      aria-labelledby='report-title'
    >
      <div>
        <p class='landing-eyebrow'>{t('03 / LE RAPPORT', '03 / THE REPORT')}</p>
        <h2 id='report-title'>
          {t('Ce qui est vérifié.', 'What is verified.')}
          <br />
          {t('Ce qui se discute.', 'What is up for discussion.')}
        </h2>
        <p tw='text-content-secondary leading-relaxed mt-5'>
          {t(
            'Des résultats d’exécution aux réponses du candidat, chaque élément garde sa nature. Les interprétations de l’IA sont identifiées pour nourrir votre entretien.',
            'From run results to the candidate’s answers, every item keeps its nature. AI interpretations are labelled to feed your interview.',
          )}
        </p>
        <p tw='font-semibold mt-6'>
          {t('Pas de note, pas de classement.', 'No grade, no ranking.')}
        </p>
      </div>
      <figure tw='card overflow-hidden'>
        <figcaption tw='px-6 py-4 border-b border-border-primary text-xs font-mono text-content-secondary'>
          {t('EXTRAIT ILLUSTRATIF · LINKLY', 'ILLUSTRATIVE EXCERPT · LINKLY')}
        </figcaption>
        <div tw='p-6'>
          <span tw='badge badge-neutral'>
            <Check tw='w-3 h-3' />
            {t('Fait vérifié', 'Verified fact')}
          </span>
          <h3 tw='text-lg font-semibold mt-4'>
            {t('Résultats d’exécution', 'Run results')}
          </h3>
          <div tw='mt-4 flex items-center justify-between gap-3 border-b border-border-primary pb-4 text-sm'>
            <span>{t('Tests publics exécutés', 'Public tests run')}</span>
            <strong tw='text-ok flex items-center gap-2'>
              <Check tw='w-4 h-4' />
              {t('8 / 8 réussis', '8 / 8 passed')}
            </strong>
          </div>
          <div tw='mt-5 rounded-lg border border-ai-line bg-ai-soft p-4'>
            <span tw='text-ai text-xs font-mono'>
              ✦ {t('INTERPRÉTATION IA', 'AI INTERPRETATION')}
            </span>
            <h3 tw='font-semibold mt-2'>
              {t('Contradiction à discuter', 'Contradiction to discuss')}
            </h3>
            <p tw='text-sm leading-relaxed mt-2'>
              {t(
                'Une réponse libre semble contredire le comportement du code. À reprendre avec le candidat en entretien.',
                'An open answer seems to contradict what the code does. To go over with the candidate in the interview.',
              )}
            </p>
          </div>
        </div>
      </figure>
    </section>
    <section
      id='candidats'
      tabIndex={-1}
      class='landing-section'
      aria-labelledby='candidate-title'
    >
      <p class='landing-eyebrow'>
        {t('04 / POUR LES CANDIDATS', '04 / FOR CANDIDATES')}
      </p>
      <h2 id='candidate-title'>
        {t('Votre code. Vos outils.', 'Your code. Your tools.')}
        <br />
        {t('Votre raisonnement.', 'Your reasoning.')}
      </h2>
      <div tw='grid md:grid-cols-2 gap-8 mt-8'>
        <div tw='text-content-secondary leading-relaxed'>
          <p>
            {t(
              'Pas de compte à créer : ouvrez le lien d’épreuve reçu. Utilisez l’IA pendant la construction, déclarez son usage, puis expliquez votre propre code sans aide.',
              'No account to create: open the assessment link you received. Use AI while building, declare its use, then explain your own code without help.',
            )}
          </p>
          <p tw='mt-4'>
            {t(
              'L’entreprise vous invite avec votre nom et votre e-mail, par un lien personnel. Votre identité n’est jamais envoyée aux modèles d’IA : ils ne voient que votre code et vos réponses.',
              'The company invites you by name and e-mail, through a personal link. Your identity is never sent to the AI models: they only see your code and your answers.',
            )}
          </p>
        </div>
        <div tw='card p-6'>
          <h3 tw='font-semibold flex items-center gap-2'>
            <ShieldCheck tw='w-5 h-5' />
            {t('Un cadre explicite', 'Clear rules')}
          </h3>
          <p tw='text-sm text-content-secondary mt-3 leading-relaxed'>
            {t(
              'Sont enregistrés : code, exécutions, réponses et événements de sortie de page.',
              'Recorded: code, runs, answers and page-leave events.',
            )}
          </p>
          <p tw='text-sm font-medium mt-3'>
            {t(
              'Jamais : webcam, microphone, enregistrement d’écran.',
              'Never: webcam, microphone, screen recording.',
            )}
          </p>
        </div>
      </div>
    </section>
    <section
      class='landing-guarantees'
      aria-label={t('Garanties', 'Guarantees')}
    >
      {[
        t('Code exécuté en bac à sable', 'Code run in a sandbox'),
        t('Tests jugés par le serveur', 'Tests judged by the server'),
        t('Interprétations identifiées', 'Interpretations labelled'),
        t('Décision toujours humaine', 'Always a human decision'),
      ].map((text, i) => (
        <p key={i} tw='flex items-center gap-3 text-sm'>
          <ShieldCheck tw='w-5 h-5 flex-none text-accent-text' />
          {text}
        </p>
      ))}
    </section>
    <section
      id='faq'
      tabIndex={-1}
      class='landing-section'
      aria-labelledby='faq-title'
    >
      <p class='landing-eyebrow'>
        {t('05 / VOS QUESTIONS', '05 / YOUR QUESTIONS')}
      </p>
      <h2 id='faq-title'>{t('Avant de commencer.', 'Before you start.')}</h2>
      <div tw='mt-8 max-w-[880px]'>
        {faq().map(([question, answer], i) => (
          <details key={i} tw='border-b border-border-primary py-5'>
            <summary tw='cursor-pointer font-semibold text-lg flex justify-between gap-4'>
              {question}
              <span class='faq-plus' aria-hidden='true'>+</span>
            </summary>
            <p tw='mt-4 text-content-secondary leading-relaxed max-w-[720px]'>
              {answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  </>
)
