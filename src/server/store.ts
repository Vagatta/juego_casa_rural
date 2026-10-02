// Partidas en memoria (autoritativas) + snapshots para sobrevivir a reinicios.
// Snapshot en PostgreSQL si hay DATABASE_URL (recomendado en Railway/Render: disco efímero),
// o en archivos JSON en SNAPSHOT_DIR.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CODE_ALPHABET, CODE_LENGTH } from '../shared/constants.ts';
import { rand } from './engine/rng.ts';
import type { Game } from './engine/state.ts';

interface SnapshotBackend {
  init(): Promise<void>;
  save(g: Game): Promise<void>;
  remove(code: string): Promise<void>;
  loadAll(): Promise<Game[]>;
}

/** Defaults para campos añadidos tras crear el snapshot — partidas viejas no se rompen. */
function migrate(g: Game): Game {
  g.condemned ??= [];
  g.truceUntil ??= 0;
  g.flags.ladenVote ??= false;
  for (const p of g.players) { p.stats.votesCast ??= 0; p.readyFor ??= null; }
  // Una pausa no sobrevive al reinicio: pausedAt sería del mundo viejo y al
  // reanudar dispararía todos los plazos. La partida vuelve corriendo el tiempo.
  if (g.pausedRemainingMs !== null && g.pausedRemainingMs !== undefined) {
    g.phaseEndsAt = Date.now() + g.pausedRemainingMs;
    g.pausedRemainingMs = null;
    g.pausedAt = null;
  }
  return g;
}

class FileBackend implements SnapshotBackend {
  constructor(private dir: string) {}
  async init() {
    await mkdir(this.dir, { recursive: true });
  }
  async save(g: Game) {
    await writeFile(resolve(this.dir, `${g.code}.json`), JSON.stringify(g));
  }
  async remove(code: string) {
    await rm(resolve(this.dir, `${code}.json`), { force: true });
  }
  async loadAll() {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const games: Game[] = [];
    for (const f of files) {
      try {
        games.push(migrate(JSON.parse(await readFile(resolve(this.dir, f), 'utf8')) as Game));
      } catch (err) {
        console.warn(`[store] snapshot ilegible ${f}:`, (err as Error).message);
      }
    }
    return games;
  }
}

class PgBackend implements SnapshotBackend {
  private pool!: import('pg').Pool;
  constructor(private url: string) {}
  async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.url, max: 3, ssl: /sslmode=require|render|railway/.test(this.url) ? { rejectUnauthorized: false } : undefined });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS game_snapshots (
      code text PRIMARY KEY, state jsonb NOT NULL, finished boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now())`);
  }
  async save(g: Game) {
    await this.pool.query(
      `INSERT INTO game_snapshots (code, state, finished, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (code) DO UPDATE SET state = EXCLUDED.state, finished = EXCLUDED.finished, updated_at = now()`,
      [g.code, JSON.stringify(g), g.phase === 'FINALE'],
    );
  }
  async remove(code: string) {
    await this.pool.query('DELETE FROM game_snapshots WHERE code = $1', [code]);
  }
  async loadAll() {
    const { rows } = await this.pool.query<{ state: Game }>(`SELECT state FROM game_snapshots WHERE updated_at > now() - interval '12 hours'`);
    return rows.map((r) => migrate(r.state));
  }
}

const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
const FINISHED_LIMIT_MS = 3 * 60 * 60 * 1000;

export class GameStore {
  private games = new Map<string, Game>();
  private pending = new Map<string, NodeJS.Timeout>();
  private backend: SnapshotBackend | null;

  constructor(opts: { databaseUrl?: string; snapshotDir?: string; persist?: boolean }) {
    if (opts.persist === false) this.backend = null;
    else if (opts.databaseUrl) this.backend = new PgBackend(opts.databaseUrl);
    else this.backend = new FileBackend(opts.snapshotDir ?? resolve(process.cwd(), 'data', 'snapshots'));
  }

  async init(): Promise<void> {
    if (!this.backend) return;
    await this.backend.init();
    for (const g of await this.backend.loadAll()) {
      if (Date.now() - g.updatedAt > IDLE_LIMIT_MS) continue;
      // Tras un reinicio nadie está conectado todavía
      g.players.forEach((p) => (p.connected = false));
      g.hostLastSeen = Date.now();
      this.games.set(g.code, g);
    }
    if (this.games.size) console.log(`[store] ${this.games.size} partidas restauradas`);
  }

  get(code: string): Game | undefined {
    return this.games.get(code.toUpperCase());
  }

  all(): Game[] {
    return [...this.games.values()];
  }

  newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
      if (!this.games.has(code)) return code;
    }
  }

  add(g: Game): void {
    this.games.set(g.code, g);
    this.touch(g);
  }

  /** Marca la partida como modificada y programa un snapshot (agrupado cada 400 ms). */
  touch(g: Game): void {
    g.version++;
    g.updatedAt = Date.now();
    if (!this.backend || this.pending.has(g.code)) return;
    this.pending.set(
      g.code,
      setTimeout(() => {
        this.pending.delete(g.code);
        this.backend!.save(g).catch((err) => console.error(`[store] error guardando ${g.code}:`, err));
      }, 400),
    );
  }

  /** Libera partidas terminadas o abandonadas. */
  sweep(): void {
    const now = Date.now();
    for (const g of this.games.values()) {
      const limit = g.phase === 'FINALE' ? FINISHED_LIMIT_MS : IDLE_LIMIT_MS;
      if (now - g.updatedAt > limit) {
        this.games.delete(g.code);
        this.backend?.remove(g.code).catch(() => {});
      }
    }
  }

  async flush(): Promise<void> {
    for (const [code, timer] of this.pending) {
      clearTimeout(timer);
      this.pending.delete(code);
      const g = this.games.get(code);
      if (g) await this.backend?.save(g);
    }
  }
}
