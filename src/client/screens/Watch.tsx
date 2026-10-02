import { Toasts } from '../components/cards.tsx';
import { GIcon } from '../lib/icons.tsx';
import { Button } from '../components/ui.tsx';
import { GameContext, pausedMsFor, useGameConnection } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';
import { BlackoutOverlay, ReactionsOverlay, Stage } from './Director.tsx';
import { LoadingHouse } from './Player.tsx';

/** Modo espectador: la TV de la casa sin ser jugador. Solo datos públicos — ningún secreto sale del servidor. */
export function WatchScreen({ code }: { code: string }) {
  const conn = useGameConnection(code, 'spectator');
  if (conn.status === 'not_found' || conn.status === 'kicked') {
    return (
      <main className="page center" style={{ justifyContent: 'center' }}>
        <GIcon id="mirilla" size={64} />
        <h1 style={{ fontSize: 44 }}>No hay casa con ese código</h1>
        <p className="muted">Revisa el código o espera a que abran la partida.</p>
        <Button block variant="ghost" onClick={() => navigate('/', true)}>
          Volver al inicio
        </Button>
      </main>
    );
  }
  if (!conn.view) return <LoadingHouse />;
  return (
    <GameContext.Provider value={conn}>
      <main className="director director--tv">
        <div className="director__stage">
          {conn.view.event?.blackout && conn.view.event.endsAt && <BlackoutOverlay endsAt={conn.view.event.endsAt} pausedMs={pausedMsFor(conn.view, conn.view.event.endsAt)} />}
          <div className="director__bar">
            <span className="display director__brand"><GIcon id="casa" size={20} /> La Casa Rural</span>
            <span className="chip">Casa {conn.view.code}</span>
            <span className="grow" />
            <span className="chip chip--warn"><GIcon id="mirilla" size={13} /> Mirando</span>
          </div>
          <Stage />
          <ReactionsOverlay />
        </div>
      </main>
      <Toasts items={conn.toasts.filter((t) => !t.private)} onDismiss={conn.dismissToast} />
      {conn.status === 'offline' && <div className="conn-banner">Reconectando...</div>}
    </GameContext.Provider>
  );
}
