import { useEffect, useState } from 'react';
import { AUCTION_MIN_BID, LETTER_MAX_LEN, REACTION_EMOJIS, REACT_COOLDOWN_MS } from '../../shared/constants.ts';
import type { ChallengeView, GameView, PublicPlayer } from '../../shared/types.ts';
import { PlayerPicker, RoleCard } from '../components/cards.tsx';
import { PrivacyGate } from '../components/privacy.tsx';
import { Button, Candles, Coins, InlineError, Stamp, Timer, Token, useCountdown } from '../components/ui.tsx';
import { useAction, useGame, useServerNow } from '../lib/net.ts';
import { GIcon } from '../lib/icons.tsx';
import { play } from '../lib/sound.ts';
import { AbilityPanel } from './tabs.tsx';
import { Ceremony } from './Finale.tsx';

export const CATEGORY = {
  mental: { icon: 'mental', label: 'Mental' },
  social: { icon: 'social', label: 'Social' },
  fisica: { icon: 'fisica', label: 'Física' },
  movil: { icon: 'movil', label: 'Móvil' },
  mentira: { icon: 'mentira', label: 'Mentira' },
} as const;

export function usePlayers() {
  const { view } = useGame();
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return { all: view.players, active: view.players.filter((p) => !p.left), byId, get: (id: string) => byId.get(id) };
}

export const nameList = (players: (PublicPlayer | undefined)[]) => players.filter(Boolean).map((p) => p!.name).join(', ');

type GoTo = (tab: 'ahora' | 'misiones' | 'pistas' | 'despensa' | 'notas' | 'yo') => void;

export function NowTab({ goTo }: { goTo: GoTo }) {
  const { view } = useGame();
  return (
    <div className="stack now" style={{ '--gap': '18px' } as React.CSSProperties}>
      {view.phase !== 'LOBBY' && view.phase !== 'FINALE' && <StatusStrip view={view} />}
      {view.event?.endsAt && <EventBanner />}
      <AuctionCard />
      <PhaseBody goTo={goTo} />
      <ReadyBar />
      <BlindPrediction />
      <SuspectLetter />
      <ReactionBar />
    </div>
  );
}

// ---------------------------------------------------------- «estamos listos»

/** En las esperas (intro, briefings, juicio revelado...) cualquiera puede pulsar
 *  "estoy listo"; cuando todos lo hacen, la fase salta sin esperar al director. */
function ReadyBar() {
  const { view } = useGame();
  const { run, busy } = useAction();
  const up = view.readyUp;
  const me = view.me;
  if (!up || !me || me.left) return null;
  return (
    <div className="readyup">
      {up.mine ? (
        <p className="muted center">Esperando al resto — {up.count} de {up.total} listos</p>
      ) : (
        <Button block variant="ghost" disabled={busy} onClick={() => run({ type: 'ready' })}>
          Estoy listo · {up.count}/{up.total}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------- carta del condenado

function SuspectLetter() {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const me = view.me;
  if (!me?.canLetter || sent) return null;

  return (
    <section className="paper paper--tilt-r rise">
      <span className="eyebrow"><GIcon id="carta" size={16} /> La carta del condenado</span>
      <p className="muted small">
        La casa te ha señalado. Deja una última palabra: se leerá en voz alta al abrir la próxima ronda. Es anónima — nadie sabrá que es tuya.
      </p>
      <textarea
        className="input input--area"
        rows={2}
        maxLength={LETTER_MAX_LEN}
        placeholder="«Yo no he sido. Mirad a quien calla…»"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button block arrow disabled={busy || !text.trim()} onClick={() => run({ type: 'letter', text }).then(() => setSent(true))}>
        Sellar la carta
      </Button>
      <InlineError error={error} />
    </section>
  );
}

// ---------------------------------------------------------- predicción a ciegas

function BlindPrediction() {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const { active, get } = usePlayers();
  const [picked, setPicked] = useState<string[]>([]);
  const me = view.me;
  // Solo ronda 1, antes de que la investigación hable. Una vez, secreto, sin cambio.
  const open = !!me && view.round?.index === 0 && (view.phase === 'ROUND_INTRO' || view.phase === 'CHALLENGE');
  if (!open && !me?.prediction) return null;

  return (
    <section className="paper paper--tilt-r prediction rise">
      <span className="eyebrow"><GIcon id="prediccion" size={16} /> Primera impresión</span>
      {me?.prediction ? (
        <p className="hand" style={{ fontSize: 26 }}>
          Sospechas de {get(me.prediction)?.name}. Guardada en el sobre — si aciertas, +60 <GIcon id="coins" size={12} /> al final.
        </p>
      ) : (
        <>
          <p className="muted small">Antes de saber nada: ¿a quién huele a Cuco? Secreto hasta el final. Si aciertas, +60 <GIcon id="coins" size={12} />.</p>
          <PlayerPicker players={active.filter((p) => p.id !== me?.id)} max={1} selected={picked} onChange={setPicked} />
          <Button block arrow disabled={busy || !picked.length} onClick={() => run({ type: 'predict', targetId: picked[0] })}>
            Sellar mi sospecha
          </Button>
          <InlineError error={error} />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------- subasta ciega

function AuctionCard() {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const auction = view.auction;
  const me = view.me;
  const [amount, setAmount] = useState(30);
  if (!auction || !me) return null;

  const capped = Math.min(amount, me.coins);
  return (
    <section className="paper paper--tilt-l rise">
      <span className="eyebrow"><GIcon id="subasta" size={16} /> Subasta del casero · {auction.bidsCount} {auction.bidsCount === 1 ? 'puja' : 'pujas'}</span>
      <p className="muted small">
        Una pista que siempre dice la verdad. Pujas selladas: nadie ve tu oferta y solo paga el ganador.
        {auction.myBid !== null && <> Tu puja: {auction.myBid} <GIcon id="coins" size={12} />.</>}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {[20, 40, 80].map((n) => (
          <Button key={n} small variant={amount === n ? 'danger' : 'ghost'} disabled={me.coins < AUCTION_MIN_BID || me.coins < n} onClick={() => setAmount(n)}>
            {n}
          </Button>
        ))}
        <Button small variant={amount === me.coins ? 'danger' : 'ghost'} disabled={me.coins < AUCTION_MIN_BID} onClick={() => setAmount(me.coins)}>
          Todo
        </Button>
      </div>
      <Button block arrow disabled={busy || me.coins < AUCTION_MIN_BID} onClick={() => run({ type: 'bid', amount: capped })}>
        {auction.myBid !== null ? 'Cambiar puja' : 'Sellar puja'} · {capped} <GIcon id="coins" size={14} />
      </Button>
      <InlineError error={error} />
    </section>
  );
}

// ---------------------------------------------------------- reacciones a la TV

const REACT_PHASES = ['CHALLENGE', 'INVESTIGATION', 'VOTING', 'ROUND_RESULT', 'FINAL_ACCUSATION'];

function ReactionBar() {
  const { view, send } = useGame();
  const [cooling, setCooling] = useState(false);
  if (!view.me || !REACT_PHASES.includes(view.phase)) return null;
  return (
    <div className="reaction-bar" role="toolbar" aria-label="Reacciona en la tele">
      {REACTION_EMOJIS.map((e) => (
        <button
          type="button"
          key={e}
          className="reaction-bar__btn"
          disabled={cooling}
          aria-label={`Reaccionar ${e}`}
          onClick={async () => {
            setCooling(true);
            await send({ type: 'react', emoji: e });
            setTimeout(() => setCooling(false), REACT_COOLDOWN_MS);
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function PhaseBody({ goTo }: { goTo: GoTo }) {
  const { view } = useGame();
  switch (view.phase) {
    case 'LOBBY':
      return <LobbyNow />;
    case 'ROLE_REVEAL':
      return <RoleRevealNow />;
    case 'ROUND_INTRO':
      return <RoundIntroNow goTo={goTo} />;
    case 'CHALLENGE':
      return <ChallengeNow />;
    case 'RITUAL':
      return <RitualNow />;
    case 'INVESTIGATION':
      return <InvestigationNow goTo={goTo} />;
    case 'VOTING':
    case 'FINAL_ACCUSATION':
      return <VotingNow />;
    case 'ROUND_RESULT':
      return <RoundResultNow />;
    case 'FINALE':
      return <Ceremony compact />;
  }
}

function StatusStrip({ view }: { view: GameView }) {
  return (
    <div className="strip rise">
      <Candles velas={view.velas} grietas={view.grietas} slots={view.candleSlots} compact />
      <div className="strip__nums">
        <span className="chip chip--safe"><GIcon id="vela" size={14} /> {view.velas}</span>
        <span className="chip chip--danger"><GIcon id="grieta" size={14} /> {view.grietas}</span>
      </div>
    </div>
  );
}

function EventBanner() {
  const { view } = useGame();
  const e = view.event!;
  return (
    <aside className="event-banner pop" role="status">
      <span className="event-banner__emoji">{e.emoji}</span>
      <div className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
        <strong>{e.title}</strong>
        <span className="small">{e.text}</span>
      </div>
      <Timer endsAt={e.endsAt} />
    </aside>
  );
}

// ---------------------------------------------------------------- sala

function LobbyNow() {
  const { view } = useGame();
  const { active } = usePlayers();
  const [welcomed, setWelcomed] = useState(() => sessionStorage.getItem(`welcome:${view.code}`) === '1');
  if (!welcomed) {
    return (
      <section className="welcome deal">
        <span className="welcome__key"><GIcon id="av-llave" size={64} /></span>
        <h1>Bienvenido a la casa.</h1>
        <p className="hand" style={{ fontSize: 28 }}>
          Cuando empiece la noche, tu móvil guardará secretos. Tenlo cerca. Y boca abajo.
        </p>
        <Button
          block
          arrow
          onClick={() => {
            sessionStorage.setItem(`welcome:${view.code}`, '1');
            setWelcomed(true);
          }}
        >
          Pasar
        </Button>
      </section>
    );
  }
  return (
    <section className="stack" style={{ '--gap': '22px' } as React.CSSProperties}>
      <div className="lobby-code rise">
        <span className="eyebrow">Código de la casa</span>
        <span className="lobby-code__code">{view.code}</span>
      </div>
      <div className="slab stack">
        <div className="row spread">
          <strong className="display" style={{ fontSize: 22 }}>En la casa</strong>
          <span className="chip">{active.length} / 12</span>
        </div>
        <div className="token-row stagger">
          {active.map((p) => (
            <Token key={p.id} player={{ ...p, acted: false }} size={58} badge={p.isHost ? <GIcon id="corona" size={12} /> : undefined} />
          ))}
        </div>
      </div>
      <p className="muted center">{view.me?.isHost ? <>Cuando estéis todos, abre el mando <GIcon id="corona" size={14} /> y pulsa Comenzar.</> : 'Esperando a que el director abra la noche...'}</p>
    </section>
  );
}

// ---------------------------------------------------------------- identidad

function RoleRevealNow() {
  const { view } = useGame();
  const me = view.me!;
  const [flipped, setFlipped] = useState(false);
  const { run, busy, error } = useAction();
  const { active } = usePlayers();
  if (!me.role) return null;
  const ready = active.filter((p) => p.ready).length;

  return (
    <section className="stack center" style={{ '--gap': '18px' } as React.CSSProperties}>
      <h1 className="rise" style={{ fontSize: 44 }}>Tu identidad</h1>
      <PrivacyGate id={`role:${view.code}`}>
        <RoleCard
          role={me.role}
          flipped={flipped}
          onFlip={() => {
            if (!flipped) play('reveal');
            setFlipped(!flipped);
          }}
          teammates={me.teammates}
          players={view.players}
        />
        {!me.ready ? (
          <Button block arrow disabled={busy || !flipped} onClick={() => run({ type: 'ready' })}>
            {flipped ? 'Lo he entendido' : 'Gira la carta'}
          </Button>
        ) : (
          <p className="muted">Esperando al resto: {ready} de {active.length} listos.</p>
        )}
        <InlineError error={error} />
      </PrivacyGate>
    </section>
  );
}

// ---------------------------------------------------------------- intro de ronda

function RoundIntroNow({ goTo }: { goTo: GoTo }) {
  const { view } = useGame();
  const round = view.round!;
  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <div className="round-card deal">
        <span className="eyebrow">Ronda {round.index + 1} de {round.total}</span>
        <h1>{round.title}</h1>
        {round.hasJudgment && <span className="chip chip--danger"><GIcon id="subasta" size={13} /> Esta ronda hay juicio</span>}
      </div>
      {view.event && !view.event.endsAt && (
        <div className="paper paper--tilt-r pop">
          <span style={{ fontSize: 40 }}>{view.event.emoji}</span>
          <h2 style={{ fontSize: 32 }}>{view.event.title}</h2>
          <p>{view.event.text}</p>
        </div>
      )}
      <Button variant="ghost" block onClick={() => goTo('misiones')}>
        <GIcon id="nota" size={16} /> Revisar mis misiones
      </Button>
      <p className="muted center">El director está a punto de lanzar la prueba.</p>
    </section>
  );
}

// ---------------------------------------------------------------- prueba

export function ChallengeCard({ c, big }: { c: ChallengeView; big?: boolean }) {
  const { get } = usePlayers();
  const cat = CATEGORY[c.category];
  const everyone = c.participants.length >= (usePlayers().active.length - 1);
  return (
    <article className={`paper challenge-card ${big ? 'challenge-card--big' : ''} deal`}>
      <div className="row spread">
        <span className="chip challenge-card__cat"><GIcon id={cat.icon} size={14} /> {cat.label}</span>
        {c.affectsCandles && <span className="small muted"><GIcon id="vela" size={13} /> Vale una vela</span>}
      </div>
      <h2>{c.title}</h2>
      <p className="challenge-card__text">{c.instructions}</p>
      {!everyone && (
        <div className="challenge-card__who">
          <span className="small muted">{c.kind === 'physical' && c.scoring === 'winner' ? 'Duelo' : 'Equipo'}</span>
          <div className="token-row">
            {c.participants.map((id) => get(id)).filter(Boolean).map((p) => (
              <Token key={p!.id} player={p!} size={40} />
            ))}
          </div>
        </div>
      )}
      {c.pub.question && <p className="hand challenge-card__question">{c.pub.question}</p>}
      {c.pub.questions && (
        <ol className="challenge-card__questions">
          {c.pub.questions.map((q, i) => (
            <li key={i} className="hand">
              {q}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function ChallengeNow() {
  const { view } = useGame();
  const c = view.challenge!;
  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <ChallengeCard c={c} />
      {c.status === 'running' && <div className="center stack"><Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label="Tiempo" big /></div>}
      {c.status === 'voting' && <div className="center stack"><Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label="Votación" /></div>}
      <ChallengeInteraction c={c} />
      {c.status === 'done' && <ChallengeResult c={c} />}
    </section>
  );
}

function ChallengeInteraction({ c }: { c: ChallengeView }) {
  const { view } = useGame();
  const me = view.me!;
  const { active, get } = usePlayers();
  const { run, busy, error } = useAction();
  const [picked, setPicked] = useState<string[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [code, setCode] = useState('');
  const now = useServerNow(500);

  if (c.status === 'briefing') {
    if (c.mine.code?.isHider) {
      return (
        <PrivacyGate id={`code:${view.code}:${view.round?.index}`} title="Tu código secreto">
          <div className="secret-code pop">
            <span className="eyebrow">Escríbelo en un papel</span>
            <span className="secret-code__digits">{c.mine.code.code}</span>
            <p className="small">Cuando el director pulse, tendrás un minuto para esconderlo. El resto espera fuera.</p>
          </div>
        </PrivacyGate>
      );
    }
    if (c.mine.truthLie?.isSpeaker) return <SpeakerPanel c={c} />;
    if (c.mine.impostor) {
      return (
        <PrivacyGate id={`word:${view.code}:${view.round?.index}`} title="Tu palabra">
          <div className="secret-code pop">
            <span className="eyebrow">Tu palabra es</span>
            <span className="secret-code__word">{c.mine.impostor.word}</span>
            <p className="small">No la digas. Descríbela con una sola palabra cuando te toque.</p>
          </div>
        </PrivacyGate>
      );
    }
    return <p className="muted center">Leed las instrucciones. El director dará la salida.</p>;
  }

  if (c.status === 'running') {
    if (c.kind === 'physical' || c.kind === 'interrogatorio') return <p className="muted center">¡A jugar! Esto se decide en la habitación.</p>;

    if (c.mine.quiz) {
      if (c.mine.quiz.answers) return <p className="center done-msg">Respuestas enviadas. Crucemos los dedos.</p>;
      const qs = c.mine.quiz.questions;
      return (
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          {qs.map((q, i) => (
            <fieldset key={i} className="quiz slab">
              <legend className="quiz__q">{i + 1}. {q.q}</legend>
              <div className="quiz__opts">
                {q.options.map((o, j) => (
                  <button type="button" key={j} className={`quiz__opt ${answers[i] === j ? 'is-on' : ''}`} aria-pressed={answers[i] === j} onClick={() => setAnswers((a) => Object.assign([...a], { [i]: j }))}>
                    {o}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <Button block arrow disabled={busy} onClick={() => run({ type: 'challenge', answers: qs.map((_, i) => answers[i] ?? -1) })}>
            Enviar respuestas
          </Button>
          <InlineError error={error} />
        </div>
      );
    }

    if (c.kind === 'code_hunt') {
      if (c.mine.code?.isHider) return <p className="center done-msg">Tú lo has escondido. Disfruta del espectáculo (y no mires hacia el escondite).</p>;
      const starts = c.pub.huntStartsAt ?? 0;
      if (now < starts) {
        return (
          <div className="slab center stack">
            <p className="display" style={{ fontSize: 26 }}>Fuera del salón. Ojos cerrados.</p>
            <p className="muted">{get(c.pub.hiderId!)?.name} está escondiendo el código.</p>
            <Timer endsAt={starts} label="La búsqueda empieza en" />
          </div>
        );
      }
      return (
        <form
          className="stack slab"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ type: 'challenge', code })) setCode('');
          }}
        >
          <label className="label display" htmlFor="found-code" style={{ fontSize: 22 }}>¿Lo has encontrado?</label>
          <input id="found-code" className="input input--code" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="0000" />
          <Button type="submit" block variant="danger" disabled={busy || code.length !== 4 || !c.mine.code?.attemptsLeft}>
            Probar código
          </Button>
          <p className="small muted">Te quedan {c.mine.code?.attemptsLeft ?? 0} intentos.</p>
          <InlineError error={error} />
        </form>
      );
    }

    if (c.kind === 'word_impostor' && c.mine.impostor) {
      return (
        <PrivacyGate id={`word:${view.code}:${view.round?.index}`} title="Tu palabra" compact>
          <div className="secret-code">
            <span className="eyebrow">Tu palabra</span>
            <span className="secret-code__word">{c.mine.impostor.word}</span>
          </div>
        </PrivacyGate>
      );
    }

    if (c.mine.truthLie?.isSpeaker) return <SpeakerPanel c={c} />;

    if (c.mine.truthLie) {
      if (c.mine.truthLie.guess !== null) return <p className="center done-msg">Voto enviado.</p>;
      return (
        <div className="stack">
          <p className="center display" style={{ fontSize: 24 }}>¿Cuál es la mentira de {get(c.pub.speakerId!)?.name}?</p>
          <div className="triple">
            {[0, 1, 2].map((i) => (
              <Button key={i} disabled={busy} onClick={() => run({ type: 'challenge', guess: i })}>
                {i + 1}ª
              </Button>
            ))}
          </div>
          <InlineError error={error} />
        </div>
      );
    }

    if (c.mine.social) {
      if (c.mine.social.vote) return <p className="center done-msg">Has votado a {get(c.mine.social.vote)?.name}. Esperando al resto.</p>;
      return (
        <div className="stack">
          <PlayerPicker players={active} max={1} selected={picked} onChange={setPicked} />
          <Button block arrow disabled={busy || !picked.length} onClick={() => run({ type: 'challenge', vote: picked[0] })}>
            Votar
          </Button>
          <InlineError error={error} />
        </div>
      );
    }
    return <p className="muted center">Mira a la casa. Esta no va contigo.</p>;
  }

  if (c.status === 'voting' && c.mine.impostor) {
    if (c.mine.impostor.vote) return <p className="center done-msg">Has señalado a {get(c.mine.impostor.vote)?.name}.</p>;
    const pool = active.filter((p) => p.id !== me.id && c.participants.includes(p.id));
    return (
      <div className="stack">
        <p className="center display" style={{ fontSize: 26 }}>¿Quién es el Infiltrado?</p>
        <PlayerPicker players={pool} max={1} selected={picked} onChange={setPicked} />
        <Button block variant="danger" arrow disabled={busy || !picked.length} onClick={() => run({ type: 'challenge', vote: picked[0] })}>
          Señalar
        </Button>
        <InlineError error={error} />
      </div>
    );
  }

  if (c.status === 'judging') return <p className="muted center">El director está deliberando...</p>;
  return null;
}

function SpeakerPanel({ c }: { c: ChallengeView }) {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const lie = c.mine.truthLie!.lieIndex;
  return (
    <PrivacyGate id={`lie:${view.code}:${view.round?.index}`} title="Te toca hablar">
      <div className="slab stack center">
        <p className="display" style={{ fontSize: 26 }}>Piensa dos verdades y una mentira sobre ti.</p>
        <p className="muted">Cuéntalas en voz alta, numeradas. Después marca aquí cuál era la mentira.</p>
        {lie === null ? (
          <div className="triple">
            {[0, 1, 2].map((i) => (
              <Button key={i} variant="danger" disabled={busy} onClick={() => run({ type: 'challenge', lieIndex: i })}>
                {i + 1}ª
              </Button>
            ))}
          </div>
        ) : (
          <p className="done-msg">Tu mentira es la {lie + 1}ª. Pon cara de póker.</p>
        )}
        <InlineError error={error} />
      </div>
    </PrivacyGate>
  );
}

export function ChallengeResult({ c, big }: { c: ChallengeView; big?: boolean }) {
  const { get } = usePlayers();
  const r = c.result;
  const verdict = c.passed === true ? <Stamp tone="safe">Superada</Stamp> : c.passed === false ? <Stamp tone="danger">Fallada</Stamp> : null;
  return (
    <div className={`result ${big ? 'result--big' : ''} slab stack center pop`}>
      {verdict}
      {c.winners.length > 0 && <p className="display result__line"><GIcon id="trofeo" size={20} /> {c.winners.map((id) => get(id)?.name).join(' y ')}</p>}
      {r?.quiz && (
        <div className="stack" style={{ '--gap': '8px', width: '100%' } as React.CSSProperties}>
          <p>La casa acertó un {Math.round(r.quiz.correctRate * 100)}%.</p>
          {r.quiz.questions.map((q, i) => (
            <p key={i} className="small muted">
              {q.q} <strong style={{ color: 'var(--cream)' }}>{q.options[q.answer]}</strong>
            </p>
          ))}
        </div>
      )}
      {r?.code && <p className="result__line">El código era <strong className="display">{r.code.code}</strong>. {r.code.foundBy ? `Lo encontró ${get(r.code.foundBy)?.name}.` : 'Nadie lo encontró.'}</p>}
      {r?.impostor && (
        <>
          <p className="result__line">
            El Infiltrado era <strong>{get(r.impostor.infiltradoId)?.name}</strong>.
          </p>
          <p className="muted">Palabra: {r.impostor.word} · Infiltrado: {r.impostor.fakeWord}</p>
        </>
      )}
      {r?.truthLie && (
        <p className="result__line">
          {r.truthLie.lieIndex === null ? 'No marcó ninguna mentira.' : `La mentira era la ${r.truthLie.lieIndex + 1}ª.`} {r.truthLie.fooled ? '¡Engañó a la casa!' : 'La casa no se lo tragó.'}
        </p>
      )}
      {r?.social && r.social.top.length > 0 && (
        <div className="stack center">
          <div className="token-row">
            {r.social.top.map((id) => get(id)).filter(Boolean).map((p) => (
              <Token key={p!.id} player={p!} size={big ? 110 : 72} />
            ))}
          </div>
          <p className="muted">{r.social.tally[0]?.votes} votos</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ritual

function RitualNow() {
  const { view } = useGame();
  const r = view.ritual!;
  const me = view.me!;
  const { run, busy, error } = useAction();
  const { get } = usePlayers();

  if (r.status === 'revealed' && r.result) return <RitualOutcome view={view} />;

  if (!r.isParticipant) {
    return (
      <section className="slab stack center" style={{ '--gap': '14px' } as React.CSSProperties}>
        <GIcon id="vela" size={56} />
        <h2 style={{ fontSize: 34 }}>El Ritual de la Vela</h2>
        <p className="muted">{me.left ? '' : view.players.find((p) => p.id === me.id)?.suspect ? 'Estás bajo sospecha: esta vez no participas.' : 'No participas en este Ritual.'}</p>
        <div className="token-row">
          {r.participants.map((id) => get(id)).filter(Boolean).map((p) => (
            <Token key={p!.id} player={p!} size={44} />
          ))}
        </div>
        <p className="small muted">{r.submittedCount} de {r.participants.length} han decidido</p>
      </section>
    );
  }

  return (
    <section className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <h1 className="center rise" style={{ fontSize: 44 }}>El Ritual</h1>
      <PrivacyGate id={`ritual:${view.code}:${view.round?.index}`} title="Decisión secreta">
        {r.myChoice ? (
          <p className="center done-msg">Has decidido. Nadie sabrá qué. ({r.submittedCount}/{r.participants.length})</p>
        ) : (
          <div className="ritual">
            <p className="center muted">
              {me.role?.faction === 'cuco'
                ? `Te quedan ${me.cerillas} cerillas. Un solo apagón abre una grieta.`
                : 'Enciende la vela. Puedes pulsar APAGAR para despistar: no tendrá efecto.'}
            </p>
            <button type="button" className="ritual__btn ritual__btn--on" disabled={busy} onClick={() => run({ type: 'ritual', choice: 'encender' })}>
              <span className="ritual__icon"><GIcon id="vela" size={48} /></span>
              <span className="display">Encender</span>
            </button>
            <button type="button" className="ritual__btn ritual__btn--off" disabled={busy} onClick={() => run({ type: 'ritual', choice: 'apagar' })}>
              <span className="ritual__icon"><GIcon id="soplar" size={48} /></span>
              <span className="display">Apagar</span>
            </button>
          </div>
        )}
        <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label="Tiempo" />
        <InlineError error={error} />
      </PrivacyGate>
    </section>
  );
}

export function RitualOutcome({ view, big }: { view: GameView; big?: boolean }) {
  const res = view.ritual!.result!;
  const lit = res.outcome === 'vela';
  return (
    <section className={`ritual-out ${lit ? 'is-lit' : 'is-out'} ${big ? 'ritual-out--big' : ''} pop`}>
      <span className="ritual-out__icon"><GIcon id={lit ? 'vela' : 'grieta'} size={72} /></span>
      <h1>{lit ? 'La vela arde' : 'Se abre una grieta'}</h1>
      <p className="muted">{lit ? 'Nadie la ha apagado. Por ahora.' : `${res.apagones === 1 ? 'Alguien ha apagado' : `${res.apagones} personas han apagado`} la vela.`}</p>
    </section>
  );
}

// ---------------------------------------------------------------- investigación

function InvestigationNow({ goTo }: { goTo: GoTo }) {
  const { view } = useGame();
  const me = view.me!;
  return (
    <section className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="center stack rise">
        <span className="eyebrow">Investigación</span>
        <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} big />
        <p className="muted">Habla. Sospecha. Compra. Miente.</p>
      </div>
      {me.role?.ability && <AbilityPanel />}
      <div className="quick">
        <Button variant="ghost" onClick={() => goTo('despensa')}><GIcon id="coins" size={16} /> Despensa</Button>
        <Button variant="ghost" onClick={() => goTo('misiones')}><GIcon id="nota" size={16} /> Misiones</Button>
        <Button variant="ghost" onClick={() => goTo('pistas')}><GIcon id="curioso" size={16} /> Pistas</Button>
      </div>
      <Feed view={view} />
    </section>
  );
}

export function Feed({ view, limit = 5 }: { view: GameView; limit?: number }) {
  if (!view.announcements.length) return null;
  return (
    <ul className="feed">
      {view.announcements.slice(-limit).reverse().map((a) => (
        <li key={a.id} className={`feed__item feed__item--${a.tone}`}>
          {a.text}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- votaciones

function VotingNow() {
  const { view } = useGame();
  const v = view.vote!;
  const me = view.me!;
  const { active, get } = usePlayers();
  const { run, busy, error } = useAction();
  const [picked, setPicked] = useState<string[]>([]);
  const isFinal = v.kind === 'final';

  if (v.status === 'revealed' && v.result) return <VoteResult view={view} />;

  return (
    <section className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <header className="center stack rise" style={{ '--gap': '6px' } as React.CSSProperties}>
        <span className="eyebrow">{isFinal ? 'La Gran Acusación' : 'Juicio'}</span>
        <h1 style={{ fontSize: 40 }}>{isFinal ? `Señala ${v.picks === 1 ? 'al Cuco' : `a ${v.picks} Cucos`}` : '¿Quién es un Cuco?'}</h1>
        <p className="muted">{isFinal ? 'Un Cuco queda desenmascarado si más de la mitad de la casa lo señala.' : v.isPublic ? <><GIcon id="mano-alzada" size={14} /> Esta vez los votos serán públicos.</> : 'Voto secreto. El más votado queda bajo sospecha.'}</p>
      </header>
      {v.myVote ? (
        <div className="slab center stack">
          <p className="done-msg">Has señalado a {v.myVote.map((id) => get(id)?.name).join(' y ')}.</p>
          <p className="muted small">{v.votedCount} de {v.total} han votado</p>
        </div>
      ) : (
        <PrivacyGate id={`vote:${view.code}:${v.kind}:${view.round?.index}`} title="Voto secreto" compact>
          <PlayerPicker players={active.filter((p) => p.id !== me.id)} max={v.picks} selected={picked} onChange={setPicked} />
          {!isFinal && v.myWeight > 1 && <p className="chip chip--warn" style={{ alignSelf: 'center' }}><GIcon id="voto-doble" size={14} /> Tu voto cuenta {v.myWeight === 2 ? 'doble' : `×${v.myWeight}`}</p>}
          {!isFinal && me.role?.id === 'ermitano' && <p className="muted small" style={{ alignSelf: 'center' }}>Si votas rompes tu voto de silencio y pierdes el bonus del Ermitaño.</p>}
          <Button block variant="danger" arrow disabled={busy || !picked.length} onClick={() => run({ type: 'vote', targets: picked })}>
            {isFinal ? 'Acusar' : 'Votar'}
          </Button>
          <InlineError error={error} />
        </PrivacyGate>
      )}
      {isFinal && <BetPanel />}
      <div className="center">
        <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label="Tiempo" />
      </div>
    </section>
  );
}

/** El casino de la Gran Acusación: apuesta monedas a quién es Cuco. Si aciertas, el doble. */
function BetPanel() {
  const { view } = useGame();
  const me = view.me!;
  const v = view.vote!;
  const { active, get } = usePlayers();
  const { run, busy, error } = useAction();
  const [target, setTarget] = useState<string[]>([]);
  const [amount, setAmount] = useState(20);

  return (
    <div className="slab stack">
      <div className="row spread">
        <strong className="display" style={{ fontSize: 26 }}><GIcon id="dados" size={22} /> La mesa de apuestas</strong>
        <Coins n={me.coins} />
      </div>
      {v.myBet ? (
        <p className="done-msg center">Apostaste {v.myBet.amount} <GIcon id="coins" size={14} /> a que {get(v.myBet.targetId)?.name} es un Cuco.</p>
      ) : me.coins > 0 ? (
        <>
          <PlayerPicker players={active.filter((p) => p.id !== me.id)} max={1} selected={target} onChange={setTarget} />
          <div className="row" style={{ justifyContent: 'center' }}>
            {[10, 25, 50].map((n) => (
              <Button key={n} small variant={amount === n ? 'danger' : 'ghost'} disabled={me.coins < n} onClick={() => setAmount(n)}>
                {n} <GIcon id="coins" size={12} />
              </Button>
            ))}
            <Button small variant={amount === me.coins ? 'danger' : 'ghost'} onClick={() => setAmount(me.coins)}>
              Todo
            </Button>
          </div>
          <Button block variant="safe" arrow disabled={busy || !target.length} onClick={() => run({ type: 'bet', targetId: target[0], amount: Math.min(amount, me.coins) })}>
            Apostar {Math.min(amount, me.coins)} <GIcon id="coins" size={14} /> a {target.length ? get(target[0])?.name : '...'}
          </Button>
          <InlineError error={error} />
        </>
      ) : (
        <p className="muted center">Sin monedas no hay apuesta. Mala suerte.</p>
      )}
      {v.bets.length > 0 && (
        <div className="stack small" style={{ '--gap': '4px' } as React.CSSProperties}>
          {v.bets.map((b) => (
            <span key={b.playerId} className="muted">
              <GIcon id="dinero" size={14} /> {get(b.playerId)?.name} → {get(b.targetId)?.name} · {b.amount} <GIcon id="coins" size={12} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoteResult({ view, big }: { view: GameView; big?: boolean }) {
  const { get } = usePlayers();
  const res = view.vote!.result!;
  const max = res.tally[0]?.votes ?? 1;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // Revelación de abajo arriba, con suspense
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= res.tally.length ? n : n + 1)), 450);
    return () => clearInterval(t);
  }, [res.tally.length]);
  const ordered = [...res.tally].reverse();
  return (
    <section className={`vote-result ${big ? 'vote-result--big' : ''} stack`}>
      <h2 className="center">{res.suspects.length ? 'Bajo sospecha' : 'Votos repartidos'}</h2>
      <div className="bars">
        {ordered.map((t, i) => {
          const p = get(t.id);
          if (!p) return null;
          const visible = i < shown;
          return (
            <div key={t.id} className={`bar ${visible ? 'is-in' : ''} ${res.suspects.includes(t.id) ? 'is-suspect' : ''}`} style={{ '--w': `${(t.votes / max) * 100}%` } as React.CSSProperties}>
              <Token player={p} size={big ? 56 : 38} label={false} />
              <span className="bar__name">{p.name}</span>
              <span className="bar__fill" />
              <span className="display bar__n">{t.votes}</span>
            </div>
          );
        })}
      </div>
      {res.ballots && (
        <div className="slab stack small">
          <strong><GIcon id="mano-alzada" size={16} /> A mano alzada</strong>
          {res.ballots.map((b) => (
            <span key={b.voterId}>
              {get(b.voterId)?.name} → {b.targets.map((t) => get(t)?.name).join(', ')}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- resumen

function RoundResultNow() {
  const { view } = useGame();
  const last = view.lastRound;
  const { get } = usePlayers();
  const me = view.me!;
  return (
    <section className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="round-card deal">
        <span className="eyebrow">Fin de la ronda {(last?.index ?? 0) + 1}</span>
        <h1>{last?.outcome === 'vela' ? 'Una vela más' : last?.outcome === 'grieta' ? 'La casa cruje' : 'Risas y sospechas'}</h1>
        <Candles velas={view.velas} grietas={view.grietas} slots={view.candleSlots} />
      </div>
      {last && last.suspects.length > 0 && (
        <div className="slab stack center">
          <span className="chip chip--danger">Bajo sospecha</span>
          <div className="token-row">
            {last.suspects.map((id) => get(id)).filter(Boolean).map((p) => (
              <Token key={p!.id} player={p!} size={52} />
            ))}
          </div>
        </div>
      )}
      <div className="slab row spread">
        <span className="muted">Tus monedas</span>
        <Coins n={me.coins} big />
      </div>
      <Feed view={view} limit={4} />
    </section>
  );
}

export function useTimeLeft(endsAt: number | null) {
  return useCountdown(endsAt);
}
