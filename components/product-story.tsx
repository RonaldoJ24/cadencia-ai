import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { WeekExampleDemo } from '@/components/week-example';
import type { Locale } from '@/lib/routine';

const source = 'https://github.com/RonaldoJ24/cadencia-ai';

const COPY = {
  en: {
    kicker: 'Your intention, with room in the week',
    title: 'Give a goal',
    titleAccent: 'a rhythm.',
    lead: 'You want to learn something, write more, or practice consistently. Your week has other plans.',
    description:
      'Cadencia turns your intention into sessions that fit the time you have. If one session is missed, it looks for a way to continue within the same week.',
    start: 'Plan my week',
    entry: 'No sign-up · Start with an example',
    principle: 'The plan adapts to your time.',
    principleNote: 'What you already completed still counts.',
    notesKicker: 'The decisions behind the rhythm',
    notesTitle: 'A plan you can understand.',
    notesTitle2: 'And change.',
    notesLead:
      'An intention can be open-ended. Available days and minutes need clear limits.',
    decisions: [
      {
        title: 'Your time sets the limit.',
        summary:
          'Selecting five days does not mean filling all of them. If your weekly limit fits only three sessions, the plan leaves room.',
        detail1:
          'One TypeScript engine calculates dates, duration, and the number of sessions. Availability controls take priority over the goal text. At most one session is scheduled per day.',
        detail2:
          'The scope is one Monday-to-Sunday week, keeping the result bounded and easy to review.',
        link: 'View the planner',
        href: '/blob/main/lib/routine.ts',
      },
      {
        title: 'A proposal still follows rules.',
        summary:
          'Choosing what to practice and deciding when to do it are separate jobs. The calendar keeps its own checks.',
        detail1:
          'The demo uses authored sample content. The optional AI integration validates intent in Python with FastAPI and Pydantic, then checks it again before TypeScript schedules it.',
        detail2:
          'Retries and timeouts are bounded. If the response does not meet the contract, the operation stops. Connected mode is enabled separately.',
        link: 'View the integration contract',
        href: '/blob/main/docs/AI-CONTRACT.md',
      },
      {
        title: 'Change without starting over.',
        summary:
          'A missed session does not erase completed work. Cadencia looks for a later allowed and available day in the same week.',
        detail1:
          'Replanning preserves completed sessions and the missed session’s content. If space exists, it creates a new session. Otherwise, it explains the limit without inventing an opening.',
        detail2:
          'Tests verify that the original plan remains unchanged and every update respects the selected days and available time.',
        link: 'View replanning tests',
        href: '/blob/main/tests/routine.test.ts',
      },
    ],
    resolve: 'How it works',
    today: 'What you can do today',
    todayText:
      'Create a week, complete or replan sessions, review its limits, and export a calendar copy.',
    session: 'A space for this session',
    sessionText:
      'The plan lives in your browser and resets when you reload. Exports are copies: there is no synchronization or automatic reminders. Save your routine before leaving.',
    designed: 'Designed by Ronaldo',
    code: 'Explore the code',
  },
  es: {
    kicker: 'Tu intención, con espacio en la semana',
    title: 'Haz que una meta',
    titleAccent: 'tenga ritmo.',
    lead: 'Quieres aprender algo, escribir más o practicar con constancia. La semana tiene otros planes.',
    description:
      'Cadencia convierte tu intención en sesiones que caben en el tiempo que tienes. Y si una sesión se pierde, busca dónde continuar dentro de esa semana.',
    start: 'Planear mi semana',
    entry: 'Sin registro · Empieza con un ejemplo',
    principle: 'El plan se adapta a tu tiempo.',
    principleNote: 'Lo que ya hiciste sigue contando.',
    notesKicker: 'Las decisiones detrás del ritmo',
    notesTitle: 'Un plan que puedas entender.',
    notesTitle2: 'Y cambiar.',
    notesLead:
      'La intención puede ser abierta. Los días y minutos disponibles necesitan límites claros.',
    decisions: [
      {
        title: 'Tu tiempo marca el límite.',
        summary:
          'Elegir cinco días no significa llenarlos todos. Si solo caben tres sesiones en tu tope semanal, el plan deja espacio.',
        detail1:
          'Un único motor en TypeScript calcula las fechas, la duración y el número de sesiones. Los controles de disponibilidad prevalecen sobre el texto del objetivo. Se programa una sesión como máximo por día.',
        detail2:
          'El alcance es una semana de lunes a domingo: una decisión que hace el resultado acotado y fácil de revisar.',
        link: 'Ver el planificador',
        href: '/blob/main/lib/routine.ts',
      },
      {
        title: 'Una propuesta pasa por reglas.',
        summary:
          'Proponer qué practicar y decidir cuándo hacerlo son trabajos distintos. El calendario conserva sus propias comprobaciones.',
        detail1:
          'La demo utiliza contenido de ejemplo. La integración opcional con IA valida la intención en Python con FastAPI y Pydantic, y la vuelve a comprobar antes de planificar en TypeScript.',
        detail2:
          'Los reintentos y tiempos de espera son acotados. Si la respuesta no cumple el contrato, la operación se detiene. El modo conectado se habilita aparte.',
        link: 'Ver el contrato de la integración',
        href: '/blob/main/docs/AI-CONTRACT.md',
      },
      {
        title: 'Cambiar sin empezar de cero.',
        summary:
          'Una sesión perdida no borra lo que ya hiciste. Cadencia busca un día posterior permitido y libre dentro de la misma semana.',
        detail1:
          'El reajuste conserva las sesiones completadas y el contenido de la sesión perdida. Si encuentra espacio, crea una nueva sesión. Si no lo hay, explica el límite sin inventar un hueco.',
        detail2:
          'Las pruebas comprueban que el plan original no se modifica y que los cambios respetan los días y el tiempo disponibles.',
        link: 'Ver las pruebas de reajuste',
        href: '/blob/main/tests/routine.test.ts',
      },
    ],
    resolve: 'Cómo se resuelve',
    today: 'Lo que puedes hacer hoy',
    todayText:
      'Crear una semana, completar o reajustar sesiones, revisar sus límites y exportar una copia a tu calendario.',
    session: 'Un espacio para esta sesión',
    sessionText:
      'El plan vive en tu navegador y se reinicia al recargar. Las exportaciones son copias: no hay sincronización ni recordatorios automáticos. Guarda tu rutina antes de salir.',
    designed: 'Diseñado por Ronaldo',
    code: 'Explorar el código',
  },
} as const;

export function ProductStory({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  return (
    <section className="product-story" aria-labelledby="product-title">
      <div className="product-intro">
        <p className="product-kicker">{copy.kicker}</p>
        <h1 id="product-title">
          {copy.title} <span>{copy.titleAccent}</span>
        </h1>
        <p className="product-lead">{copy.lead}</p>
        <p className="product-description">{copy.description}</p>
        <a className="product-start" href="#planner">
          {copy.start} <ArrowRight size={18} aria-hidden="true" />
        </a>
        <p className="product-entry-note">{copy.entry}</p>
        <div className="product-principle">
          <span aria-hidden="true">01 /</span>
          <p>
            <strong>{copy.principle}</strong>
            <br />
            {copy.principleNote}
          </p>
        </div>
      </div>
      <WeekExampleDemo key={locale} locale={locale} />
    </section>
  );
}

export function ProductNotes({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  return (
    <section
      className="product-notes"
      id="how-it-works"
      aria-labelledby="notes-title"
    >
      <div className="product-notes-heading">
        <p className="product-kicker">{copy.notesKicker}</p>
        <h2 id="notes-title">
          {copy.notesTitle}
          <br />
          {copy.notesTitle2}
        </h2>
        <p>{copy.notesLead}</p>
      </div>
      <div className="product-decisions">
        {copy.decisions.map((decision, index) => (
          <article key={decision.title}>
            <span className="decision-number">0{index + 1}</span>
            <h3>{decision.title}</h3>
            <p>{decision.summary}</p>
            <details>
              <summary>{copy.resolve}</summary>
              <p>{decision.detail1}</p>
              <p>{decision.detail2}</p>
              <a href={`${source}${decision.href}`}>
                {decision.link} <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </details>
          </article>
        ))}
      </div>
      <div className="product-scope">
        <div>
          <h3>{copy.today}</h3>
          <p>{copy.todayText}</p>
        </div>
        <div>
          <h3>{copy.session}</h3>
          <p>{copy.sessionText}</p>
        </div>
      </div>
    </section>
  );
}

export function ProductFooter({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  return (
    <footer className="product-footer">
      <span>
        Cadencia <span aria-hidden="true">/</span> {copy.designed}
      </span>
      <a href={source}>
        {copy.code} <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </footer>
  );
}
