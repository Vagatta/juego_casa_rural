import { ArrowLeft, Eye, EyeSlash, Minus, Plus } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { AVATARS, CUSTOM_MISSION_MAX_LEN, MAX_CUSTOM_MISSIONS, MAX_EXTRA_QUESTIONS } from '../../shared/constants.ts';
import type { ContentMod, Difficulty, GameSettings, Mode } from '../../shared/types.ts';
import { AvatarGrid } from './Join.tsx';
import { Button, InlineError } from '../components/ui.tsx';
import { GIcon } from '../lib/icons.tsx';
import { api } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';
import { saveSession } from '../lib/session.ts';

const MODES: { id: Mode; icon: string; title: string; text: string }[] = [
  { id: 'clasico', icon: 'vela', title: 'Clásico', text: 'Pruebas, misiones, traiciones. La experiencia completa.' },
  { id: 'caos', icon: 'caos', title: 'Caos', text: 'Evento casi cada ronda. Para grupos que ya se conocen el juego.' },
  { id: 'sofa', icon: 'sofa', title: 'Sofá', text: 'Sin pruebas físicas. Para después de cenar.' },
];

type Catalog = Awaited<ReturnType<typeof api.content>>;

const splitLines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

// ------------------------------------------------------ editor de contenido de la casa

function ContentRow({ id, text, title, off, onToggle, onEdit }: { id: string; text: string; title?: string; off: boolean; onToggle: () => void; onEdit: (key: string, value: string, original: string) => void }) {
  return (
    <div className={`crow ${off ? 'crow--off' : ''}`}>
      <button type="button" className="icon-btn crow__eye" onClick={onToggle} aria-label={off ? 'Recuperar' : 'Quitar de esta casa'} title={off ? 'Recuperar' : 'Quitar de esta casa'}>
        {off ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
      <div className="crow__body">
        {title !== undefined && <input className="input crow__title" defaultValue={title} disabled={off} onBlur={(e) => onEdit(`${id}:title`, e.target.value, title)} aria-label="Título" />}
        <textarea className="input crow__text" defaultValue={text} disabled={off} rows={2} maxLength={500} onBlur={(e) => onEdit(id, e.target.value, text)} aria-label="Texto" />
      </div>
    </div>
  );
}

function ContentSection({ label, icon, items, twoFields, disabled, onToggle, onEdit, extra }: { label: string; icon?: string; items: { id: string; text: string; title?: string }[]; twoFields?: boolean; disabled: Set<string>; onToggle: (id: string) => void; onEdit: (key: string, value: string, original: string) => void; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const changed = items.filter((i) => disabled.has(i.id)).length;
  return (
    <div className="csection">
      <button type="button" className="csection__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} {icon && <GIcon id={icon} size={15} />} {label}</span>
        <span className="muted small">{items.length}{changed ? ` · ${changed} fuera` : ''}</span>
      </button>
      {open && (
        <div className="csection__list">
          {items.map((it) => (
            <ContentRow key={it.id} id={it.id} text={it.text} title={twoFields ? it.title : undefined} off={disabled.has(it.id)} onToggle={() => onToggle(it.id)} onEdit={onEdit} />
          ))}
          {extra}
        </div>
      )}
    </div>
  );
}

function ContentEditor({ disabled, onToggle, onEdit, extras }: { disabled: Set<string>; onToggle: (id: string) => void; onEdit: (key: string, value: string, original: string) => void; extras: { interro: string; social: string; setInterro: (s: string) => void; setSocial: (s: string) => void } }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && !catalog && !failed) {
      try {
        setCatalog(await api.content());
      } catch {
        setFailed(true);
      }
    }
  };

  const extraBox = (label: string, value: string, set: (s: string) => void) => (
    <div className="field" style={{ marginTop: 8 }}>
      <label className="muted small">{label}</label>
      <textarea className="input input--area" rows={2} maxLength={CUSTOM_MISSION_MAX_LEN * MAX_EXTRA_QUESTIONS} value={value} onChange={(e) => set(e.target.value)} placeholder="Una por línea" />
    </div>
  );

  return (
    <div className="cedit">
      <button type="button" className="csection__head" onClick={toggleOpen} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} <GIcon id="lapiz" size={15} /> Edita el contenido de esta casa</span>
        <span className="muted small">opcional</span>
      </button>
      {open && !catalog && <p className="muted small">{failed ? 'No se pudo cargar el catálogo.' : 'Cargando el catálogo…'}</p>}
      {open && catalog && (
        <>
          <p className="muted small">Toca el ojo para que algo no salga en esta partida, o reescribe el texto. Los cambios solo afectan a esta casa.</p>
          <ContentSection label="Misiones" icon="nota" items={catalog.missions} disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
          <ContentSection label="Pruebas" icon="mental" items={catalog.challenges.map((c) => ({ id: c.id, text: c.instructions, title: c.title }))} twoFields disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
          <ContentSection label="Eventos" icon="dados" items={catalog.events.map((e) => ({ id: e.id, text: e.text, title: e.title }))} twoFields disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
          <ContentSection label="Preguntas del interrogatorio" icon="social" items={catalog.interro} disabled={disabled} onToggle={onToggle} onEdit={onEdit} extra={extraBox('Preguntas propias para el interrogatorio', extras.interro, extras.setInterro)} />
          <ContentSection label="¿Quién es más probable?" icon="mano-alzada" items={catalog.social} disabled={disabled} onToggle={onToggle} onEdit={onEdit} extra={extraBox('Preguntas propias de «quién es más probable»', extras.social, extras.setSocial)} />
          <ContentSection label="Tareas sospechosas" icon="espia" items={catalog.suspect} disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
          <ContentSection label="Misiones en pareja" icon="pareja" items={catalog.couple} disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
          <ContentSection label="Quiz" icon="quiz" items={catalog.quiz} disabled={disabled} onToggle={onToggle} onEdit={onEdit} />
        </>
      )}
    </div>
  );
}

export function CreateScreen() {
  const [plays, setPlays] = useState(true);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [players, setPlayers] = useState(9);
  const [duration, setDuration] = useState<GameSettings['durationMin']>(90);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [mode, setMode] = useState<Mode>('clasico');
  const [autopilot, setAutopilot] = useState(true);
  const [custom, setCustom] = useState('');
  const editsRef = useRef<Record<string, string>>({});
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [extraInterro, setExtraInterro] = useState('');
  const [extraSocial, setExtraSocial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onEdit = (key: string, value: string, original: string) => {
    const v = value.trim();
    if (!v || v === original) delete editsRef.current[key];
    else editsRef.current[key] = v;
  };
  const onToggle = (id: string) =>
    setDisabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (plays && !name.trim()) return setError('Escribe tu nombre');
    setBusy(true);
    setError(null);
    try {
      const customMissions = splitLines(custom).slice(0, MAX_CUSTOM_MISSIONS);
      const contentMod: ContentMod = {
        disabled: [...disabledIds],
        edits: editsRef.current,
        extraInterro: splitLines(extraInterro).slice(0, MAX_EXTRA_QUESTIONS),
        extraSocial: splitLines(extraSocial).slice(0, MAX_EXTRA_QUESTIONS),
      };
      const hasMod = contentMod.disabled!.length + contentMod.extraInterro!.length + contentMod.extraSocial!.length > 0 || Object.keys(contentMod.edits!).length > 0;
      const res = await api.create({ durationMin: duration, difficulty, mode, expectedPlayers: players, hostPlays: plays, autopilot, customMissions, contentMod: hasMod ? contentMod : undefined }, plays ? { name: name.trim(), avatar } : undefined);
      saveSession(res.code, { hostToken: res.hostToken, playerToken: res.playerToken ?? undefined });
      navigate(plays ? `/partida/${res.code}` : `/director/${res.code}`, true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Volver">
        <ArrowLeft size={22} weight="light" />
      </button>
      <header className="heading rise">
        <h1>Abrir la casa</h1>
        <p className="muted">Tú eres el director. Tú marcas el ritmo de la noche.</p>
      </header>

      <form className="stack stagger" style={{ '--gap': '22px' } as React.CSSProperties} onSubmit={submit}>
        <div className="field">
          <span className="label">¿Juegas tú también?</span>
          <div className="segmented">
            <button type="button" aria-pressed={plays} onClick={() => setPlays(true)}>Sí, juego</button>
            <button type="button" aria-pressed={!plays} onClick={() => setPlays(false)}>Solo dirijo</button>
          </div>
          <p className="muted small">{plays ? 'Jugarás desde este móvil y dirigirás desde un panel. Nunca verás secretos ajenos.' : 'Este dispositivo será la pantalla de la casa. Ideal para una tele o un portátil.'}</p>
        </div>

        {plays && (
          <>
            <div className="field">
              <label htmlFor="host-name">Tu nombre</label>
              <input id="host-name" className="input" maxLength={16} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como te llaman en la casa" />
            </div>
            <div className="field">
              <span className="label">Tu avatar</span>
              <AvatarGrid value={avatar} onChange={setAvatar} />
            </div>
          </>
        )}

        <div className="field">
          <span className="label">Jugadores</span>
          <div className="stepper">
            <button type="button" className="icon-btn" onClick={() => setPlayers((n) => Math.max(4, n - 1))} aria-label="Menos jugadores">
              <Minus size={22} />
            </button>
            <span className="display stepper__n">{players}</span>
            <button type="button" className="icon-btn" onClick={() => setPlayers((n) => Math.min(12, n + 1))} aria-label="Más jugadores">
              <Plus size={22} />
            </button>
          </div>
          <p className="muted small">{players < 6 ? 'Modo mini: funciona, pero la casa brilla desde 6.' : players === 9 ? 'El número perfecto.' : 'Los roles se ajustan solos a quien entre.'}</p>
        </div>

        <div className="field">
          <span className="label">Duración</span>
          <div className="segmented">
            {([30, 60, 90, 120] as const).map((d) => (
              <button type="button" key={d} aria-pressed={duration === d} onClick={() => setDuration(d)}>
                {d} min
              </button>
            ))}
          </div>
          <p className="muted small">{{ 30: '2 rondas — el sprint', 60: '4 rondas', 90: '6 rondas', 120: '8 rondas' }[duration]}</p>
        </div>

        <div className="field">
          <span className="label">Dificultad</span>
          <div className="segmented">
            {(['facil', 'normal', 'dificil'] as const).map((d) => (
              <button type="button" key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                {{ facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' }[d]}
              </button>
            ))}
          </div>
          <p className="muted small">Cambia las misiones y cuántas pistas son falsas.</p>
        </div>

        <div className="field">
          <span className="label">El ritmo</span>
          <div className="segmented">
            <button type="button" aria-pressed={autopilot} onClick={() => setAutopilot(true)}><GIcon id="robot" size={15} /> La casa avanza sola</button>
            <button type="button" aria-pressed={!autopilot} onClick={() => setAutopilot(false)}>Yo marco el ritmo</button>
          </div>
          <p className="muted small">
            {autopilot
              ? 'La partida continúa sola entre fases; solo tendrás que arbitrar las pruebas físicas. Siempre puedes pausar.'
              : 'El director pulsa «continuar» en cada paso. Más control, más pantalla.'}
          </p>
        </div>

        <div className="field">
          <label htmlFor="custom-missions">Misiones del grupo <span className="muted">(opcional)</span></label>
          <textarea
            id="custom-missions"
            className="input input--area"
            rows={3}
            maxLength={CUSTOM_MISSION_MAX_LEN * MAX_CUSTOM_MISSIONS}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={'Una por línea. Ej: haz que Pablo saque el tema del viaje a Benidorm'}
          />
          <p className="muted small">Se mezclan con las misiones de la casa y caen en secreto a quien sea. Puedes usar {'{A}'} y {'{B}'} para que la casa meta nombres de jugadores.</p>
        </div>

        <ContentEditor disabled={disabledIds} onToggle={onToggle} onEdit={onEdit} extras={{ interro: extraInterro, social: extraSocial, setInterro: setExtraInterro, setSocial: setExtraSocial }} />

        <div className="field">
          <span className="label">Modo</span>
          <div className="modes">
            {MODES.map((m) => (
              <button type="button" key={m.id} className={`mode ${mode === m.id ? 'is-on' : ''}`} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                <span className="mode__emoji"><GIcon id={m.icon} size={32} /></span>
                <span className="display mode__title">{m.title}</span>
                <span className="mode__text">{m.text}</span>
              </button>
            ))}
          </div>
        </div>

        <InlineError error={error} />
        <Button type="submit" block arrow disabled={busy}>
          {busy ? 'Abriendo...' : 'Crear partida'}
        </Button>
      </form>
    </main>
  );
}
