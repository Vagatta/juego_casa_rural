import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { FinaleView } from '../../shared/types.ts';
import { FACTION_LABEL, RoleCard } from '../components/cards.tsx';
import { Button, Candles, Token } from '../components/ui.tsx';
import { AWARD_ICON, GIcon, RoleIcon } from '../lib/icons.tsx';
import { useGame } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';
import { play } from '../lib/sound.ts';
import { usePlayers } from './phases.tsx';

/** Número que cuenta hacia arriba (respeta reduced-motion: salta al final). */
function CountUp({ to, delay = 0 }: { to: number; delay?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(to);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / 900));
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay]);
  return <>{n}</>;
}

export function Ceremony({ compact }: { compact?: boolean }) {
  const { view } = useGame();
  const f = view.finale;
  const [photo, setPhoto] = useState(false);
  const stepRef = useRef(-1);
  useEffect(() => {
    if (!f || stepRef.current === f.step) return;
    stepRef.current = f.step;
    play(f.step === 4 || f.step === 7 ? 'victory' : 'reveal');
  }, [f]);
  if (!f) return null;

  const last = f.step === f.totalSteps - 1;
  // Modo foto: la crónica y el veredicto limpios, sin cromos — pantalla pensada
  // para que alguien le haga una foto de pie o la comparta luego.
  if (photo && last) return <PhotoMode f={f} onClose={() => setPhoto(false)} />;

  return (
    <section className={`ceremony ${compact ? 'ceremony--compact' : 'ceremony--big'}`} key={f.step}>
      <Step f={f} compact={compact} />
      {compact && (
        <p className="muted small center ceremony__progress">
          {f.step + 1} / {f.totalSteps} · el director avanza la ceremonia
        </p>
      )}
      {last && (
        <>
          <Button variant="ghost" onClick={() => setPhoto(true)}>
            <GIcon id="fotografa" size={18} /> Modo foto
          </Button>
          {compact && view.me && !view.me.isHost && <p className="muted small center">El director puede abrir otra noche con esta misma gente.</p>}
          <Button variant="ghost" onClick={() => navigate('/')}>
            Volver al inicio
          </Button>
        </>
      )}
    </section>
  );
}

/** Pantalla limpia para captura: cartel de la noche, veredicto y crónica. */
function PhotoMode({ f, onClose }: { f: FinaleView; onClose: () => void }) {
  const { view } = useGame();
  const { get } = usePlayers();
  const winner = get(f.ranking[0]?.playerId);
  return (
    <div className="photo-mode" role="dialog" aria-label="Resumen para foto">
      <button type="button" className="photo-mode__close" onClick={onClose} aria-label="Salir del modo foto">
        <X size={22} weight="light" />
      </button>
      <span className="eyebrow photo-mode__eyebrow">La casa {view.code} presenta</span>
      <h1 className="photo-mode__title">La noche termina</h1>
      <p className="photo-mode__verdict">
        <GIcon id={f.balance.winner === 'huespedes' ? 'casa' : 'racha'} size={18} /> {f.balance.winner === 'huespedes' ? 'La casa se salvó' : 'La casa es de los Cucos'} · {winner?.name} se llevó {f.ranking[0]?.total} <GIcon id="coins" size={14} />
      </p>
      <article className="chronicle paper photo-mode__paper">
        {f.chronicle.map((line, i) => (
          <p key={i} className="hand">
            {line}
          </p>
        ))}
      </article>
      <p className="photo-mode__footer muted small">LA CASA RURAL · una noche que nadie va a olvidar</p>
    </div>
  );
}

function Step({ f, compact }: { f: FinaleView; compact?: boolean }) {
  const { get } = usePlayers();
  const { view } = useGame();
  const size = compact ? 52 : 96;

  switch (f.step) {
    case 0:
      return (
        <div className="stack center ceremony__intro">
          <h1 className="ceremony__title rise">La noche termina</h1>
          <ul className="ceremony__numbers stagger">
            <li><strong><CountUp to={f.headline.players} /></strong> jugadores</li>
            <li><strong><CountUp to={f.headline.missions} delay={200} /></strong> misiones</li>
            <li><strong><CountUp to={f.headline.clues} delay={400} /></strong> pistas</li>
            <li><strong><CountUp to={f.headline.traiciones} delay={600} /></strong> traiciones</li>
          </ul>
          <Candles velas={f.headline.velas} grietas={f.headline.grietas} slots={view.candleSlots} />
        </div>
      );
    case 1:
      return (
        <div className="stack center ceremony__question">
          <p className="hand rise" style={{ fontSize: compact ? 34 : 64 }}>Pero...</p>
          <h1 className="ceremony__title rise" style={{ animationDelay: '700ms' }}>¿Quién estaba mintiendo?</h1>
        </div>
      );
    case 2: {
      const cucos = f.reveal.filter((r) => r.faction === 'cuco');
      return (
        <div className="stack center">
          <h2 className="ceremony__h rise">{cucos.length === 1 ? 'El Cuco' : 'Los Cucos'}</h2>
          <div className="ceremony__cards">
            {cucos.map((r, i) => (
              <RevealCard key={r.playerId} playerId={r.playerId} roleId={r.roleId} f={f} delay={600 + i * 1400} unmasked={f.unmasked.includes(r.playerId)} />
            ))}
          </div>
        </div>
      );
    }
    case 3:
      return (
        <div className="stack center">
          <h2 className="ceremony__h rise">Toda la casa</h2>
          <div className="ceremony__grid stagger">
            {f.reveal.map((r) => {
              const p = get(r.playerId);
              const role = f.roles[r.roleId];
              if (!p || !role) return null;
              return (
                <div key={r.playerId} className={`ceremony__who ceremony__who--${r.faction}`}>
                  <Token player={p} size={compact ? 44 : 72} />
                  <span className="small">
                    <RoleIcon roleId={r.roleId} emoji={role.emoji} size={18} /> {role.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    case 4: {
      const win = f.balance.winner;
      return (
        <div className="stack center">
          <h2 className="ceremony__h rise">La Balanza</h2>
          <div className={`balance balance--${win}`}>
            <div className="balance__side balance__side--h">
              <span className="display balance__n"><CountUp to={f.balance.huespedes} /></span>
              <span>Huéspedes</span>
              <span className="small muted">{f.headline.velas} velas + {f.unmasked.length} × 2 Cucos pillados</span>
            </div>
            <div className="balance__side balance__side--c">
              <span className="display balance__n"><CountUp to={f.balance.cucos} /></span>
              <span>Cucos</span>
              <span className="small muted">{f.headline.grietas} grietas + {view.cucoCount - f.unmasked.length} × 2 escondidos</span>
            </div>
          </div>
          <h1 className={`ceremony__title pop ${win === 'cucos' ? 'is-danger' : 'is-safe'}`} style={{ animationDelay: '1100ms' }}>
            {win === 'huespedes' ? 'La casa se salva' : 'La casa es de los Cucos'}
          </h1>
          {f.turistaWon && <p className="hand pop" style={{ fontSize: compact ? 28 : 48, animationDelay: '1800ms' }}>Y el Turista, {get(f.turistaWon)?.name}, se lleva el premio gordo <GIcon id="turista" size={compact ? 24 : 40} /></p>}
          {f.buscavidasWon && <p className="hand pop" style={{ fontSize: compact ? 28 : 48, animationDelay: '2000ms' }}>El Buscavidas, {get(f.buscavidasWon)?.name}, se marcha entre los tres más ricos <GIcon id="buscavidas" size={compact ? 24 : 40} /></p>}
          {f.predictions.length > 0 && (
            <div className="slab stack pop" style={{ '--gap': '6px', animationDelay: '2000ms', maxWidth: 420 } as React.CSSProperties}>
              <strong className="display" style={{ fontSize: 24 }}><GIcon id="prediccion" size={20} /> Primeras impresiones</strong>
              {f.predictions.map((x) => (
                <span key={x.playerId} className="small">
                  <GIcon id={x.hit ? 'laurel' : 'grieta'} size={13} /> {get(x.playerId)?.name} sospechó de {get(x.targetId)?.name} desde el minuto 1{x.hit ? <> · +60 <GIcon id="coins" size={12} /></> : null}
                </span>
              ))}
            </div>
          )}
          {f.bets.length > 0 && (
            <div className="slab stack pop" style={{ '--gap': '6px', animationDelay: '2200ms', maxWidth: 420 } as React.CSSProperties}>
              <strong className="display" style={{ fontSize: 24 }}><GIcon id="dados" size={20} /> La mesa de apuestas</strong>
              {f.bets.map((b) => (
                <span key={b.playerId} className="small">
                  <GIcon id={b.won ? 'laurel' : 'grieta'} size={13} /> {get(b.playerId)?.name} {b.won ? `ganó ${b.amount * 2}` : `perdió ${b.amount}`} <GIcon id="coins" size={12} /> por {get(b.targetId)?.name}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    case 5:
      return (
        <div className="stack">
          <h2 className="ceremony__h center rise">Lo que pasó de verdad</h2>
          {f.missionHighlights.length === 0 && <p className="muted center">Nadie cumplió ninguna misión. Una casa muy honrada.</p>}
          <div className={`ceremony__notes stagger`}>
            {f.missionHighlights.map((m, i) => (
              <article key={i} className="note">
                <span className="clue__source"><GIcon id="laurel" size={13} /> {get(m.playerId)?.name}</span>
                <p className="note__text">{m.text}</p>
              </article>
            ))}
            {f.falseClues.slice(0, 3).map((c, i) => (
              <article key={`f${i}`} className="note clue--nota">
                <span className="clue__source">
                  <GIcon id="mentira" size={13} /> Pista falsa de {get(c.recipientId)?.name}
                  {c.forgedBy ? `, escrita por ${get(c.forgedBy)?.name}` : ''}
                </span>
                <p className="note__text">{c.text}</p>
              </article>
            ))}
          </div>
        </div>
      );
    case 6:
      return (
        <div className="stack center">
          <h2 className="ceremony__h rise">Los premios de la casa</h2>
          <div className="awards stagger">
            {f.awards.map((a) => {
              const p = get(a.playerId);
              if (!p) return null;
              return (
                <article key={a.id} className="award paper">
                  <span className="award__emoji"><GIcon id={AWARD_ICON[a.id] ?? 'medalla'} size={40} /></span>
                  <span className="display award__title">{a.title}</span>
                  <Token player={p} size={compact ? 44 : 64} />
                  <span className="small award__reason">{a.reason}</span>
                </article>
              );
            })}
          </div>
        </div>
      );
    case 7: {
      const [first, second, third, ...rest] = f.ranking;
      const podium = [second, first, third].filter(Boolean);
      return (
        <div className="stack center">
          <h2 className="ceremony__h rise">Campeón de la casa</h2>
          <div className="podium">
            {podium.map((r) => {
              const p = get(r.playerId);
              const place = f.ranking.indexOf(r) + 1;
              if (!p) return null;
              return (
                <div key={r.playerId} className={`podium__step podium__step--${place}`}>
                  <Token player={p} size={place === 1 ? size * 1.3 : size} />
                  <span className="display podium__coins">{r.total} <GIcon id="coins" size={16} /></span>
                  {r.bonus > 0 && <span className="small muted">+{r.bonus} de bonus</span>}
                  <span className="podium__block display">{place}º</span>
                </div>
              );
            })}
          </div>
          <ol className="ranking" start={4}>
            {rest.map((r) => (
              <li key={r.playerId}>
                <span className="grow">{get(r.playerId)?.name}</span>
                <span className="display">{r.total} <GIcon id="coins" size={14} /></span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case 8:
      return (
        <div className="stack">
          <h2 className="ceremony__h center rise">Estadísticas de la noche</h2>
          <ul className="funstats stagger">
            {f.funStats.map((s, i) => (
              <li key={i} className="hand">
                {s}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return (
        <div className="stack">
          <h2 className="ceremony__h center rise">La crónica de la noche</h2>
          <article className="chronicle paper">
            {f.chronicle.map((line, i) => (
              <p key={i} className="hand" style={{ animationDelay: `${i * 350}ms` }}>
                {line}
              </p>
            ))}
          </article>
        </div>
      );
  }
}

function RevealCard({ playerId, roleId, f, delay, unmasked }: { playerId: string; roleId: string; f: FinaleView; delay: number; unmasked: boolean }) {
  const { get } = usePlayers();
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setFlipped(true);
      play('danger');
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);
  const p = get(playerId);
  const role = f.roles[roleId];
  if (!p || !role) return null;
  return (
    <div className="reveal-card">
      <RoleCard role={role} flipped={flipped} />
      <div className={`reveal-card__who ${flipped ? 'is-in' : ''}`}>
        <Token player={p} size={56} />
        <span className={`chip ${unmasked ? 'chip--safe' : 'chip--danger'}`}>{unmasked ? 'Desenmascarado' : 'Nadie le pilló'}</span>
        <span className="small muted">{FACTION_LABEL[role.faction]}</span>
      </div>
    </div>
  );
}
