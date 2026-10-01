// Simulador de partidas: N bots juegan por WebSocket contra un servidor real en memoria.
// Registra TODO lo que recibe cada navegador para poder auditar fugas de secretos.
import { io as connect, type Socket } from 'socket.io-client';
import { AVATARS } from '../src/shared/constants.ts';
import type { Ack, GameSettings, GameView } from '../src/shared/types.ts';
import { createApp } from '../src/server/app.ts';
import { HOST_CLAIM_AFTER_MS } from '../src/server/engine/game.ts';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export class Bot {
  socket!: Socket;
  view: GameView | null = null;
  received: GameView[] = [];
  toasts: string[] = [];
  errors: string[] = [];
  rematch: { code: string; playerToken: string | null; hostToken: string | null } | null = null;
  private acted = new Set<string>();
  paused = false;

  constructor(
    public name: string,
    public token: string,
    public code: string,
    private base: string,
    private cheat: () => { code?: string } = () => ({}),
  ) {}

  connect(): Promise<void> {
    this.socket = connect(this.base, { auth: { code: this.code, token: this.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    this.socket.on('view', (v: GameView) => {
      this.view = v;
      this.received.push(v);
      if (!this.paused) setImmediate(() => this.act().catch(() => {}));
    });
    this.socket.on('toast', (t: { text: string }) => this.toasts.push(t.text));
    this.socket.on('rematch', (d: { code: string; playerToken: string | null; hostToken: string | null }) => (this.rematch = d));
    return new Promise((ok, ko) => {
      this.socket.once('connect', () => ok());
      this.socket.once('connect_error', ko);
    });
  }

  disconnect() {
    this.socket.disconnect();
  }

  async send(action: object): Promise<Ack> {
    const ack = (await this.socket.timeout(3000).emitWithAck('player:action', action).catch((e: Error) => ({ ok: false, error: e.message }))) as Ack;
    if (!ack.ok && ack.error) this.errors.push(`${(action as { type: string }).type}: ${ack.error}`);
    return ack;
  }

  async host(action: object): Promise<Ack> {
    return (await this.socket.timeout(3000).emitWithAck('host:action', action)) as Ack;
  }

  private once(key: string): boolean {
    if (this.acted.has(key)) return false;
    this.acted.add(key);
    return true;
  }

  async act(): Promise<void> {
    const v = this.view;
    if (!v?.me || v.me.left) return;
    const me = v.me;
    const others = v.players.filter((p) => !p.left && p.id !== me.id);
    const r = v.round?.index ?? -1;

    switch (v.phase) {
      case 'ROLE_REVEAL':
        if (this.once('ready')) await this.send({ type: 'ready' });
        return;
      case 'CHALLENGE': {
        const c = v.challenge!;
        const key = `ch:${r}:${c.status}`;
        if (c.status === 'running' && c.mine.quiz && !c.mine.quiz.answers && this.once(key)) {
          await this.send({ type: 'challenge', answers: c.mine.quiz.questions.map(() => Math.floor(Math.random() * 4)) });
        }
        if (c.kind === 'code_hunt' && c.status === 'running' && c.isParticipant && c.pub.huntStartsAt && v.serverNow >= c.pub.huntStartsAt && this.once(key)) {
          await this.send({ type: 'challenge', code: '0000' });
          if (Math.random() < 0.4) await this.send({ type: 'challenge', code: this.cheat().code ?? '1' });
        }
        if (c.status === 'voting' && c.mine.impostor && !c.mine.impostor.vote && this.once(key)) {
          const pool = others.filter((o) => c.participants.includes(o.id));
          if (pool.length) await this.send({ type: 'challenge', vote: rnd(pool).id });
        }
        if (c.mine.truthLie?.isSpeaker && c.mine.truthLie.lieIndex === null && this.once(`lie:${r}`)) {
          await this.send({ type: 'challenge', lieIndex: Math.floor(Math.random() * 3) });
        }
        if (c.status === 'running' && c.mine.truthLie && !c.mine.truthLie.isSpeaker && c.mine.truthLie.guess === null && this.once(key)) {
          await this.send({ type: 'challenge', guess: Math.floor(Math.random() * 3) });
        }
        if (c.status === 'running' && c.mine.social && !c.mine.social.vote && this.once(key)) {
          await this.send({ type: 'challenge', vote: rnd(v.players.filter((p) => !p.left)).id });
        }
        return;
      }
      case 'RITUAL': {
        const rit = v.ritual!;
        if (rit.status === 'open' && rit.isParticipant && !rit.myChoice && this.once(`rit:${r}`)) {
          const cuco = me.role?.faction === 'cuco';
          await this.send({ type: 'ritual', choice: (cuco && Math.random() < 0.6) || Math.random() < 0.1 ? 'apagar' : 'encender' });
        }
        return;
      }
      case 'INVESTIGATION': {
        if (!this.once(`inv:${r}`)) return;
        if (others.length === 0) return;
        if (Math.random() < 0.6) await this.send({ type: 'buy', item: rnd(['pista', 'candado', 'voto_doble', 'ganzua', 'mirilla', 'sobre']), targetId: rnd(others).id, amount: 5 });
        if (me.ability?.canUse && me.role?.ability) {
          const n = me.role.ability.targets;
          const pool = [...others].sort(() => Math.random() - 0.5);
          await this.send({ type: 'ability', targets: pool.slice(0, n).map((p) => p.id) });
        }
        const mission = this.view?.missions?.find((m) => m.status === 'active');
        if (mission && Math.random() < 0.5) await this.send({ type: 'claimMission', missionId: mission.id });
        if (Math.random() < 0.3) await this.send({ type: 'pillar', targetId: rnd(others).id });
        return;
      }
      case 'VOTING':
        if (v.vote?.status === 'open' && !v.vote.myVote && this.once(`vote:${r}`)) await this.send({ type: 'vote', targets: [rnd(others).id] });
        return;
      case 'FINAL_ACCUSATION':
        if (v.vote?.status === 'open' && !v.vote.myVote && this.once('final')) {
          const picks = [...others].sort(() => Math.random() - 0.5).slice(0, v.vote.picks);
          await this.send({ type: 'vote', targets: picks.map((p) => p.id) });
        }
        return;
    }
  }
}

export interface SimOptions {
  players: number;
  settings?: Partial<GameSettings>;
  /** Hooks por ronda para simular incidencias */
  onRound?: (round: number, sim: Sim) => Promise<void> | void;
}

export type Sim = Awaited<ReturnType<typeof createSim>>;

export async function createSim(opts: SimOptions) {
  const app = await createApp({ persist: false, rateLimit: 10_000 });
  const base = `http://localhost:${app.port}`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, string> };
  };

  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: opts.players, hostPlays: true, ...opts.settings };
  const created = await post('/api/games', { settings, host: { name: 'Ana', avatar: AVATARS[0] } });
  const code = created.json.code;
  const game = () => app.store.get(code)!;
  const cheat = () => ({ code: game().challenge?.code?.code });

  const names = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta', 'Pablo', 'Sara', 'Sergio', 'Lucía', 'Iván', 'Nuria'];
  const bots: Bot[] = [new Bot(names[0], created.json.playerToken, code, base, cheat)];
  for (let i = 1; i < opts.players; i++) {
    const joined = await post(`/api/games/${code}/join`, { name: names[i], avatar: AVATARS[i % AVATARS.length] });
    if (joined.status !== 201) throw new Error(`join ${names[i]}: ${JSON.stringify(joined.json)}`);
    bots.push(new Bot(names[i], joined.json.playerToken, code, base, cheat));
  }
  await Promise.all(bots.map((b) => b.connect()));

  const director = new Bot('Director', created.json.hostToken, code, base);
  director.paused = true;
  await director.connect();

  const sim = {
    app, base, code, bots, director, game, post,
    /** Quién controla la partida ahora (director o jugador que reclamó el mando) */
    controller: director as Bot,
    async run(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      let lastKey = '';
      let since = Date.now();
      let lastRound = -1;
      await this.controller.host({ type: 'start' });
      while (Date.now() < deadline) {
        await sleep(15);
        const g = game();
        if (g.phase === 'FINALE' && g.finaleStep >= (g.finale?.totalSteps ?? 1) - 1) return;
        if (g.roundIndex !== lastRound && g.phase === 'ROUND_INTRO') {
          lastRound = g.roundIndex;
          await opts.onRound?.(g.roundIndex, sim);
        }
        const key = `${g.phase}:${g.roundIndex}:${g.challenge?.status}:${g.ritual?.status}:${g.vote?.status}:${g.finaleStep}:${g.version}`;
        if (key !== lastKey) {
          lastKey = key;
          since = Date.now();
          continue;
        }
        if (Date.now() - since < 120) continue;
        since = Date.now();
        const c = g.challenge;
        if (g.phase === 'CHALLENGE' && c?.kind === 'code_hunt' && c.status === 'running' && c.code!.huntStartsAt! > Date.now()) {
          c.code!.huntStartsAt = Date.now() - 1; // el test no espera 75 s a que se esconda el código
          app.store.touch(g);
          await this.controller.host({ type: 'extend', seconds: 0 });
          continue;
        }
        if (g.phase === 'CHALLENGE' && c?.status === 'judging') {
          const winners = c.participants.slice(0, 1);
          await this.controller.host({ type: 'judge', passed: Math.random() < 0.7, winners });
          continue;
        }
        const ack = await this.controller.host({ type: 'advance' });
        if (!ack.ok) throw new Error(`advance falló en ${g.phase}: ${ack.error}`);
      }
      throw new Error(`Timeout de simulación en fase ${game().phase}`);
    },
    async reconnect(bot: Bot) {
      bot.disconnect();
      await sleep(30);
      await bot.connect();
    },
    async hostDropsAndPlayerClaims(claimer: Bot) {
      this.director.disconnect();
      const hostBot = bots.find((b) => b.view?.me?.isHost);
      hostBot?.disconnect();
      await sleep(50);
      game().hostLastSeen = Date.now() - HOST_CLAIM_AFTER_MS - 1;
      const ack = await claimer.send({ type: 'claimHost' });
      if (!ack.ok) throw new Error(`claimHost: ${ack.error}`);
      this.controller = claimer;
      if (hostBot) await hostBot.connect();
    },
    async close() {
      [...bots, director].forEach((b) => (b.paused = true));
      await sleep(400);
      [...bots, director].forEach((b) => b.socket?.connected && b.disconnect());
      await app.close();
    },
  };
  return sim;
}

/** Auditoría: ningún navegador recibió secretos ajenos antes de la ceremonia final. */
export function auditLeaks(sim: Sim): string[] {
  const g = sim.game();
  const problems: string[] = [];
  const tokens = g.players.map((p) => p.token);
  for (const bot of [...sim.bots, sim.director]) {
    const me = g.players.find((p) => p.token === bot.token);
    for (const v of bot.received) {
      if (v.phase === 'FINALE') continue;
      const json = JSON.stringify(v);
      if (json.includes(g.hostToken)) problems.push(`${bot.name} recibió el hostToken`);
      for (const t of tokens) if (t !== bot.token && json.includes(t)) problems.push(`${bot.name} recibió un token ajeno`);
      for (const other of g.players) {
        if (!other.roleId || other.id === me?.id || other.roleId === me?.roleId) continue;
        // Se comprueba como campo de objeto, no como subcadena: palabras como "abuela"
        // también son vocabulario legítimo de pruebas (word_impostor usa esas mismas palabras).
        if (json.includes(`"id":"${other.roleId}"`) || json.includes(`"roleId":"${other.roleId}"`)) {
          problems.push(`${bot.name} (${me?.roleId ?? 'director'}) vio el rol ${other.roleId} de ${other.name} en ${v.phase}`);
        }
      }
      if (v.challenge?.status !== 'done' && json.includes('infiltradoId')) problems.push(`${bot.name} vio al infiltrado antes de tiempo`);
      if (v.challenge?.mine.code?.code && v.challenge.mine.code.isHider === false) problems.push(`${bot.name} vio el código sin ser quien lo esconde`);
      if (v.vote && !v.vote.isPublic && v.vote.result?.ballots) problems.push(`${bot.name} vio papeletas de un juicio secreto`);
      if (me && v.me?.teammates.length && g.players.find((p) => p.id === me.id)?.roleId?.startsWith('cuco') !== true) {
        problems.push(`${bot.name} recibió compañeros Cuco sin ser Cuco`);
      }
    }
  }
  return [...new Set(problems)];
}
