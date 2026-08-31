import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  Sparkles,
  WandSparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const days = [
  { short: 'L', name: 'Lunes', selected: true },
  { short: 'M', name: 'Martes', selected: true },
  { short: 'X', name: 'Miércoles', selected: false },
  { short: 'J', name: 'Jueves', selected: true },
  { short: 'V', name: 'Viernes', selected: false },
  { short: 'S', name: 'Sábado', selected: true },
  { short: 'D', name: 'Domingo', selected: false },
];

const sessions = [
  {
    day: 'Lun 31',
    kind: 'Warm-up',
    title: 'Presentarte con claridad',
    minutes: 25,
    tone: 'lime',
  },
  {
    day: 'Mar 01',
    kind: 'Practice',
    title: 'Historias con método STAR',
    minutes: 30,
    tone: 'cream',
  },
  {
    day: 'Jue 03',
    kind: 'Review',
    title: 'Listening: preguntas difíciles',
    minutes: 25,
    tone: 'mint',
  },
  {
    day: 'Sáb 05',
    kind: 'Simulation',
    title: 'Una entrevista completa',
    minutes: 40,
    tone: 'blue',
  },
];

export default function Home() {
  return (
    <main className="cadencia-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Cadencia, inicio">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">cadencia</span>
          <span className="brand-note">compilador de rutinas</span>
        </a>

        <div className="topbar-meta">
          <span className="mode-pill">
            <span className="status-dot" aria-hidden="true" />
            Demo local · sin modelo
          </span>
          <span className="session-note">Esta sesión no se guarda al cerrar</span>
        </div>
      </header>

      <div className="workspace" id="inicio">
        <section className="editor-column" aria-labelledby="editor-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              Tu intención → una semana posible
            </p>
            <h1 id="editor-title">
              Haz que una meta
              <span>tenga ritmo.</span>
            </h1>
            <p className="intro-copy">
              Escribe lo que quieres sostener. Cadencia lo convierte en sesiones que caben
              de verdad en tu semana.
            </p>
          </div>

          <div className="editor-form">
            <div className="form-section form-section-goal">
              <div className="section-number" aria-hidden="true">
                01
              </div>
              <div className="section-body">
                <label className="field-label" htmlFor="goal">
                  ¿Qué quieres volver constante?
                </label>
                <Textarea
                  id="goal"
                  name="goal"
                  rows={3}
                  defaultValue="Practicar inglés para entrevistas de trabajo, con foco en responder con más seguridad."
                  aria-describedby="goal-help"
                  className="goal-input"
                />
                <p className="field-help" id="goal-help">
                  Puedes escribirlo como se lo contarías a una persona.
                </p>
                <div className="example-row" aria-label="Ejemplos de intención">
                  <span className="example-label">Prueba con</span>
                  <button className="example-chip" type="button">
                    Aprender TypeScript
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                  <button className="example-chip" type="button">
                    Escribir cada semana
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="section-number" aria-hidden="true">
                02
              </div>
              <div className="section-body">
                <div className="section-heading">
                  <div>
                    <p className="field-label">Elige tus pulsos</p>
                    <p className="field-help">Tus días tienen la última palabra.</p>
                  </div>
                  <span className="constraint-value">4 días</span>
                </div>
                <div className="day-toggle-row" role="group" aria-label="Días disponibles">
                  {days.map((day) => (
                    <button
                      aria-pressed={day.selected}
                      className={`day-toggle${day.selected ? ' is-selected' : ''}`}
                      key={day.name}
                      type="button"
                    >
                      <span className="day-short">{day.short}</span>
                      <span className="day-name">{day.name}</span>
                      {day.selected ? <Check size={12} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="section-number" aria-hidden="true">
                03
              </div>
              <div className="section-body">
                <div className="field-grid">
                  <label className="control-field" htmlFor="session-minutes">
                    <span className="field-label">Minutos por sesión</span>
                    <span className="input-with-suffix">
                      <Input id="session-minutes" type="number" defaultValue={30} min={5} />
                      <span>min</span>
                    </span>
                  </label>
                  <label className="control-field" htmlFor="weekly-minutes">
                    <span className="field-label">Tope semanal</span>
                    <span className="input-with-suffix">
                      <Input id="weekly-minutes" type="number" defaultValue={150} min={10} />
                      <span>min</span>
                    </span>
                  </label>
                </div>
                <div className="field-grid field-grid-second">
                  <label className="control-field" htmlFor="start-date">
                    <span className="field-label">Semana que empieza</span>
                    <span className="input-with-icon">
                      <CalendarDays size={15} aria-hidden="true" />
                      <Input id="start-date" type="date" defaultValue="2026-08-31" />
                    </span>
                  </label>
                  <label className="control-field" htmlFor="start-time">
                    <span className="field-label">Hora local</span>
                    <span className="input-with-icon">
                      <Clock3 size={15} aria-hidden="true" />
                      <Input id="start-time" type="time" defaultValue="07:30" />
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="form-actions">
              <Button className="create-button" size="lg" type="button">
                <WandSparkles size={17} aria-hidden="true" />
                Crear mi rutina
              </Button>
              <p className="action-note">Demo local · tus límites se respetan primero.</p>
            </div>
          </div>
        </section>

        <aside className="preview-column" aria-labelledby="preview-title">
          <div className="preview-label-row">
            <p className="eyebrow">Vista de la semana</p>
            <span className="preview-index">01 / 01</span>
          </div>
          <div className="preview-card">
            <div className="preview-card-header">
              <div>
                <span className="sample-kicker">
                  <span className="sample-marker" aria-hidden="true" />
                  Muestra local
                </span>
                <h2 id="preview-title">English for interviews</h2>
                <p>Confianza para responder sin traducir cada frase.</p>
              </div>
              <span className="demo-tag">Demo</span>
            </div>

            <div className="rhythm-header">
              <span>Cadencia semanal</span>
              <span>4 sesiones · 120 min</span>
            </div>
            <div className="rhythm-map" aria-label="Mapa semanal de sesiones">
              {days.map((day, index) => (
                <div className="rhythm-day" key={day.name}>
                  <span className="rhythm-day-label">{day.short}</span>
                  <div className="rhythm-track" aria-hidden="true">
                    <span
                      className={`rhythm-bar ${day.selected ? 'is-on' : ''}`}
                      style={{ height: `${32 + ((index * 13) % 35)}%` }}
                    />
                  </div>
                  <span className="rhythm-day-name">{day.name.slice(0, 3)}</span>
                </div>
              ))}
            </div>

            <div className="sample-disclaimer">
              <span className="sample-disclaimer-mark" aria-hidden="true" />
              <span>Ejemplo de estructura. Genera una rutina para verla con tus datos.</span>
            </div>

            <div className="session-list" aria-label="Sesiones de ejemplo">
              {sessions.map((session) => (
                <article className="session-row" key={session.title}>
                  <div className={`session-tone tone-${session.tone}`} aria-hidden="true" />
                  <div className="session-main">
                    <div className="session-meta">
                      <span>{session.day}</span>
                      <span className="session-separator">/</span>
                      <span>{session.kind}</span>
                    </div>
                    <h3>{session.title}</h3>
                  </div>
                  <span className="session-minutes">{session.minutes}m</span>
                </article>
              ))}
            </div>

            <div className="preview-card-footer">
              <span>4 sesiones cortas, un objetivo claro.</span>
              <span className="footer-line" aria-hidden="true" />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
