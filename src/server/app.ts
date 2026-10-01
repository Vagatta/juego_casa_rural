import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  AVATARS,
  CONTENT_EDIT_MAX_LEN,
  CUSTOM_MISSION_MAX_LEN,
  MAX_CONTENT_DISABLED,
  MAX_CONTENT_EDITS,
  MAX_CUSTOM_MISSIONS,
  MAX_EXTRA_QUESTIONS,
  MAX_PLAYERS,
  TAKEOVER_GRACE_MS,
} from '../shared/constants.ts';
import { editableContent } from './content.ts';
import { addPlayer, createGame, takeOverPlayer } from './engine/game.ts';
import { GameError, newOutbox } from './engine/state.ts';
import { attachSockets } from './sockets.ts';
import { GameStore } from './store.ts';

const settingsSchema = z.object({
  durationMin: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]),
  difficulty: z.enum(['facil', 'normal', 'dificil']),
  mode: z.enum(['clasico', 'caos', 'sofa']),
  expectedPlayers: z.number().int().min(4).max(MAX_PLAYERS),
  hostPlays: z.boolean(),
  autopilot: z.boolean().optional(),
  customMissions: z.array(z.string().trim().min(5).max(CUSTOM_MISSION_MAX_LEN)).max(MAX_CUSTOM_MISSIONS).optional(),
  contentMod: z
    .object({
      disabled: z.array(z.string().max(40)).max(MAX_CONTENT_DISABLED).optional(),
      edits: z
        .record(z.string().max(46), z.string().trim().min(3).max(CONTENT_EDIT_MAX_LEN))
        .refine((e) => Object.keys(e).length <= MAX_CONTENT_EDITS)
        .optional(),
      extraInterro: z.array(z.string().trim().min(5).max(CUSTOM_MISSION_MAX_LEN)).max(MAX_EXTRA_QUESTIONS).optional(),
      extraSocial: z.array(z.string().trim().min(5).max(CUSTOM_MISSION_MAX_LEN)).max(MAX_EXTRA_QUESTIONS).optional(),
    })
    .optional(),
});

const profileSchema = z.object({
  name: z.string().trim().min(1).max(16),
  avatar: z.string().refine((a) => (AVATARS as readonly string[]).includes(a), 'Avatar no válido'),
});

const createSchema = z.object({ settings: settingsSchema, host: profileSchema.optional() });

export interface AppOptions {
  port?: number;
  persist?: boolean;
  databaseUrl?: string;
  snapshotDir?: string;
  /** Acciones por socket cada 5 s (anti-spam) */
  rateLimit?: number;
}

export async function createApp(opts: AppOptions = {}) {
  const store = new GameStore({ persist: opts.persist, databaseUrl: opts.databaseUrl, snapshotDir: opts.snapshotDir });
  await store.init();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Crear partidas: límite suave por IP para que nadie llene la memoria del servidor
  const createdByIp = new Map<string, number[]>();
  const allowCreate = (ip: string) => {
    const now = Date.now();
    const recent = (createdByIp.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
    recent.push(now);
    createdByIp.set(ip, recent);
    return recent.length <= 10;
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, games: store.all().length });
  });

  // Catálogo completo para el editor del anfitrión en la pantalla de crear
  app.get('/api/content', (_req, res) => res.json(editableContent()));

  app.post('/api/games', (req, res) => {
    if (!allowCreate(req.ip ?? 'unknown')) return void res.status(429).json({ error: 'Demasiadas partidas creadas. Espera un poco.' });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Configuración no válida' });
    const { settings, host } = parsed.data;
    if (settings.hostPlays && !host) return void res.status(400).json({ error: 'Falta tu nombre' });

    const g = createGame(store.newCode(), settings);
    let player = null;
    if (settings.hostPlays && host) {
      player = addPlayer(g, host.name, host.avatar);
      g.hostPlayerId = player.id;
    }
    store.add(g);
    res.status(201).json({ code: g.code, hostToken: g.hostToken, playerToken: player?.token ?? null, playerId: player?.id ?? null });
  });

  app.get('/api/games/:code', (req, res) => {
    const g = store.get(req.params.code);
    if (!g) return void res.status(404).json({ error: 'No existe ninguna partida con ese código' });
    const active = g.players.filter((p) => !p.left);
    res.json({
      code: g.code,
      phase: g.phase,
      players: active.length,
      joinable: g.phase === 'LOBBY' && active.length < MAX_PLAYERS,
      takenAvatars: active.map((p) => p.avatar),
      // Jugadores a los que otro móvil puede dar el relevo (misma regla que takeOverPlayer)
      absentPlayers:
        g.phase === 'FINALE'
          ? []
          : g.players
              .filter((p) => !p.kicked && (p.left || (!p.connected && Date.now() - p.lastSeen >= TAKEOVER_GRACE_MS)))
              .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
      rematchTo: g.rematchTo,
    });
  });

  app.post('/api/games/:code/join', (req, res) => {
    const g = store.get(req.params.code);
    if (!g) return void res.status(404).json({ error: 'No existe ninguna partida con ese código' });

    // Relevo: otro móvil continúa como un jugador ausente (conserva identidad y secretos)
    const takeId = typeof req.body?.takeId === 'string' ? req.body.takeId : null;
    if (takeId) {
      try {
        const out = newOutbox();
        const p = takeOverPlayer(g, takeId, out);
        store.touch(g);
        sockets.push(g.code, out);
        return void res.status(201).json({ code: g.code, playerToken: p.token, playerId: p.id });
      } catch (err) {
        if (err instanceof GameError) return void res.status(409).json({ error: err.message });
        throw err;
      }
    }

    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Escribe un nombre (máximo 16 letras) y elige un avatar' });
    try {
      const p = addPlayer(g, parsed.data.name, parsed.data.avatar);
      store.touch(g);
      broadcastLater(g.code);
      res.status(201).json({ code: g.code, playerToken: p.token, playerId: p.id });
    } catch (err) {
      if (err instanceof GameError) return void res.status(409).json({ error: err.message });
      throw err;
    }
  });

  const clientDir = resolve(import.meta.dirname, '../../dist/client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
  }

  const httpServer: HttpServer = createHttpServer(app);
  const io = new Server(httpServer, { cors: { origin: false }, pingInterval: 10_000, pingTimeout: 8_000, maxHttpBufferSize: 16_000 });
  const sockets = attachSockets(io, store, { rateLimit: opts.rateLimit });

  // Las altas por REST se notifican a los sockets conectados de esa partida
  const broadcastLater = (code: string) => setImmediate(() => sockets.refresh(code));

  await new Promise<void>((ok) => httpServer.listen(opts.port ?? 0, ok));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    port,
    store,
    io,
    async close() {
      sockets.stop();
      await store.flush();
      await new Promise<void>((ok) => io.close(() => ok()));
    },
  };
}
