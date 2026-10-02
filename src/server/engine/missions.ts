import {
  CORRO_CHANCE,
  CORRO_REWARD,
  COUPLE_CHANCE,
  COUPLE_REWARD,
  MISSION_REWARD,
  MISSION_SLOTS,
  MISSION_SLOTS_VECINO,
  PILLADO_PENALTY,
  PILLADO_REWARD,
  SABOTEUR_REWARD,
  STREAK_BONUS,
  STREAK_TARGET,
} from '../../shared/constants.ts';
import type { MissionDifficulty } from '../../shared/types.ts';
import { content, gameContent, type MissionDef, type SuspectTaskDef } from '../content.ts';
import { deliverClue } from './clues.ts';
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

function futureJudgment(g: Game): boolean {
  // El juicio de la ronda actual cuenta si todavía no se ha celebrado
  const from = g.phase === 'VOTING' || g.phase === 'ROUND_RESULT' ? g.roundIndex + 1 : Math.max(0, g.roundIndex);
  return g.plan.slice(from).some((r) => r.hasJudgment);
}

function eligible(g: Game, p: PlayerState, def: MissionDef, factionOnly?: string): boolean {
  const faction = factionOf(p);
  if (factionOnly && def.faction !== factionOnly) return false;
  if (def.faction !== 'any' && def.faction !== faction) return false;
  if (def.targets > activePlayers(g).length - 1) return false;
  if (def.tags.includes('needs_judgment') && !futureJudgment(g)) return false;
  if (def.tags.includes('needs_partner') && g.cucoCount < 2) return false;
  if (g.missions.some((m) => m.playerId === p.id && m.missionId === def.id)) return false;
  const active = g.missions.filter((m) => m.status === 'active');
  for (const tag of def.tags) {
    if (EXCLUSIVE_TAGS.has(tag) && active.some((m) => m.tags.includes(tag))) return false;
  }
  return true;
}

function chooseTargets(g: Game, p: PlayerState, count: number): string[] {
  if (count === 0) return [];
  const incoming = (id: string) => g.missions.filter((m) => m.status === 'active' && m.targets.includes(id)).length;
  // Preferimos objetivos con menos misiones encima: reparte la "presión" y evita que alguien sea imposible de engañar
  const others = shuffle(activePlayers(g).filter((o) => o.id !== p.id)).sort((a, b) => incoming(a.id) - incoming(b.id));
  return others.slice(0, count).map((o) => o.id);
}

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

export function assignMission(g: Game, p: PlayerState, out: Outbox, factionOnly?: string): MissionState | null {
  const weights = DIFFICULTY_WEIGHTS[g.settings.difficulty];
  const all = [...gameContent(g).missions, ...customDefs(g)];
  const unusedFirst = all.filter((d) => !g.used.missions.includes(d.id) && eligible(g, p, d, factionOnly));
  const pool = unusedFirst.length ? unusedFirst : all.filter((d) => eligible(g, p, d, factionOnly));
  // Las misiones propias de la facción y las del grupo pesan más: para eso las escribió el anfitrión
  const def = weighted(pool, (d) => weights[d.difficulty] * (d.tags.includes('custom') || d.faction !== 'any' ? 3 : 1));
  if (!def) return null;

  const targets = chooseTargets(g, p, def.targets);
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
  };
  g.missions.push(mission);
  g.used.missions.push(def.id);
  toast(out, p.id, { text: 'Nueva misión secreta', tone: 'special', private: true, sound: 'mission' });
  // El Insomne oye crujir el pasillo: sabe a quién le ha llegado una misión
  for (const s of activePlayers(g).filter((o) => o.roleId === 'insomne' && o.id !== p.id)) {
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
  completeMission(g, p, m, out, 'Misión cumplida');
  announce(g, 'Alguien acaba de cumplir una misión secreta.', 'special');
}

export function discardMission(g: Game, p: PlayerState, missionId: string): void {
  const m = ownActiveMission(g, p, missionId);
  if (m.tags.includes(SUSPECT_TAG)) throw new GameError('La orden de la casa no se descarta');
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
  } else {
    const lost = Math.min(PILLADO_PENALTY, p.coins);
    p.coins -= lost;
    p.stats.pilladoMisses++;
    toast(out, p.id, { text: `Falsa alarma. ${target.name} no tenía nada contra ti · -${lost} 🪙`, tone: 'danger', private: true, sound: 'danger' });
    announce(g, `${p.name} ha acusado a ${target.name} de tramar algo... y se ha equivocado.`, 'info');
  }
}
