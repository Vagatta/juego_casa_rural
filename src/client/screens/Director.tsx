import { ArrowsIn, ArrowsOut, SidebarSimple } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { Toasts } from '../components/cards.tsx';
import { Button, Candles, Stamp, Timer, Token } from '../components/ui.tsx';
import { GameContext, useGame, useGameConnection } from '../lib/net.ts';
import { GIcon } from '../lib/icons.tsx';
import { navigate } from '../lib/router.ts';
import { getSession, saveSession } from '../lib/session.ts';
import { Ceremony } from './Finale.tsx';
import { HostControls } from './HostControls.tsx';
import { CATEGORY, ChallengeCard, ChallengeResult, Feed, RitualOutcome, usePlayers, VoteResult } from './phases.tsx';
import { LoadingHouse } from './Player.tsx';

function useDirectorToken(code: string): string | undefined {
  return useMemo(() => {
    // El enlace "pantalla de la casa" trae el token en el hash (#t=...): nunca viaja al servidor en la URL
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('t');
    if (fromHash) {
      saveSession(code, { hostToken: fromHash });
      history.replaceState(null, '', location.pathname);
      return fromHash;
    }
    return getSession(code)?.hostToken;
  }, [code]);
}

export function DirectorScreen({ code }: { code: string }) {
  const token = useDirectorToken(code);
  const conn = useGameConnection(code, token);
  if (conn.status === 'not_found') {
    return (
      <main className="page center" style={{ justifyContent: 'center' }}>
        <h1 style={{ fontSize: 44 }}>Sin llave de director</h1>
        <p className="muted">Este dispositivo no tiene permiso para dirigir la casa {code}.</p>
        <Button block variant="ghost" onClick={() => navigate('/', true)}>
          Volver al inicio
        </Button>
      </main>
    );
  }
  if (!conn.view) return <LoadingHouse />;
  return (
    <GameContext.Provider value={conn}>
      <DirectorApp />
      <Toasts items={conn.toasts.filter((t) => !t.private)} onDismiss={conn.dismissToast} />
      {conn.status === 'offline' && <div className="conn-banner">Reconectando...</div>}
    </GameContext.Provider>
  );
}

function DirectorApp() {
  const { view } = useGame();
  const [panel, setPanel] = useState(true);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return (
    <main className={`director ${panel ? '' : 'director--tv'}`}>
      <div className="director__stage">
        <div className="director__bar">
          <span className="display director__brand"><GIcon id="casa" size={20} /> La Casa Rural</span>
          <span className="chip">Casa {view.code}</span>
          <span className="grow" />
          <Candles velas={view.velas} grietas={view.grietas} slots={view.candleSlots} compact />
          <button
            type="button"
            className="icon-btn"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
            aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            aria-pressed={fullscreen}
          >
            {fullscreen ? <ArrowsIn size={20} weight="light" /> : <ArrowsOut size={20} weight="light" />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setPanel(!panel)} aria-label={panel ? 'Modo TV: ocultar controles' : 'Mostrar controles'} aria-pressed={!panel}>
            <SidebarSimple size={20} weight="light" />
          </button>
        </div>
        <Stage />
        <ReactionsOverlay />
      </div>
      {panel && (
        <aside className="director__panel" aria-label="Controles del director">
          <h2 className="director__paneltitle"><GIcon id="corona" size={20} /> Director</h2>
          <p className="muted small">Ves lo mismo que la casa. Los secretos se quedan en cada móvil.</p>
          <HostControls />
        </aside>
      )}
    </main>
  );
}

/** Reacciones flotando sobre la TV ~3s: emoji + nombre. Nadie sabe si ese 🔪 va en serio. */
export function ReactionsOverlay() {
  const { reactions } = useGame();
  const { byId } = usePlayers();
  if (!reactions.length) return null;
  return (
    <div className="floaters" aria-hidden>
      {reactions.map((r) => {
        const p = byId.get(r.playerId);
        return (
          <span key={r.id} className="floater" style={{ left: `${8 + ((r.id * 37) % 78)}%` }}>
            <span className="floater__emoji">{r.emoji}</span>
            {p && <span className="floater__name">{p.name}</span>}
          </span>
        );
      })}
    </div>
  );
}

function JoinQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const url = `${location.origin}/unirse/${code}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#2a2017', light: '#efe3c7' } }).then(setSrc).catch(() => setSrc(null));
  }, [url]);
  return (
    <figure className="qr paper">
      {src ? <img src={src} alt={`Código QR para unirse a la casa ${code}`} width={220} height={220} /> : <div className="qr__ph" />}
      <figcaption className="small">{url.replace(/^https?:\/\//, '')}</figcaption>
    </figure>
  );
}

export function Stage() {
  const { view } = useGame();
  const { active, get } = usePlayers();
  const c = view.challenge;

  switch (view.phase) {
    case 'LOBBY':
      return (
        <section className="stage stage--lobby">
          <div className="stack">
            <span className="eyebrow">Código de partida</span>
            <span className="stage__code">{view.code}</span>
            <p className="muted stage__lead">Entrad desde el móvil: «Unirse a partida».</p>
          </div>
          <JoinQr code={view.code} />
          <div className="stage__players stagger">
            {active.map((p) => (
              <Token key={p.id} player={{ ...p, acted: false }} size={92} />
            ))}
            {active.length === 0 && <p className="muted">La casa está vacía. De momento.</p>}
          </div>
        </section>
      );
    case 'ROLE_REVEAL':
      return (
        <section className="stage stage--center">
          <h1 className="stage__title rise">Mirad vuestro móvil</h1>
          <p className="stage__lead hand">Que nadie mire la pantalla de nadie.</p>
          <div className="stage__players">
            {active.map((p) => (
              <Token key={p.id} player={{ ...p, acted: p.ready }} size={84} />
            ))}
          </div>
        </section>
      );
    case 'ROUND_INTRO':
      return (
        <section className="stage stage--center">
          <span className="eyebrow">Ronda {view.round!.index + 1} de {view.round!.total}</span>
          <h1 className="stage__title deal">{view.round!.title}</h1>
          {view.round!.hasJudgment && <span className="chip chip--danger"><GIcon id="subasta" size={13} /> Esta ronda hay juicio</span>}
          {view.event && (
            <div className="stage__event pop">
              <span className="stage__eventemoji">{view.event.emoji}</span>
              <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                <strong className="display">{view.event.title}</strong>
                <span>{view.event.text}</span>
              </div>
              {view.event.endsAt && <Timer endsAt={view.event.endsAt} />}
            </div>
          )}
          <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
        </section>
      );
    case 'CHALLENGE': {
      if (!c) return null;
      const cat = CATEGORY[c.category];
      const hunting = c.kind === 'code_hunt' && c.status === 'running';
      const hiding = hunting && (c.pub.huntStartsAt ?? 0) > view.serverNow;
      return (
        <section className="stage stage--challenge">
          <div className="stage__col">
            <span className="eyebrow"><GIcon id={cat.icon} size={16} /> Prueba {cat.label.toLowerCase()}</span>
            <ChallengeCard c={c} big />
          </div>
          <div className="stage__col stage__col--side">
            {c.status === 'briefing' && <p className="stage__lead hand">Leed en voz alta. Preparados...</p>}
            {hiding && <Timer endsAt={c.pub.huntStartsAt ?? null} label={`${get(c.pub.hiderId!)?.name} esconde el código`} big />}
            {(c.status === 'running' && !hiding) || c.status === 'voting' ? (
              <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label={c.status === 'voting' ? 'Votación' : 'Tiempo'} big />
            ) : null}
            {c.status === 'briefing' && <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} label="Empezamos en" />}
            {c.status === 'done' && <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />}
            {c.status === 'judging' && <p className="stage__lead">El director delibera...</p>}
            {c.status === 'done' && <ChallengeResult c={c} big />}
            {c.status !== 'done' && c.kind !== 'physical' && (
              <div className="stage__players stage__players--sm">
                {view.players.filter((p) => c.participants.includes(p.id) || p.id === c.pub.speakerId).map((p) => (
                  <Token key={p.id} player={p} size={60} />
                ))}
              </div>
            )}
          </div>
        </section>
      );
    }
    case 'RITUAL': {
      const r = view.ritual!;
      if (r.status === 'revealed')
        return (
          <section className="stage stage--center">
            <RitualOutcome view={view} big />
            <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
          </section>
        );
      return (
        <section className="stage stage--center">
          <span className="eyebrow">El Ritual de la Vela</span>
          <h1 className="stage__title">Encender o apagar</h1>
          <p className="stage__lead hand">Un solo apagón y se abre una grieta.</p>
          <div className="stage__players">
            {r.participants.map((id) => get(id)).filter(Boolean).map((p) => (
              <Token key={p!.id} player={p!} size={84} />
            ))}
          </div>
          <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
        </section>
      );
    }
    case 'INVESTIGATION':
      return (
        <section className="stage stage--center">
          <span className="eyebrow">Investigación</span>
          <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} big />
          <p className="stage__lead hand">Habla. Sospecha. Compra. Miente.</p>
          <div className="stage__feed">
            <Feed view={view} limit={6} />
          </div>
        </section>
      );
    case 'VOTING':
    case 'FINAL_ACCUSATION': {
      const v = view.vote!;
      if (v.status === 'revealed' && v.result)
        return (
          <section className="stage stage--center">
            <VoteResult view={view} big />
            <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
          </section>
        );
      return (
        <section className="stage stage--center">
          <span className="eyebrow">{v.kind === 'final' ? 'La Gran Acusación' : 'Juicio'}</span>
          <h1 className="stage__title">{v.kind === 'final' ? '¿Quiénes son los Cucos?' : '¿Quién es un Cuco?'}</h1>
          <p className="stage__lead">
            {v.votedCount} de {v.total} han votado
          </p>
          <div className="stage__players">
            {active.map((p) => (
              <Token key={p.id} player={p} size={84} />
            ))}
          </div>
          <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
        </section>
      );
    }
    case 'ROUND_RESULT': {
      const last = view.lastRound;
      return (
        <section className="stage stage--center">
          <span className="eyebrow">Fin de la ronda {(last?.index ?? 0) + 1}</span>
          {last?.outcome === 'vela' && <Stamp tone="safe">Una vela más</Stamp>}
          {last?.outcome === 'grieta' && <Stamp tone="danger">La casa cruje</Stamp>}
          <Candles velas={view.velas} grietas={view.grietas} slots={view.candleSlots} />
          {last && last.suspects.length > 0 && (
            <div className="stack center">
              <span className="chip chip--danger">Bajo sospecha: fuera del próximo Ritual</span>
              <div className="stage__players">
                {last.suspects.map((id) => get(id)).filter(Boolean).map((p) => (
                  <Token key={p!.id} player={p!} size={96} />
                ))}
              </div>
            </div>
          )}
          <Leaderboard />
          <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />
        </section>
      );
    }
    case 'FINALE':
      return (
        <section className="stage stage--finale">
          <Ceremony />
          {view.settings.autopilot && <Timer endsAt={view.phaseEndsAt} pausedMs={view.pausedRemainingMs} />}
        </section>
      );
  }
}

function Leaderboard() {
  const { active } = usePlayers();
  const top = [...active].sort((a, b) => b.coins - a.coins).slice(0, 5);
  return (
    <ol className="leader">
      {top.map((p, i) => (
        <li key={p.id} style={{ animationDelay: `${i * 60}ms` }}>
          <Token player={p} size={40} label={false} />
          <span className="grow">{p.name}</span>
          <span className="display">{p.coins} <GIcon id="coins" size={14} /></span>
        </li>
      ))}
    </ol>
  );
}
