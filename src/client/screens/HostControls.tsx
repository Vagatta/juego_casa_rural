import { Lightning, Minus, Pause, Play, Plus, Television, UserMinus } from '@phosphor-icons/react';
import { useState } from 'react';
import { PlayerPicker } from '../components/cards.tsx';
import { Button, InlineError, Token } from '../components/ui.tsx';
import { GIcon } from '../lib/icons.tsx';
import { useGame } from '../lib/net.ts';
import { getSession } from '../lib/session.ts';

function useHostAction() {
  const { host } = useGame();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const ack = await host(action);
    setBusy(false);
    if (!ack.ok) setError(ack.error ?? 'No se pudo');
    return ack.ok;
  };
  return { run, busy, error };
}

/** Panel del director. Solo muestra información pública + progreso (nunca secretos). */
export function HostControls({ compact }: { compact?: boolean }) {
  const { view } = useGame();
  const h = view.host;
  const { run, busy, error } = useHostAction();
  const [winners, setWinners] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  if (!h) return null;
  const c = view.challenge;
  const hasTimer = view.phaseEndsAt !== null || view.pausedRemainingMs !== null;
  const participants = view.players.filter((p) => c?.participants.includes(p.id));
  const session = getSession(view.code);

  return (
    <div className={`hostctl ${compact ? 'hostctl--compact' : ''}`}>
      <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <Button block arrow disabled={!h.primary.enabled || busy} onClick={() => run({ type: 'advance' })}>
          {h.primary.label}
        </Button>
        {h.primary.hint && <p className="muted small center">{h.primary.hint}</p>}
      </div>

      {h.canJudge && (
        <div className="row">
          <Button variant="safe" className="grow" disabled={busy} onClick={() => run({ type: 'judge', passed: true })}>
            Superada
          </Button>
          <Button variant="danger" className="grow" disabled={busy} onClick={() => run({ type: 'judge', passed: false })}>
            Fallada
          </Button>
        </div>
      )}

      {h.canPickWinners && (
        <div className="stack">
          <p className="display" style={{ fontSize: 20 }}>¿Quién ha ganado?</p>
          <PlayerPicker players={participants} max={participants.length} selected={winners} onChange={setWinners} />
          <Button variant="safe" block disabled={busy || !winners.length} onClick={() => run({ type: 'judge', winners }).then((ok) => ok && setWinners([]))}>
            Dar la victoria
          </Button>
        </div>
      )}

      {hasTimer && (
        <div className="hostctl__timer">
          {view.pausedRemainingMs !== null ? (
            <Button small variant="safe" onClick={() => run({ type: 'resume' })} disabled={busy}>
              <Play size={18} weight="fill" /> Seguir
            </Button>
          ) : (
            <Button small variant="ghost" onClick={() => run({ type: 'pause' })} disabled={busy}>
              <Pause size={18} weight="fill" /> Pausa
            </Button>
          )}
          <Button small variant="ghost" onClick={() => run({ type: 'extend', seconds: 30 })} disabled={busy}>
            +30 s
          </Button>
          <Button small variant="ghost" onClick={() => run({ type: 'extend', seconds: 60 })} disabled={busy}>
            +1 min
          </Button>
        </div>
      )}

      {view.phase !== 'FINALE' && (
        <Button
          small
          variant={view.settings.autopilot ? 'safe' : 'ghost'}
          disabled={busy}
          onClick={() => run({ type: 'autopilot', on: !view.settings.autopilot })}
        >
          <GIcon id="robot" size={14} /> {view.settings.autopilot ? 'Piloto: la casa avanza sola' : 'Piloto apagado (manual)'}
        </Button>
      )}

      <InlineError error={error} />

      {h.eventsAvailable.length > 0 && (
        <details className="hostctl__section">
          <summary>
            <Lightning size={18} weight="fill" /> Lanzar evento
          </summary>
          <div className="hostctl__events">
            {h.eventsAvailable.map((e) => (
              <button
                type="button"
                key={e.id}
                className="chip hostctl__event"
                disabled={busy}
                onClick={() => (confirm === e.id ? run({ type: 'event', eventId: e.id }).then(() => setConfirm(null)) : setConfirm(e.id))}
              >
                {e.emoji} {confirm === e.id ? '¿Lanzar?' : e.title}
              </button>
            ))}
          </div>
        </details>
      )}

      <details className="hostctl__section" open={!compact && view.phase === 'LOBBY'}>
        <summary>Jugadores ({view.players.filter((p) => !p.left).length})</summary>
        <ul className="hostctl__players">
          {view.players.map((p) => (
            <li key={p.id} className={p.left ? 'is-left' : ''}>
              <Token player={p} size={36} label={false} />
              <span className="grow hostctl__pname">
                {p.name}
                <span className="muted small"> {p.left ? 'se fue' : p.connected ? <>{p.coins} <GIcon id="coins" size={12} /></> : 'desconectado'}</span>
              </span>
              {!p.left && view.phase !== 'LOBBY' && (
                <>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Multar a ${p.name}`} onClick={() => run({ type: 'adjustCoins', playerId: p.id, delta: -10 })}>
                    <Minus size={16} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Dar monedas a ${p.name}`} onClick={() => run({ type: 'adjustCoins', playerId: p.id, delta: 10 })}>
                    <Plus size={16} />
                  </button>
                </>
              )}
              {!p.left && !p.isHost && (
                <button
                  type="button"
                  className={`icon-btn icon-btn--sm ${confirm === `kick:${p.id}` ? 'is-danger' : ''}`}
                  aria-label={`Expulsar a ${p.name}`}
                  onClick={() => (confirm === `kick:${p.id}` ? run({ type: 'kick', playerId: p.id }).then(() => setConfirm(null)) : setConfirm(`kick:${p.id}`))}
                >
                  <UserMinus size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {view.phase !== 'LOBBY' && <p className="muted small">− / + ajusta 10 monedas (multas de eventos, incidencias).</p>}
      </details>

      {session?.hostToken && compact && (
        <details className="hostctl__section">
          <summary>
            <Television size={18} weight="light" /> Pantalla de la casa
          </summary>
          <p className="muted small">Abre este enlace en una tele, portátil o tablet para proyectar la partida. Solo muestra información pública.</p>
          <a className="btn btn--ghost btn--small" href={`/director/${view.code}#t=${session.hostToken}`} target="_blank" rel="noreferrer">
            Abrir pantalla
          </a>
          <p className="muted small">¿Alguien quiere mirar sin jugar? Que abra <code>/ver/{view.code}</code> — ve la TV pública sin ser jugador.</p>
        </details>
      )}

      {h.sealAvailable && (
        <details className="hostctl__section">
          <summary><GIcon id="notario" size={15} /> Sobre lacrado</summary>
          <p className="muted small">Solo para resolver incidencias. Queda registrado y se anunciará en la ceremonia final.</p>
          {h.secrets && showSecrets ? (
            <ul className="hostctl__players">
              {h.secrets.map((s) => {
                const p = view.players.find((x) => x.id === s.playerId);
                return (
                  <li key={s.playerId}>
                    <span className="grow">{p?.name}</span>
                    <span className={`chip ${s.faction === 'cuco' ? 'chip--danger' : 'chip--safe'}`}>
                      {s.emoji} {s.roleName}
                    </span>
                  </li>
                );
              })}
              <Button small variant="ghost" onClick={() => setShowSecrets(false)}>
                Cerrar el sobre
              </Button>
            </ul>
          ) : (
            <Button small variant="danger" onClick={() => run({ type: 'openSeal' }).then((ok) => ok && setShowSecrets(true))}>
              Romper el lacre
            </Button>
          )}
        </details>
      )}

      {view.phase === 'FINALE' && view.finale && view.finale.step === view.finale.totalSteps - 1 && (
        <Button block variant="safe" disabled={busy} onClick={() => run({ type: 'rematch' })}>
          <GIcon id="otra-noche" size={16} /> Otra noche con esta gente
        </Button>
      )}

      {view.phase !== 'LOBBY' && view.phase !== 'FINALE' && (
        <Button
          small
          variant={confirm === 'end' ? 'danger' : 'ghost'}
          onClick={() => (confirm === 'end' ? run({ type: 'end' }).then(() => setConfirm(null)) : setConfirm('end'))}
        >
          {confirm === 'end' ? '¿Terminar ya? Pulsa otra vez' : 'Terminar la noche ahora'}
        </Button>
      )}
    </div>
  );
}
