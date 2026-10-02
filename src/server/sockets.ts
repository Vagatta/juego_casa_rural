import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { LETTER_MAX_LEN } from '../shared/constants.ts';
import type { Ack } from '../shared/types.ts';
import { hostAction, onPlayerOffline, playerAction, rejoinPlayer, rematchGame, tick, type HostAction, type PlayerAction } from './engine/game.ts';
import { type Game, GameError, type Outbox, announce, newOutbox } from './engine/state.ts';
import type { GameStore } from './store.ts';
import { buildView, type Viewer } from './views.ts';

interface SocketData {
  code: string;
  audience: 'player' | 'director';
  playerId: string | null;
}

type GameSocket = Socket & { data: SocketData };

const id = z.string().min(1).max(32);

const playerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['ready', 'leave', 'claimHost']) }),
  z.object({
    type: z.literal('challenge'),
    answers: z.array(z.number().int()).max(10).optional(),
    code: z.string().max(8).optional(),
    vote: id.optional(),
    lieIndex: z.number().int().optional(),
    guess: z.number().int().optional(),
  }),
  z.object({ type: z.literal('ritual'), choice: z.enum(['encender', 'apagar']) }),
  // Lista vacía = abstención (solo en juicios; castVote lo valida)
  z.object({ type: z.literal('vote'), targets: z.array(id).max(3) }),
  z.object({
    type: z.literal('buy'),
    item: z.enum(['pista', 'candado', 'voto_doble', 'ganzua', 'mirilla', 'sobre', 'coartada', 'altavoz', 'espejo', 'nota']),
    targetId: id.optional(),
    amount: z.number().int().min(1).max(100000).optional(),
    text: z.string().max(140).optional(),
  }),
  z.object({ type: z.literal('ability'), targets: z.array(id).max(2) }),
  z.object({ type: z.enum(['claimMission', 'discardMission']), missionId: id }),
  z.object({ type: z.literal('pillar'), targetId: id }),
  z.object({ type: z.literal('bet'), targetId: id, amount: z.number().int().min(1).max(100000) }),
  z.object({ type: z.literal('note'), text: z.string().max(500) }),
  z.object({ type: z.literal('predict'), targetId: id }),
  z.object({ type: z.literal('react'), emoji: z.string().min(1).max(8) }),
  z.object({ type: z.literal('certify'), clueId: id }),
  z.object({ type: z.literal('letter'), text: z.string().trim().min(1).max(LETTER_MAX_LEN) }),
  z.object({ type: z.literal('coinflip'), amount: z.number().int().min(1).max(10_000) }),
  z.object({ type: z.literal('bid'), amount: z.number().int().min(1).max(10_000) }),
]);

const hostActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['start', 'advance', 'pause', 'resume', 'end', 'openSeal', 'rematch']) }),
  z.object({ type: z.literal('judge'), passed: z.boolean().optional(), winners: z.array(id).max(12).optional() }),
  z.object({ type: z.literal('extend'), seconds: z.number().int().min(-300).max(600) }),
  z.object({ type: z.literal('event'), eventId: id }),
  z.object({ type: z.literal('autopilot'), on: z.boolean() }),
  z.object({ type: z.literal('adjustCoins'), playerId: id, delta: z.number().int().min(-1000).max(1000) }),
  z.object({ type: z.literal('kick'), playerId: id }),
]);

/** Límite simple anti-spam por socket: 25 acciones cada 5 segundos. */
function rateLimiter(max: number) {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > 5000) {
      windowStart = now;
      count = 0;
    }
    return ++count <= max;
  };
}

export function attachSockets(io: Server, store: GameStore, opts: { rateLimit?: number } = {}): { stop: () => void; refresh: (code: string) => void; push: (code: string, out: Outbox) => void } {
  const socketsOf = (code: string) => [...io.sockets.sockets.values()].filter((s) => (s as GameSocket).data.code === code) as GameSocket[];

  const isHostSocket = (g: Game, s: GameSocket) => s.data.audience === 'director' || (!!s.data.playerId && s.data.playerId === g.hostPlayerId);
  const hostOnline = (g: Game) => socketsOf(g.code).some((s) => isHostSocket(g, s));

  function broadcast(g: Game, out?: Outbox): void {
    const sockets = socketsOf(g.code);
    const online = sockets.some((s) => isHostSocket(g, s));
    for (const s of sockets) {
      const viewer: Viewer = { audience: s.data.audience, playerId: s.data.playerId, isHost: isHostSocket(g, s), hostOnline: online };
      s.emit('view', buildView(g, viewer));
    }
    if (!out) return;
    for (const { to, toast } of out.toasts) {
      for (const s of sockets) {
        if (to === 'all' || s.data.playerId === to) s.emit('toast', toast);
      }
    }
    for (const r of out.reactions) {
      for (const s of sockets) s.emit('react', r);
    }
    for (const kicked of out.kicked) {
      for (const s of sockets.filter((x) => x.data.playerId === kicked)) {
        s.emit('kicked');
        s.disconnect(true);
      }
    }
  }

  function run(g: Game, fn: (out: Outbox) => void, ack?: (a: Ack) => void): void {
    const out = newOutbox();
    try {
      fn(out);
      store.touch(g);
      broadcast(g, out);
      ack?.({ ok: true });
    } catch (err) {
      if (err instanceof GameError) return ack?.({ ok: false, error: err.message });
      console.error(`[game ${g.code}]`, err);
      ack?.({ ok: false, error: 'Algo ha fallado en la casa. Inténtalo de nuevo.' });
    }
  }

  io.use((socket, next) => {
    const s = socket as GameSocket;
    const { code, token } = (socket.handshake.auth ?? {}) as { code?: string; token?: string };
    const g = typeof code === 'string' ? store.get(code) : undefined;
    if (!g || typeof token !== 'string') return next(new Error('not_found'));
    // Espectador: ve la partida como la vería la casa (sin secretos de nadie)
    if (token === 'spectator') {
      s.data = { code: g.code, audience: 'player', playerId: null };
      return next();
    }
    if (token === g.hostToken) {
      s.data = { code: g.code, audience: 'director', playerId: null };
      return next();
    }
    const player = g.players.find((p) => p.token === token);
    if (!player) return next(new Error('not_found'));
    if (player.kicked) return next(new Error('kicked'));
    s.data = { code: g.code, audience: 'player', playerId: player.id };
    next();
  });

  io.on('connection', (socket) => {
    const s = socket as GameSocket;
    const allow = rateLimiter(opts.rateLimit ?? 25);
    const g = store.get(s.data.code)!;
    run(g, () => {
      if (s.data.playerId) {
        const p = g.players.find((x) => x.id === s.data.playerId)!;
        rejoinPlayer(g, p);
        p.connected = true;
        p.lastSeen = Date.now();
      }
      if (isHostSocket(g, s)) g.hostLastSeen = Date.now();
    });
    // Si esta casa ya cerró y se abrió otra, este móvil se muda solo
    if (g.rematchTo) {
      const ng = store.get(g.rematchTo);
      if (ng) {
        s.emit('rematch', {
          code: ng.code,
          playerToken: s.data.playerId ? (ng.players.find((p) => p.id === s.data.playerId)?.token ?? null) : null,
          hostToken: isHostSocket(g, s) ? ng.hostToken : null,
        });
      }
    }

    s.on('player:action', (raw: unknown, ack?: (a: Ack) => void) => {
      const game = store.get(s.data.code);
      if (!game || !s.data.playerId) return ack?.({ ok: false, error: 'Partida no encontrada' });
      if (!allow()) return ack?.({ ok: false, error: 'Más despacio' });
      const parsed = playerActionSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'Acción no válida' });
      const p = game.players.find((x) => x.id === s.data.playerId);
      if (!p) return ack?.({ ok: false, error: 'Jugador no encontrado' });
      p.lastSeen = Date.now();
      run(game, (out) => playerAction(game, p, parsed.data as PlayerAction, out, hostOnline(game)), ack);
    });

    s.on('host:action', (raw: unknown, ack?: (a: Ack) => void) => {
      const game = store.get(s.data.code);
      if (!game) return ack?.({ ok: false, error: 'Partida no encontrada' });
      if (!isHostSocket(game, s)) return ack?.({ ok: false, error: 'Solo el director puede hacer eso' });
      if (!allow()) return ack?.({ ok: false, error: 'Más despacio' });
      const parsed = hostActionSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'Acción no válida' });
      game.hostLastSeen = Date.now();
      // Rematch necesita el store (crea otra casa): vive aquí, no en el motor
      if (parsed.data.type === 'rematch') {
        try {
          const ng = rematchGame(game, store.newCode());
          store.add(ng);
          store.touch(game);
          announce(game, `La casa ${ng.code} está abierta. Misma gente, noche nueva.`, 'special');
          for (const sock of socketsOf(game.code)) {
            sock.emit('rematch', {
              code: ng.code,
              playerToken: sock.data.playerId ? (ng.players.find((p) => p.id === sock.data.playerId)?.token ?? null) : null,
              hostToken: isHostSocket(game, sock) ? ng.hostToken : null,
            });
          }
          broadcast(game);
          return ack?.({ ok: true });
        } catch (err) {
          return ack?.({ ok: false, error: err instanceof GameError ? err.message : 'Algo ha fallado en la casa' });
        }
      }
      run(game, (out) => hostAction(game, parsed.data as HostAction, out, s.data.audience === 'director'), ack);
    });

    s.on('disconnect', () => {
      const game = store.get(s.data.code);
      if (!game) return;
      const others = socketsOf(game.code).filter((x) => x.id !== s.id);
      if (isHostSocket(game, s)) game.hostLastSeen = Date.now();
      let wentOffline = false;
      if (s.data.playerId && !others.some((x) => x.data.playerId === s.data.playerId)) {
        const p = game.players.find((x) => x.id === s.data.playerId);
        if (p) {
          p.connected = false;
          p.lastSeen = Date.now();
          wentOffline = true;
        }
      }
      const out = newOutbox();
      try {
        if (wentOffline) onPlayerOffline(game, out);
        store.touch(game);
        broadcast(game, out);
      } catch (err) {
        console.error(`[disconnect ${game.code}]`, err);
      }
    });
  });

  const interval = setInterval(() => {
    for (const g of store.all()) {
      const out = newOutbox();
      try {
        if (hostOnline(g)) g.hostLastSeen = Date.now();
        if (tick(g, out)) {
          store.touch(g);
          broadcast(g, out);
        }
      } catch (err) {
        console.error(`[tick ${g.code}]`, err);
      }
    }
  }, 1000);
  const sweeper = setInterval(() => store.sweep(), 10 * 60 * 1000);

  return {
    stop: () => {
      clearInterval(interval);
      clearInterval(sweeper);
    },
    refresh: (code: string) => {
      const g = store.get(code);
      if (g) broadcast(g);
    },
    /** Entrega vistas + toasts de acciones que entraron por REST (alta, relevo). */
    push: (code: string, out: Outbox) => {
      const g = store.get(code);
      if (g) broadcast(g, out);
    },
  };
}
