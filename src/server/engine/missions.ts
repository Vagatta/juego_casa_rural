import {
  CORRO_CHANCE,
  CORRO_REWARD,
  COUPLE_CHANCE,
  COUPLE_REWARD,
  DUEL_CHANCE,
  MISSION_REWARD,
  MISSION_SLOTS,
  MISSION_SLOTS_VECINO,
  PATATA_CHANCE,
  PATATA_PENALTY,
  PILLADO_PENALTY,
  PILLADO_REWARD,
  SABOTEUR_REWARD,
  STREAK_BONUS,
  STREAK_TARGET,
} from '../../shared/constants.ts';
import type { MissionDifficulty } from '../../shared/types.ts';
import { content, gameContent, type DuelDef, type MissionDef, type SuspectTaskDef } from '../content.ts';
import { deliverClue } from './clues.ts';
import { needsRitual } from './plan.ts';
import { chance, pick, shortId, shuffle, weighted } from './rng.ts';
import {
  type Game,
  GameError,
  type MissionState,
  type Outbox,
  type PlayerState,
  activePlayers,
  announce,
  earn,
  factionOf,
  gameNow,
  isCuco,
  toast,
} from './state.ts';

const EXCLUSIVE_TAGS = new Set(['seat', 'brindis']);

const DIFFICULTY_WEIGHTS: Record<Game['settings']['difficulty'], Record<MissionDifficulty, number>> = {
  facil: { facil: 5, media: 3, dificil: 1, epica: 0.3 },
  normal: { facil: 3, media: 4, dificil: 2, epica: 0.7 },
  dificil: { facil: 1, media: 3, dificil: 4, epica: 1.5 },
};

export const missionSlots = (p: PlayerState): number => (p.roleId === 'vecino' ? MISSION_SLOTS_VECINO : MISSION_SLOTS);

const activeMissionsOf = (g: Game, playerId: string) => g.missions.filter((m) => m.playerId === playerId && m.status === 'active');

export function futureJudgment(g: Game): boolean {
  // El juicio de la ronda actual cuenta si todavía no se ha celebrado
  const from = g.phase === 'VOTING' || g.phase === 'ROUND_RESULT' ? g.roundIndex + 1 : Math.max(0, g.roundIndex);
  return g.plan.slice(from).some((r) => r.hasJudgment);
}

/** Rondas cuya prueba (y su posible Ritual) aún no se ha jugado. */
function upcomingRounds(g: Game) {
  const from = g.phase === 'ROUND_INTRO' || g.phase === 'CHALLENGE' ? Math.max(0, g.roundIndex) : g.roundIndex + 1;
  return g.plan.slice(from);
}

const futureRitual = (g: Game): boolean =>
  upcomingRounds(g).some((r) => {
    const def = gameContent(g).challengeById.get(r.challengeId);
    return !!def && needsRitual(def);
  });

/** Misiones que dependen de un momento futuro: en un relámpago de 90 s son imposibles. */
const HORIZON_TAGS = ['needs_judgment', 'needs_ritual', 'needs_challenge'];

interface AssignOpts {
  factionOnly?: string;
  /** Solo misiones cumplibles ya (misión relámpago). */
  quick?: boolean;
  /** Sin aviso al Insomne: el reparto es selectivo y sus notas delatarían a quién. */
  quiet?: boolean;
}

function eligible(g: Game, p: PlayerState, def: MissionDef, opts: AssignOpts): boolean {
  const faction = factionOf(p);
  if (opts.factionOnly && def.faction !== opts.factionOnly) return false;
  if (def.faction !== 'any' && def.faction !== faction) return false;
  if (def.targets > activePlayers(g).length - 1) return false;
  // Las comprobadas por la casa se resuelven al juicio o al cerrar la ronda: nunca en 90 s
  if (opts.quick && (def.auto || def.tags.some((t) => HORIZON_TAGS.includes(t)))) return false;
  if (def.roles && !def.roles.includes(p.roleId ?? '')) return false;
  if (def.needsRole && !activePlayers(g).some((o) => o.id !== p.id && o.roleId === def.needsRole)) return false;
  // El horizonte lo manda la comprobación, no el texto: una misión de juicio sin juicios
  // a la vista se quedaría activa para siempre
  const autoAt = def.auto ? AUTO_CHECKS[def.auto]?.at : undefined;
  if (def.auto && !autoAt) return false; // auto desconocido: contenido roto, no se reparte
  if ((def.tags.includes('needs_judgment') || autoAt === 'judgment') && !futureJudgment(g)) return false;
  if (def.tags.includes('needs_ritual') && !futureRitual(g)) return false;
  if (def.tags.includes('needs_challenge') && !upcomingRounds(g).length) return false;
  // Misiones que obligan a votar chocan con el voto de silencio del Ermitaño
  if (def.tags.includes('votes_self') && p.roleId === 'ermitano') return false;
  // Sin Cucos en la casa nadie te va a regalar monedas
  if (def.tags.includes('needs_cuco') && !activePlayers(g).some((o) => o.id !== p.id && isCuco(o))) return false;
  // Compañero presente, no solo repartido: un Cuco cuyo socio se fue no tiene a quién cubrir
  if (def.tags.includes('needs_partner') && activePlayers(g).filter(isCuco).length < 2) return false;
  if (g.missions.some((m) => m.playerId === p.id && m.missionId === def.id)) return false;
  const active = g.missions.filter((m) => m.status === 'active');
  for (const tag of def.tags) {
    if (EXCLUSIVE_TAGS.has(tag) && active.some((m) => m.tags.includes(tag))) return false;
  }
  return true;
}

function chooseTargets(g: Game, p: PlayerState, count: number, tags: string[] = []): string[] {
  if (count === 0) return [];
  const incoming = (id: string) => g.missions.filter((m) => m.status === 'active' && m.targets.includes(id)).length;
  // Preferimos objetivos con menos misiones encima: reparte la "presión" y evita que alguien sea imposible de engañar
  const others = shuffle(activePlayers(g).filter((o) => o.id !== p.id)).sort((a, b) => incoming(a.id) - incoming(b.id));
  const ids = others.slice(0, count).map((o) => o.id);
  // {A} tiene que votar: si le toca al Ermitaño, la misión pide romperle el silencio.
  // Se cambia por el siguiente candidato (o pasa a {B}, que no vota); si no hay otro, se queda.
  if (tags.includes('target_votes') && getRole(g, ids[0]) === 'ermitano') {
    const swap = others.find((o) => o.roleId !== 'ermitano' && !ids.slice(1).includes(o.id));
    if (swap) ids[0] = swap.id;
    else if (ids.length > 1) [ids[0], ids[1]] = [ids[1], ids[0]];
  }
  return ids;
}

const getRole = (g: Game, id: string | undefined) => g.players.find((x) => x.id === id)?.roleId;

function resolveText(g: Game, def: { text: string }, targets: string[]): string {
  const { palabras, objetos, expresiones } = content.words;
  const [w1, w2] = shuffle(palabras);
  const name = (i: number) => g.players.find((pl) => pl.id === targets[i])?.name ?? '???';
  return def.text
    .replaceAll('{A}', name(0))
    .replaceAll('{B}', name(1))
    .replaceAll('{palabra}', w1.toUpperCase())
    .replaceAll('{palabra2}', w2.toUpperCase())
    .replaceAll('{objeto}', pick(objetos))
    .replaceAll('{expresion}', pick(expresiones));
}

// Misiones del grupo: el anfitrión las escribe al crear la casa (chistes internos).
// Viven solo en `g.settings`, nunca en el pool global — una casa no contamina a otra.
function customDefs(g: Game): MissionDef[] {
  return (g.settings.customMissions ?? []).map((raw, i) => {
    // Si el anfitrión escribió {B} sin {A}, lo normalizamos: el primer hueco siempre es {A}
    const text = raw.includes('{A}') ? raw : raw.replaceAll('{B}', '{A}');
    return {
      id: `custom:${i}`,
      text,
      difficulty: 'media',
      category: 'casa',
      faction: 'any',
      targets: Math.min(2, new Set(text.match(/\{[AB]\}/g) ?? []).size) as 0 | 1 | 2,
      tags: ['custom'],
    };
  });
}

export function assignMission(g: Game, p: PlayerState, out: Outbox, opts: AssignOpts = {}): MissionState | null {
  const weights = DIFFICULTY_WEIGHTS[g.settings.difficulty];
  const all = [...gameContent(g).missions, ...customDefs(g)];
  const unusedFirst = all.filter((d) => !g.used.missions.includes(d.id) && eligible(g, p, d, opts));
  const pool = unusedFirst.length ? unusedFirst : all.filter((d) => eligible(g, p, d, opts));
  // Las misiones propias de la facción y las del grupo pesan más: para eso las escribió el anfitrión
  const def = weighted(pool, (d) => weights[d.difficulty] * (d.tags.includes('custom') || d.faction !== 'any' ? 3 : 1));
  if (!def) return null;

  const targets = chooseTargets(g, p, def.targets, def.tags);
  const auto = def.auto ? autoState(g, def.auto, p, targets) : undefined;
  const mission: MissionState = {
    id: shortId(),
    missionId: def.id,
    playerId: p.id,
    text: resolveText(g, def, targets),
    difficulty: def.difficulty,
    category: def.category,
    reward: def.reward ?? MISSION_REWARD[def.difficulty],
    targets,
    tags: def.tags,
    status: 'active',
    assignedRound: g.roundIndex,
    resolvedAt: null,
    ...(auto && { auto }),
  };
  g.missions.push(mission);
  g.used.missions.push(def.id);
  toast(out, p.id, { text: 'Nueva misión secreta', tone: 'special', private: true, sound: 'mission' });
  // El Insomne oye crujir el pasillo: sabe a quién le ha llegado una misión
  if (!opts.quiet) for (const s of activePlayers(g).filter((o) => o.roleId === 'insomne' && o.id !== p.id)) {
    deliverClue(g, out, s, 'chisme', { text: `Ruido en el pasillo: a ${p.name} le ha llegado una misión nueva.`, truth: 'true' });
  }
  return mission;
}

// El más votado queda "bajo sospecha": la casa le impone una tarea que le obliga a
// actuar raro delante de todos. Es extra (no gasta hueco), no se descarta y todos
// saben que la tiene — pero no cuál es.
const SUSPECT_REWARD = 60;
export const SUSPECT_TAG = 'suspect';

function suspectTargets(def: SuspectTaskDef): number {
  return new Set(def.text.match(/\{[AB]\}/g) ?? []).size;
}

function assignSuspectTask(g: Game, p: PlayerState, out: Outbox): void {
  const pool = gameContent(g).suspect.filter(
    (d) => !g.missions.some((m) => m.playerId === p.id && m.missionId === `suspect:${d.id}`),
  );
  // Misma regla que eligible(): sin gente suficiente para los {A}/{B}, el texto nacería con «???»
  const fits = (d: SuspectTaskDef) => suspectTargets(d) <= activePlayers(g).length - 1;
  const candidates = pool.filter(fits);
  const fallback = gameContent(g).suspect.filter(fits);
  if (!candidates.length && !fallback.length) return; // el anfitrión desactivó todas las tareas sospechosas
  const def = pick(candidates.length ? candidates : fallback);
  const targets = chooseTargets(g, p, suspectTargets(def));
  g.missions.push({
    id: shortId(),
    missionId: `suspect:${def.id}`,
    playerId: p.id,
    text: resolveText(g, def, targets),
    difficulty: 'media',
    category: 'sospecha',
    reward: SUSPECT_REWARD,
    targets,
    tags: [SUSPECT_TAG],
    status: 'active',
    assignedRound: g.roundIndex,
    resolvedAt: null,
  });
  toast(out, p.id, { text: '👁️ La casa te ha impuesto una tarea sospechosa', tone: 'danger', private: true, sound: 'danger' });
  announce(g, `${p.name} sigue bajo sospecha: la casa le ha encargado algo. Observadle bien.`, 'danger');
}

// Misiones en pareja: dos jugadores reciben la misma tarea y saben quién es su
// cómplice. No gasta hueco, es extra — la coordinación es el premio.
export const COUPLE_TAG = 'pareja';

export function dealCoupleMission(g: Game, out: Outbox, force = false): void {
  const active = activePlayers(g);
  if (active.length < 4 || (!force && !chance(COUPLE_CHANCE))) return;
  const pool = gameContent(g).couple.filter((d) => !d.trio && !g.missions.some((m) => m.missionId === `couple:${d.id}`));
  const candidates = pool.length ? pool : gameContent(g).couple.filter((d) => !d.trio);
  if (!candidates.length) return; // sin misiones en pareja disponibles (todas usadas o desactivadas)
  const def = pick(candidates);
  const [a, b] = shuffle(active);
  // Los {A}/{B} del texto son terceros, no la pareja
  const others = shuffle(active.filter((p) => p.id !== a.id && p.id !== b.id));
  const targets = others.slice(0, new Set(def.text.match(/\{[AB]\}/g) ?? []).size).map((p) => p.id);
  for (const p of [a, b]) {
    g.missions.push({
      id: shortId(),
      missionId: `couple:${def.id}`,
      playerId: p.id,
      text: resolveText(g, def, targets),
      difficulty: 'media',
      category: 'social',
      reward: COUPLE_REWARD,
      targets,
      tags: [COUPLE_TAG],
      status: 'active',
      assignedRound: g.roundIndex,
      resolvedAt: null,
      partnerId: p.id === a.id ? b.id : a.id,
    });
    toast(out, p.id, { text: `🤝 Misión en pareja con ${p.id === a.id ? b.name : a.name}`, tone: 'special', private: true, sound: 'mission' });
  }
}

// Misiones de corro: TRES jugadores reciben la misma tarea y conocen a sus dos
// cómplices. Cuantos más cómplices, más difícil pasar desapercibidos.
export const CORRO_TAG = 'corro';

export function dealCorroMission(g: Game, out: Outbox, force = false): void {
  const active = activePlayers(g);
  if (active.length < 6 || (!force && !chance(CORRO_CHANCE))) return;
  const pool = gameContent(g).couple.filter((d) => d.trio && !g.missions.some((m) => m.missionId === `corro:${d.id}`));
  const candidates = pool.length ? pool : gameContent(g).couple.filter((d) => d.trio);
  if (!candidates.length) return;
  const def = pick(candidates);
  const trio = shuffle(active).slice(0, 3);
  const others = shuffle(active.filter((p) => !trio.some((t) => t.id === p.id)));
  const targets = others.slice(0, new Set(def.text.match(/\{[AB]\}/g) ?? []).size).map((p) => p.id);
  for (const p of trio) {
    g.missions.push({
      id: shortId(),
      missionId: `corro:${def.id}`,
      playerId: p.id,
      text: resolveText(g, def, targets),
      difficulty: 'media',
      category: 'social',
      reward: CORRO_REWARD,
      targets,
      tags: [CORRO_TAG],
      status: 'active',
      assignedRound: g.roundIndex,
      resolvedAt: null,
      partners: trio.filter((o) => o.id !== p.id).map((o) => o.id),
    });
    const names = trio.filter((o) => o.id !== p.id).map((o) => o.name).join(' y ');
    toast(out, p.id, { text: `⭕ Misión de corro con ${names}`, tone: 'special', private: true, sound: 'mission' });
  }
}

// El saboteador infiltrado: en pruebas de equipo, la casa ordena en secreto a un
// participante hacer fracasar la prueba. Nadie sabe si esta ronda hay uno.
export const SABOTEUR_TAG = 'saboteador';

export function assignSaboteurMission(g: Game, p: PlayerState, challengeTitle: string, out: Outbox): void {
  g.missions.push({
    id: shortId(),
    missionId: `saboteur:${g.roundIndex}`,
    playerId: p.id,
    text: `Orden oscura: haz que la prueba «${challengeTitle}» fracase. Sutilmente. Si el equipo la supera, no cobras.`,
    difficulty: 'dificil',
    category: 'sabotaje',
    reward: SABOTEUR_REWARD,
    targets: [],
    tags: [SABOTEUR_TAG],
    status: 'active',
    assignedRound: g.roundIndex,
    resolvedAt: null,
  });
  toast(out, p.id, { text: '🎭 Orden oscura: sabotea la prueba sin que te pillen', tone: 'danger', private: true, sound: 'danger' });
}

/** Misión terminada y cobrada. Encadena racha: si nadie te ha pillado en las
 *  últimas STREAK_TARGET, la casa te premia — y se lo cuenta a todo el mundo. */
function completeMission(g: Game, p: PlayerState, m: MissionState, out: Outbox, label: string): void {
  m.status = 'completed';
  m.resolvedAt = Date.now();
  p.stats.missionsCompleted++;
  p.streak++;
  const gained = earn(g, p, m.reward);
  toast(out, p.id, { text: `${label} · +${gained} 🪙`, tone: 'coins', private: true, sound: 'coins' });
  if (p.streak > 0 && p.streak % STREAK_TARGET === 0) {
    const bonus = earn(g, p, STREAK_BONUS, false);
    toast(out, p.id, { text: `🔥 Racha de ${p.streak} sin que te pillen · +${bonus} 🪙`, tone: 'coins', private: true, sound: 'coins' });
    announce(g, `🔥 ${p.name} lleva ${p.streak} misiones seguidas sin que nadie le pille. La casa le premia con ${bonus} 🪙.`, 'special');
  }
}

/** Resuelve la orden de sabotaje al terminar la prueba: paga si el equipo falló. */
export function resolveSaboteur(g: Game, passed: boolean | null, out: Outbox): void {
  const m = g.missions.find((x) => x.tags.includes(SABOTEUR_TAG) && x.assignedRound === g.roundIndex && x.status === 'active');
  if (!m) return;
  const saboteur = g.players.find((p) => p.id === m.playerId);
  m.resolvedAt = Date.now();
  if (passed === false && saboteur && !saboteur.left) {
    completeMission(g, saboteur, m, out, 'Sabotaje cumplido');
    return;
  }
  m.status = 'discarded';
  if (saboteur) toast(out, saboteur.id, { text: 'El equipo superó la prueba. Tu sabotaje no cuajó.', tone: 'info', private: true });
}

export function dealMissions(g: Game, out: Outbox): void {
  for (const p of activePlayers(g)) {
    let guard = 5;
    while (activeMissionsOf(g, p.id).length < missionSlots(p) && guard-- > 0) {
      if (!assignMission(g, p, out)) break;
    }
    if (g.suspects.includes(p.id) && !g.missions.some((m) => m.playerId === p.id && m.status === 'active' && m.tags.includes(SUSPECT_TAG))) {
      assignSuspectTask(g, p, out);
    }
  }
  dealCoupleMission(g, out);
  dealCorroMission(g, out);
  dealDuel(g, out);
  dealPatata(g, out);
}

function ownActiveMission(g: Game, p: PlayerState, missionId: string): MissionState {
  const m = g.missions.find((x) => x.id === missionId && x.playerId === p.id);
  // expiresAt también se mira aquí: el barrido del tick corre cada segundo y la
  // misión podría estar ya muerta aunque aún no haya pasado el barrendero
  if (!m || m.status !== 'active' || (m.expiresAt && gameNow(g) >= m.expiresAt)) throw new GameError('Esa misión no está activa');
  return m;
}

export function claimMission(g: Game, p: PlayerState, missionId: string, out: Outbox): void {
  const m = ownActiveMission(g, p, missionId);
  // La orden oscura no se reclama: cobra sola al terminar la prueba, y solo si el equipo falló
  if (m.tags.includes(SABOTEUR_TAG)) throw new GameError('Eso no se reclama: se resuelve solo al terminar la prueba');
  if (m.auto) throw new GameError('Esta la comprueba la casa: no hace falta pulsar nada');
  if (m.tags.includes(PATATA_TAG)) throw new GameError('La patata no se cumple: se pasa');
  completeMission(g, p, m, out, 'Misión cumplida');
  announce(g, 'Alguien acaba de cumplir una misión secreta.', 'special');
}

export function discardMission(g: Game, p: PlayerState, missionId: string): void {
  const m = ownActiveMission(g, p, missionId);
  if (m.tags.includes(SUSPECT_TAG)) throw new GameError('La orden de la casa no se descarta');
  if (m.tags.includes(SABOTEUR_TAG)) throw new GameError('La orden oscura no se descarta');
  if (m.tags.includes(PATATA_TAG)) throw new GameError('La patata no se tira: se pasa a otra persona');
  m.status = 'discarded';
  m.resolvedAt = Date.now();
}

export function pillar(g: Game, p: PlayerState, target: PlayerState, out: Outbox): void {
  if (target.id === p.id) throw new GameError('No puedes pillarte a ti mismo');
  if (target.left) throw new GameError('Ese jugador ya no está');
  if (p.pilladoRound === g.roundIndex) throw new GameError('Ya has usado tu ¡PILLADO! esta ronda');
  p.pilladoRound = g.roundIndex;

  if (target.inventory.coartada > 0) {
    target.inventory.coartada--;
    const lost = Math.min(PILLADO_PENALTY, p.coins);
    p.coins -= lost;
    p.stats.pilladoMisses++;
    toast(out, p.id, { text: `${target.name} saca una coartada con sello de la casa. Falsa alarma · -${lost} 🪙`, tone: 'danger', private: true, sound: 'danger' });
    toast(out, target.id, { text: `🛡️ ${p.name} ha intentado pillarte. Tu coartada le ha parado.`, tone: 'safe', private: true, sound: 'victory' });
    announce(g, `🛡️ ${p.name} ha intentado pillar a ${target.name}... pero tenía coartada. Qué ridículo.`, 'info');
    return;
  }

  const caught = g.missions.find((m) => m.playerId === target.id && m.status === 'active' && (!m.expiresAt || gameNow(g) < m.expiresAt) && m.targets.includes(p.id));
  if (caught) {
    caught.status = 'burned';
    caught.resolvedAt = Date.now();
    target.stats.missionsBurned++;
    target.streak = 0; // que te pillen te rompe la racha
    p.stats.pilladoHits++;
    const gained = earn(g, p, PILLADO_REWARD);
    toast(out, p.id, { text: `¡PILLADO! Tenía una misión sobre ti · +${gained} 🪙`, tone: 'coins', private: true, sound: 'coins' });
    toast(out, target.id, { text: `${p.name} te ha pillado. Tu misión se ha quemado.`, tone: 'danger', private: true, sound: 'danger' });
    announce(g, `¡PILLADO! ${p.name} ha pillado a ${target.name} con las manos en la masa.`, 'danger');
    notifyAutoMissions(g, { type: 'pillado', byId: p.id });
  } else {
    const lost = Math.min(PILLADO_PENALTY, p.coins);
    p.coins -= lost;
    p.stats.pilladoMisses++;
    toast(out, p.id, { text: `Falsa alarma. ${target.name} no tenía nada contra ti · -${lost} 🪙`, tone: 'danger', private: true, sound: 'danger' });
    announce(g, `${p.name} ha acusado a ${target.name} de tramar algo... y se ha equivocado.`, 'info');
  }
}

// ---------------------------------------------------------------- misiones que comprueba la casa
// Sin botón de «¡Cumplida!»: el servidor mira el dato real en su momento (al revelar el
// juicio, al cerrar la ronda o al ver un evento). Nadie las cobra sin cumplirlas.

export type AutoEvent =
  | { type: 'ability'; userId: string; abilityId: string; targetIds: string[]; clean?: boolean }
  | { type: 'certify'; forgedBy: string | null }
  | { type: 'gift'; fromId: string; toId: string }
  | { type: 'pillado'; byId: string };

interface AutoCtx {
  g: Game;
  m: MissionState;
  p: PlayerState;
  target: PlayerState | undefined;
}

interface AutoCheck {
  /** judgment: al revelar el juicio · round_end: al cerrar la ronda · event: al verlo (se paga al cerrar la ronda) */
  at: 'judgment' | 'round_end' | 'event';
  /** Foto del dato al repartirla, para medir lo que pasa desde entonces */
  base?: (p: PlayerState, target: PlayerState | undefined) => number;
  judge?: (c: AutoCtx) => boolean;
  onEvent?: (c: AutoCtx, e: AutoEvent) => boolean;
}

const byId = (g: Game, id: string | undefined) => g.players.find((x) => x.id === id);
const votesOf = (g: Game, id: string | undefined) => g.vote?.tally?.find((t) => t.id === id)?.votes ?? 0;
const touched = (p: PlayerState) => p.stats.stolenFrom + p.stats.missionsBurned;
const cucoId = (g: Game, id: string) => {
  const p = byId(g, id);
  return !!p && isCuco(p);
};

export const AUTO_CHECKS: Record<string, AutoCheck> = {
  target_suspect: { at: 'judgment', judge: ({ g, target }) => !!target && g.vote!.suspects.includes(target.id) },
  self_not_suspect: { at: 'judgment', judge: ({ g, p }) => !g.vote!.suspects.includes(p.id) },
  self_one_vote: { at: 'judgment', judge: ({ g, p }) => votesOf(g, p.id) === 1 },
  self_max1: { at: 'judgment', judge: ({ g, p }) => votesOf(g, p.id) <= 1 },
  target_votes2: { at: 'judgment', judge: ({ g, target }) => votesOf(g, target?.id) >= 2 },
  // Diferencia relativa: no basta con ser ya más rico, hay que ganar más durante la ronda
  richer_than_target: { at: 'round_end', base: (p, t) => p.coins - (t?.coins ?? 0), judge: ({ m, p, target }) => !!target && p.coins - target.coins > m.auto!.base },
  untouched_round: { at: 'round_end', base: (p) => touched(p), judge: ({ m, p }) => touched(p) === m.auto!.base },
  target_touched: { at: 'round_end', base: (_p, t) => (t ? touched(t) : 0), judge: ({ m, target }) => !!target && touched(target) > m.auto!.base },
  target_buys: { at: 'round_end', base: (_p, t) => t?.stats.itemsBought ?? 0, judge: ({ m, target }) => !!target && target.stats.itemsBought > m.auto!.base },
  self_no_buy: { at: 'round_end', base: (p) => p.stats.itemsBought, judge: ({ m, p }) => p.stats.itemsBought === m.auto!.base },
  ability_on_me: { at: 'event', onEvent: ({ g, p }, e) => e.type === 'ability' && e.targetIds.includes(p.id) && !cucoId(g, e.userId) },
  investigated_clean: { at: 'event', onEvent: ({ p }, e) => e.type === 'ability' && e.abilityId === 'investigar' && e.targetIds.includes(p.id) && e.clean === true },
  forged_certified: { at: 'event', onEvent: ({ p }, e) => e.type === 'certify' && e.forgedBy === p.id },
  gift_from_cuco: { at: 'event', onEvent: ({ g, p }, e) => e.type === 'gift' && e.toId === p.id && cucoId(g, e.fromId) },
  pillado_hit: { at: 'event', onEvent: ({ p }, e) => e.type === 'pillado' && e.byId === p.id },
};

function autoState(g: Game, check: string, p: PlayerState, targets: string[]): NonNullable<MissionState['auto']> {
  const def = AUTO_CHECKS[check];
  if (!def) throw new Error(`Comprobación desconocida: ${check}`);
  return { check, base: def.base?.(p, byId(g, targets[0])) ?? 0 };
}

function settleAuto(g: Game, p: PlayerState, m: MissionState, ok: boolean, out: Outbox): void {
  if (ok) {
    completeMission(g, p, m, out, 'La casa lo ha visto');
    announce(g, 'La casa ha visto cumplirse una misión secreta.', 'special');
    return;
  }
  m.status = 'discarded';
  m.resolvedAt = Date.now();
  toast(out, p.id, { text: 'La casa no lo ha visto: misión fallida', tone: 'info', private: true });
}

/** Resuelve las misiones de la casa que tocan en este momento. Las de evento cobran al
 *  cerrar la ronda (no al instante): así un pago no señala quién hizo qué. */
export function resolveAutoMissions(g: Game, at: 'judgment' | 'round_end', out: Outbox): void {
  for (const m of g.missions.filter((x) => x.status === 'active' && x.auto)) {
    const check = AUTO_CHECKS[m.auto!.check];
    const p = byId(g, m.playerId);
    if (!check || !p || p.left) continue;
    if (check.at === 'event') {
      // Las de evento viven solo su ronda: al cerrarla, con hit cobran y sin hit caen
      if (at === 'round_end') settleAuto(g, p, m, !!m.auto!.hit, out);
      continue;
    }
    if (check.at !== at) continue;
    const target = byId(g, m.targets[0]);
    // Si el objetivo se fue, la misión ya no tiene sentido: se cae sin pagar
    settleAuto(g, p, m, !target?.left && check.judge!({ g, m, p, target }), out);
  }
}

export function notifyAutoMissions(g: Game, e: AutoEvent): void {
  for (const m of g.missions) {
    if (m.status !== 'active' || !m.auto || m.auto.hit) continue;
    const check = AUTO_CHECKS[m.auto.check];
    const p = byId(g, m.playerId);
    if (check?.at === 'event' && p && check.onEvent!({ g, m, p, target: byId(g, m.targets[0]) }, e)) m.auto.hit = true;
  }
}

// ---------------------------------------------------------------- duelos
// Dos jugadores reciben a la vez misiones opuestas. Ninguno sabe que el otro tiene la
// contraria; quien ataca pone al rival como {A}, así que el rival sí puede pillarle.
export const DUEL_TAG = 'duelo';

export function dealDuel(g: Game, out: Outbox, force = false): void {
  const active = activePlayers(g);
  if (active.length < 4 || (!force && (g.roundIndex < 1 || !chance(DUEL_CHANCE)))) return;
  const fits = (d: DuelDef) => !d.needsJudgment || futureJudgment(g);
  const fresh = gameContent(g).duels.filter((d) => fits(d) && !g.missions.some((m) => m.missionId.startsWith(`duel:${d.id}:`)));
  const pool = fresh.length ? fresh : gameContent(g).duels.filter(fits);
  if (!pool.length) return;
  const def = pick(pool);
  const [a, b] = shuffle(active);
  const give = (p: PlayerState, rival: PlayerState, side: DuelDef['attack'], key: 'attack' | 'defend') => {
    const targets = key === 'attack' || side.targetsRival ? [rival.id] : [];
    g.missions.push({
      id: shortId(),
      missionId: `duel:${def.id}:${key}`,
      playerId: p.id,
      text: resolveText(g, side, targets),
      difficulty: side.difficulty,
      category: DUEL_TAG,
      reward: MISSION_REWARD[side.difficulty],
      targets,
      tags: [DUEL_TAG, ...(def.needsJudgment ? ['needs_judgment'] : [])],
      status: 'active',
      assignedRound: g.roundIndex,
      resolvedAt: null,
      auto: autoState(g, side.auto, p, targets),
    });
    toast(out, p.id, { text: 'Nueva misión secreta', tone: 'special', private: true, sound: 'mission' });
  };
  give(a, b, def.attack, 'attack');
  give(b, a, def.defend, 'defend');
}

// ---------------------------------------------------------------- patata caliente
// Una bomba que nadie quiere: hay que pasársela a otro antes de que acabe la ronda.
// Pasarla delata ante quien la recibe que la tenías; no se devuelve al instante.
export const PATATA_TAG = 'patata';

export function dealPatata(g: Game, out: Outbox, force = false): void {
  const active = activePlayers(g);
  if (active.length < 4 || (!force && (g.roundIndex < 1 || !chance(PATATA_CHANCE)))) return;
  if (g.missions.some((m) => m.status === 'active' && m.tags.includes(PATATA_TAG))) return;
  const p = pick(active);
  g.missions.push({
    id: shortId(),
    missionId: `patata:${g.roundIndex}`,
    playerId: p.id,
    text: `Patata caliente: pásasela a otra persona (dale la mano y di «patata») antes de que acabe la ronda. Quien la tenga al final paga ${PATATA_PENALTY} monedas. A quien te la pasó no se la puedes devolver.`,
    difficulty: 'media',
    category: PATATA_TAG,
    reward: 0,
    targets: [],
    tags: [PATATA_TAG],
    status: 'active',
    assignedRound: g.roundIndex,
    resolvedAt: null,
  });
  toast(out, p.id, { text: '🥔 Te ha tocado la patata caliente. Quítatela de encima.', tone: 'danger', private: true, sound: 'danger' });
  announce(g, `🥔 Hay una patata caliente suelta por la casa. Quien la tenga al acabar la ronda paga ${PATATA_PENALTY} monedas.`, 'danger');
}

export function passPatata(g: Game, p: PlayerState, missionId: string, target: PlayerState, out: Outbox): void {
  const m = g.missions.find((x) => x.id === missionId && x.playerId === p.id && x.status === 'active' && x.tags.includes(PATATA_TAG));
  if (!m) throw new GameError('No tienes la patata');
  if (target.id === p.id || target.left) throw new GameError('Pásasela a otra persona de la casa');
  if (m.passedFrom === target.id) throw new GameError('No se la puedes devolver a quien te la pasó');
  m.playerId = target.id;
  m.passedFrom = p.id;
  toast(out, target.id, { text: `🥔 ${p.name} te ha pasado la patata caliente. Quítatela de encima antes de que acabe la ronda.`, tone: 'danger', private: true, sound: 'danger' });
  toast(out, p.id, { text: `🥔 Patata pasada a ${target.name}`, tone: 'safe', private: true });
  announce(g, '🥔 La patata caliente ha cambiado de manos.', 'info');
}

/** Al cerrar la ronda, a quien tenga la patata le explota en las manos. */
export function explodePatata(g: Game, out: Outbox): void {
  for (const m of g.missions.filter((x) => x.status === 'active' && x.tags.includes(PATATA_TAG))) {
    m.status = 'burned';
    m.resolvedAt = Date.now();
    const holder = byId(g, m.playerId);
    if (!holder || holder.left) continue;
    const lost = Math.min(PATATA_PENALTY, holder.coins);
    holder.coins -= lost;
    announce(g, `🥔 ¡BOOM! A ${holder.name} le ha explotado la patata caliente: -${lost} 🪙.`, 'danger');
    toast(out, 'all', { text: `🥔 ¡BOOM! La patata le explota a ${holder.name}`, tone: 'danger', sound: 'danger' });
  }
}

