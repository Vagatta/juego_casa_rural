import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, GameSettings, GameView, Toast } from '../../shared/types.ts';
import { navigate } from './router.ts';
import { saveSession } from './session.ts';
import { play, vibrate } from './sound.ts';

// ------------------------------------------------------------------ REST

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'No hay conexión con la casa');
  return body;
}

export const api = {
  create: (settings: GameSettings, host?: { name: string; avatar: string }) =>
    request<{ code: string; hostToken: string; playerToken: string | null; playerId: string | null }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({ settings, host }),
    }),
  info: (code: string) =>
    request<{
      code: string;
      phase: string;
      players: number;
      joinable: boolean;
      takenAvatars: string[];
      absentPlayers: { id: string; name: string; avatar: string }[];
      rematchTo: string | null;
    }>(`/api/games/${encodeURIComponent(code)}`),
  join: (code: string, body: { name: string; avatar: string } | { takeId: string }) =>
    request<{ code: string; playerToken: string; playerId: string }>(`/api/games/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  content: () =>
    request<{
      missions: { id: string; text: string }[];
      challenges: { id: string; title: string; instructions: string }[];
      events: { id: string; title: string; text: string }[];
      quiz: { id: string; text: string }[];
      suspect: { id: string; text: string }[];
      couple: { id: string; text: string }[];
      interro: { id: string; text: string }[];
      social: { id: string; text: string }[];
    }>('/api/content'),
};

// ------------------------------------------------------------------ tiempo real

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'not_found' | 'kicked';
export interface ToastItem extends Toast {
  id: number;
}
export interface ReactItem {
  id: number;
  playerId: string;
  emoji: string;
}

export interface GameConn {
  view: GameView | null;
  status: ConnStatus;
  toasts: ToastItem[];
  /** Emojis flotando en la TV ahora mismo (duran ~3s) */
  reactions: ReactItem[];
  /** Date.now() + offset = hora del servidor */
  offset: number;
  send: (action: Record<string, unknown>) => Promise<Ack>;
  host: (action: Record<string, unknown>) => Promise<Ack>;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export function useGameConnection(code: string, token: string | undefined): GameConn {
  const [view, setView] = useState<GameView | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [reactions, setReactions] = useState<ReactItem[]>([]);
  const [offset, setOffset] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    if (!token) {
      setStatus('not_found');
      return;
    }
    const socket = io({ auth: { code, token }, transports: ['websocket', 'polling'], reconnectionDelay: 600, reconnectionDelayMax: 4000 });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('online'));
    socket.on('disconnect', () => setStatus((s) => (s === 'kicked' ? s : 'offline')));
    socket.on('connect_error', (err) => {
      if (err.message === 'not_found') {
        setStatus('not_found');
        socket.disconnect();
      } else if (err.message === 'kicked') {
        setStatus('kicked');
        socket.disconnect();
      } else setStatus('offline');
    });
    socket.on('kicked', () => setStatus('kicked'));
    // Revancha: esta casa cerró y se abrió otra con la misma gente. Mudarse.
    socket.on('rematch', (d: { code: string; playerToken: string | null; hostToken: string | null }) => {
      saveSession(d.code, { playerToken: d.playerToken ?? undefined, hostToken: d.hostToken ?? undefined });
      // Quien no entra en la nueva casa (se fue, lo echaron) vuelve al inicio; el espectador sigue mirando
      if (location.pathname.startsWith('/ver/')) return navigate(`/ver/${d.code}`, true);
      navigate(d.playerToken ? `/partida/${d.code}` : d.hostToken ? `/director/${d.code}` : '/', true);
    });
    socket.on('view', (v: GameView) => {
      setOffset(v.serverNow - Date.now());
      setView(v);
    });
    socket.on('toast', (t: Toast) => {
      const item = { ...t, id: ++toastSeq };
      setToasts((list) => [...list.slice(-3), item]);
      if (t.sound) play(t.sound);
      if (t.private) vibrate([30, 40, 30]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== item.id)), 4200);
    });
    socket.on('react', (r: { playerId: string; emoji: string }) => {
      const item = { ...r, id: ++toastSeq };
      setReactions((list) => [...list.slice(-11), item]);
      setTimeout(() => setReactions((list) => list.filter((x) => x.id !== item.id)), 3200);
    });
    // Al volver a la app desde segundo plano, reconectar al momento
    const onVisible = () => document.visibilityState === 'visible' && !socket.connected && socket.connect();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [code, token]);

  // Pantalla despierta mientras dura la partida: sin esto el móvil se bloquea solo
  // por timeout de pantalla y el jugador se pierde el ritual o el juicio.
  // El sistema suelta el lock al ocultar la app → se vuelve a pedir al volver.
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; released: boolean; addEventListener: (e: string, cb: () => void) => void }> } }).wakeLock;
    if (!wl || !token) return;
    let dead = false;
    let lock: { release: () => Promise<void>; released: boolean } | null = null;
    const acquire = async () => {
      if (dead || document.visibilityState !== 'visible') return;
      try {
        lock = await wl.request('screen');
      } catch {
        lock = null; // sin permiso o sin soporte real: no pasa nada
      }
    };
    const onVisible = () => {
      if (!lock || lock.released) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  const emit = useCallback(async (event: string, action: Record<string, unknown>): Promise<Ack> => {
    const socket = socketRef.current;
    if (!socket?.connected) return { ok: false, error: 'Sin conexión. Reconectando...' };
    try {
      return (await socket.timeout(6000).emitWithAck(event, action)) as Ack;
    } catch {
      return { ok: false, error: 'La casa no responde. Inténtalo otra vez.' };
    }
  }, []);

  const send = useCallback((a: Record<string, unknown>) => emit('player:action', a), [emit]);
  const host = useCallback((a: Record<string, unknown>) => emit('host:action', a), [emit]);

  return { view, status, toasts, reactions, offset, send, host, dismissToast };
}

export const GameContext = createContext<GameConn | null>(null);

export function useGame(): GameConn & { view: GameView } {
  const ctx = useContext(GameContext);
  if (!ctx?.view) throw new Error('useGame fuera de una partida cargada');
  return ctx as GameConn & { view: GameView };
}

/** Hora del servidor, refrescada cada `ms`. */
export function useServerNow(ms = 250): number {
  const ctx = useContext(GameContext);
  const offset = ctx?.offset ?? 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    setNow(Date.now() + offset);
    return () => clearInterval(t);
  }, [offset, ms]);
  return now;
}

/** En pausa, lo que le queda a un plazo interno (evento, subasta, escondite,
 *  relámpago): congelado en el momento del tiempo muerto. null si el reloj corre. */
export const pausedMsFor = (view: { pausedAt: number | null }, endsAt: number | null): number | null =>
  view.pausedAt !== null && endsAt !== null ? Math.max(0, endsAt - view.pausedAt) : null;

/** Envía una acción y gestiona "enviando" + error en línea. */
export function useAction() {
  const { send } = useGame();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      const ack = await send(action);
      setBusy(false);
      if (!ack.ok) setError(ack.error ?? 'Algo ha fallado');
      else play('tap');
      return ack.ok;
    },
    [send],
  );
  return { run, busy, error, setError };
}
