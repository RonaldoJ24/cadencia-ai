import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { WeekExampleDemo } from '@/components/week-example';

const source = 'https://github.com/RonaldoJ24/cadencia-ai';

export function ProductStory() {
  return (
    <section className="product-story" aria-labelledby="product-title">
      <div className="product-intro">
        <p className="product-kicker">Tu intención, con espacio en la semana</p>
        <h1 id="product-title">
          Haz que una meta <span>tenga ritmo.</span>
        </h1>
        <p className="product-lead">
          Quieres aprender algo, escribir más o practicar con constancia. La
          semana tiene otros planes.
        </p>
        <p className="product-description">
          Cadencia convierte tu intención en sesiones que caben en el tiempo que
          tienes. Y si una sesión se pierde, busca dónde continuar dentro de esa
          semana.
        </p>
        <a className="product-start" href="#planificador">
          Planear mi semana <ArrowRight size={18} aria-hidden="true" />
        </a>
        <p className="product-entry-note">
          Sin registro · Empieza con un ejemplo
        </p>
        <div className="product-principle">
          <span aria-hidden="true">01 /</span>
          <p>
            <strong>El plan se adapta a tu tiempo.</strong>
            <br />
            Lo que ya hiciste sigue contando.
          </p>
        </div>
      </div>
      <WeekExampleDemo />
    </section>
  );
}

export function ProductNotes() {
  return (
    <section
      className="product-notes"
      id="como-funciona"
      aria-labelledby="notes-title"
    >
      <div className="product-notes-heading">
        <p className="product-kicker">Las decisiones detrás del ritmo</p>
        <h2 id="notes-title">
          Un plan que puedas entender.
          <br />Y cambiar.
        </h2>
        <p>
          La intención puede ser abierta. Los días y minutos disponibles
          necesitan límites claros.
        </p>
      </div>
      <div className="product-decisions">
        <article>
          <span className="decision-number">01</span>
          <h3>Tu tiempo marca el límite.</h3>
          <p>
            Elegir cinco días no significa llenarlos todos. Si solo caben tres
            sesiones en tu tope semanal, el plan deja espacio.
          </p>
          <details>
            <summary>Cómo se resuelve</summary>
            <p>
              Un único motor en TypeScript calcula las fechas, la duración y el
              número de sesiones. Los controles de disponibilidad prevalecen
              sobre el texto del objetivo. Se programa una sesión como máximo
              por día.
            </p>
            <p>
              El alcance es una semana de lunes a domingo: una decisión que hace
              el resultado acotado y fácil de revisar.
            </p>
            <a href={`${source}/blob/main/lib/routine.ts`}>
              Ver el planificador <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </details>
        </article>
        <article>
          <span className="decision-number">02</span>
          <h3>Una propuesta pasa por reglas.</h3>
          <p>
            Proponer qué practicar y decidir cuándo hacerlo son trabajos
            distintos. El calendario conserva sus propias comprobaciones.
          </p>
          <details>
            <summary>Cómo se resuelve</summary>
            <p>
              La demo utiliza contenido de ejemplo. La integración opcional con
              IA valida la intención en Python con FastAPI y Pydantic, y la
              vuelve a comprobar antes de planificar en TypeScript.
            </p>
            <p>
              Los reintentos y tiempos de espera son acotados. Si la respuesta
              no cumple el contrato, la operación se detiene. El modo conectado
              se habilita aparte.
            </p>
            <a href={`${source}/blob/main/docs/AI-CONTRACT.md`}>
              Ver el contrato de la integración{' '}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </details>
        </article>
        <article>
          <span className="decision-number">03</span>
          <h3>Cambiar sin empezar de cero.</h3>
          <p>
            Una sesión perdida no borra lo que ya hiciste. Cadencia busca un día
            posterior permitido y libre dentro de la misma semana.
          </p>
          <details>
            <summary>Cómo se resuelve</summary>
            <p>
              El reajuste conserva las sesiones completadas y el contenido de la
              sesión perdida. Si encuentra espacio, crea una nueva sesión. Si no
              lo hay, explica el límite sin inventar un hueco.
            </p>
            <p>
              Las pruebas comprueban que el plan original no se modifica y que
              los cambios respetan los días y el tiempo disponibles.
            </p>
            <a href={`${source}/blob/main/tests/routine.test.ts`}>
              Ver las pruebas de reajuste{' '}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </details>
        </article>
      </div>
      <div className="product-scope">
        <div>
          <h3>Lo que puedes hacer hoy</h3>
          <p>
            Crear una semana, completar o reajustar sesiones, revisar sus
            límites y exportar una copia a tu calendario.
          </p>
        </div>
        <div>
          <h3>Un espacio para esta sesión</h3>
          <p>
            El plan vive en tu navegador y se reinicia al recargar. Las
            exportaciones son copias: no hay sincronización ni recordatorios
            automáticos. Guarda tu rutina antes de salir.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ProductFooter() {
  return (
    <footer className="product-footer">
      <span>
        Cadencia <span aria-hidden="true">/</span> Diseñado por Ronaldo
      </span>
      <a href={source}>
        Explorar el código <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </footer>
  );
}
