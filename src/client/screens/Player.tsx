import { House, MagnifyingGlass, Notebook, Scroll, SpeakerHigh, SpeakerSlash, Storefront, UserCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Sheet, Toasts } from '../components/cards.tsx';
import { HideButton } from '../components/privacy.tsx';
import { Button, Coins } from '../components/ui.tsx';
import { GameContext, useGame, useGameConnection } from '../lib/net.ts';
import { recordNight } from '../lib/badges.ts';
import { navigate } from '../lib/router.ts';
import { getSession } from '../lib/session.ts';
import { onSoundChange, setSoundEnabled, soundEnabled } from '../lib/sound.ts';
import { GIcon } from '../lib/icons.tsx';
import { HostControls } from './HostControls.tsx';
import { CluesTab, MeTab, MissionsTab, NotesTab, ShopTab } from './tabs.tsx';
import { NowTab } from './phases.tsx';

type Tab = 'ahora' | 'misiones' | 'pistas' | 'despensa' | 'notas' | 'yo';

export function PlayerScreen({ code }: { code: string }) {
  // #t=<playerToken> permite abrir a un jugador concreto sin sesión local (mesa de pruebas, móvil prestado)
  const hashToken = new URLSearchParams(location.hash.slice(1)).get('t');
  const conn = useGameConnection(code, hashToken ?? getSession(code)?.playerToken);

  if (conn.status === 'not_found' || conn.status === 'kicked') {
    return (
      <main className="page center" style={{ justifyContent: 'center' }}>
        <GIcon id={conn.status === 'kicked' ? 'salir' : 'av-llave'} size={64} />
        <h1 style={{ fontSize: 44 }}>{conn.status === 'kicked' ? 'Te han echado de la casa' : 'No encuentro tu llave'}</h1>
        <p className="muted">{conn.status === 'kicked' ? 'El director te ha sacado de esta partida, u otro móvil ha tomado tu relevo.' : `No hay sesión guardada para la casa ${code} en este móvil, o la partida ya no existe.`}</p>
        {conn.status === 'not_found' && (
          <Button block arrow onClick={() => navigate(`/unirse/${code}`, true)}>
            Entrar con otro nombre
          </Button>
        )}
        <Button block variant="ghost" onClick={() => navigate('/', true)}>
          Volver al inicio
        </Button>
      </main>
    );
  }

  if (!conn.view) return <LoadingHouse />;

  return (
    <GameContext.Provider value={conn}>
      <PlayerApp />
      <Toasts items={conn.toasts} onDismiss={conn.dismissToast} />
      {conn.status === 'offline' && <div className="conn-banner">Reconectando con la casa...</div>}
    </GameContext.Provider>
  );
}

export function LoadingHouse() {
  return (
    <main className="page center" style={{ justifyContent: 'center' }} aria-busy>
      <span className="loading-house"><GIcon id="casa" size={64} /></span>
      <p className="muted">Encendiendo las luces de la casa...</p>
    </main>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundEnabled());
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button type="button" className="icon-btn" onClick={() => setSoundEnabled(!on)} aria-label={on ? 'Silenciar' : 'Activar sonido'} aria-pressed={on}>
      {on ? <SpeakerHigh size={22} weight="light" /> : <SpeakerSlash size={22} weight="light" />}
    </button>
  );
}

function PlayerApp() {
  const { view } = useGame();
  const [tab, setTab] = useState<Tab>('ahora');
  const [hostOpen, setHostOpen] = useState(false);
  const me = view.me!;
  const inGame = view.phase !== 'LOBBY';

  // Cambio de fase: volvemos a "Ahora", que es donde está la acción
  const lastPhase = useRef(view.phase);
  useEffect(() => {
    if (lastPhase.current !== view.phase) {
      lastPhase.current = view.phase;
      setTab('ahora');
      window.scrollTo({ top: 0 });
    }
  }, [view.phase]);

  // La ceremonia reparte medallas: se acumulan en este dispositivo entre noches
  useEffect(() => {
    if (view.phase === 'FINALE' && view.finale) recordNight(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase === 'FINALE']);

  const seen = useSeenCounter();
  const activeMissions = view.missions?.filter((m) => m.status === 'active').length ?? 0;
  const newMissions = seen.count('m', view.missions?.map((m) => m.id) ?? [], tab === 'misiones');
  const newClues = seen.count('c', view.clues?.map((c) => c.id) ?? [], tab === 'pistas');

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'ahora', label: 'Ahora', icon: <House size={24} weight={tab === 'ahora' ? 'fill' : 'light'} /> },
    { id: 'misiones', label: 'Misiones', icon: <Scroll size={24} weight={tab === 'misiones' ? 'fill' : 'light'} />, badge: newMissions },
    { id: 'pistas', label: 'Pistas', icon: <MagnifyingGlass size={24} weight={tab === 'pistas' ? 'fill' : 'light'} />, badge: newClues },
    { id: 'despensa', label: 'Despensa', icon: <Storefront size={24} weight={tab === 'despensa' ? 'fill' : 'light'} /> },
    { id: 'notas', label: 'Notas', icon: <Notebook size={24} weight={tab === 'notas' ? 'fill' : 'light'} /> },
    { id: 'yo', label: 'Yo', icon: <UserCircle size={24} weight={tab === 'yo' ? 'fill' : 'light'} /> },
  ];

  return (
    <main className={`page ${inGame ? 'page--tabs' : ''}`}>
      <header className="topbar">
        <span className="token__disc" style={{ '--pc': me.color, '--size': '40px' } as React.CSSProperties} aria-hidden>
          <span className="token__emoji">{me.avatar}</span>
        </span>
        <div className="topbar__round grow">
          <strong>{view.round ? `Ronda ${view.round.index + 1} · ${view.round.title}` : `Casa ${view.code}`}</strong>
          <span>{me.name}{inGame && activeMissions ? ` · ${activeMissions} ${activeMissions === 1 ? 'misión' : 'misiones'}` : ''}</span>
        </div>
        <Coins n={me.coins} />
        {me.isHost && (
          <button type="button" className="icon-btn icon-btn--crown" onClick={() => setHostOpen(true)} aria-label="Mando del director">
            <GIcon id="corona" size={22} />
          </button>
        )}
        <SoundToggle />
        <HideButton />
      </header>

      {tab === 'ahora' && <NowTab goTo={setTab} />}
      {tab === 'misiones' && <MissionsTab />}
      {tab === 'pistas' && <CluesTab />}
      {tab === 'despensa' && <ShopTab />}
      {tab === 'notas' && <NotesTab />}
      {tab === 'yo' && <MeTab />}

      {inGame && (
        <nav className="tabbar" aria-label="Secciones">
          {tabs.map((t) => (
            <button type="button" key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.icon}
              {t.label}
              {!!t.badge && <span className="tabbar__dot">{t.badge}</span>}
            </button>
          ))}
        </nav>
      )}

      {me.isHost && (
        <Sheet open={hostOpen} onClose={() => setHostOpen(false)} title="Director" icon="corona">
          <HostControls compact />
        </Sheet>
      )}
    </main>
  );
}

/** Cuenta elementos nuevos que el jugador aún no ha visto en su pestaña. */
function useSeenCounter() {
  const seenRef = useRef<Record<string, Set<string>>>({});
  return {
    count(kind: string, ids: string[], viewing: boolean) {
      const seen = (seenRef.current[kind] ??= new Set<string>());
      if (viewing) ids.forEach((id) => seen.add(id));
      return ids.filter((id) => !seen.has(id)).length;
    },
  };
}
