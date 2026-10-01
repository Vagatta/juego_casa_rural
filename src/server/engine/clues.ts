// Pistas generadas a partir de datos REALES de la partida. Pueden ser ciertas,
// ambiguas (ciertas pero poco útiles) o falsas. El destinatario nunca sabe cuál.
import { chance, pick, sample, shortId, shuffle } from './rng.ts';
import {
  type ClueSource,
  type ClueState,
  type Game,
  type Outbox,
  type PlayerState,
  activePlayers,
  isCuco,
  nameOf,
  seenAsCuco,
  toast,
} from './state.ts';

type Truth = ClueState['truth'];
interface Draft {
  text: string;
  truth: Truth;
}

const list = (g: Game, ids: string[]) => {
  const names = ids.map((id) => nameOf(g, id));
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
};
const listOr = (g: Game, ids: string[]) => ids.map((id) => nameOf(g, id)).join(' o ');

function othersOf(g: Game, recipient: PlayerState) {
  const others = activePlayers(g).filter((p) => p.id !== recipient.id);
  return { others, cucos: others.filter(isCuco), innocents: others.filter((p) => !isCuco(p)) };
}

// ------------------------------------------------------------- plantillas

function pairClue(g: Game, recipient: PlayerState, want: 'true' | 'false'): Draft | null {
  const { others, cucos, innocents } = othersOf(g, recipient);
  if (others.length < 2) return null;
  const withCuco = cucos.length > 0 && chance(0.5);
  let pair: PlayerState[];
  if (withCuco && innocents.length > 0) pair = shuffle([pick(cucos), pick(innocents)]);
  else if (innocents.length >= 2) pair = sample(innocents, 2);
  else pair = sample(others, 2);
  const hasCuco = pair.some(isCuco);
  const claimsCuco = want === 'true' ? hasCuco : !hasCuco;
  const ids = pair.map((p) => p.id);
  return {
    text: claimsCuco ? `Entre ${list(g, ids)} hay al menos un Cuco.` : `Ni ${nameOf(g, ids[0])} ni ${nameOf(g, ids[1])} son Cucos.`,
    truth: want,
  };
}

function trioClue(g: Game, recipient: PlayerState, want: Truth): Draft | null {
  const { cucos, innocents } = othersOf(g, recipient);
  const size = want === 'ambiguous' ? 4 : 3;
  if (want === 'false') {
    if (innocents.length < 3) return null;
    return { text: `Uno de los Cucos está entre ${list(g, shuffle(sample(innocents, 3)).map((p) => p.id))}.`, truth: 'false' };
  }
  if (!cucos.length || innocents.length < size - 1) return null;
  const ids = shuffle([pick(cucos), ...sample(innocents, size - 1)]).map((p) => p.id);
  return { text: `Uno de los Cucos está entre ${list(g, ids)}.`, truth: want };
}

function innocentClue(g: Game, recipient: PlayerState, want: 'true' | 'false'): Draft | null {
  const { cucos, innocents } = othersOf(g, recipient);
  const pool = want === 'true' ? innocents : cucos;
  if (!pool.length) return null;
  return { text: `${pick(pool).name} no es un Cuco.`, truth: want };
}

function waxClue(g: Game, want: 'true' | 'false'): Draft | null {
  const sabotaged = g.rounds.filter((r) => r.saboteurs.length > 0);
  if (!sabotaged.length) return null;
  const round = pick(sabotaged);
  const innocents = round.ritualParticipants.filter((id) => !round.saboteurs.includes(id));
  let ids: string[];
  if (want === 'true') {
    if (!innocents.length) return null;
    ids = shuffle([pick(round.saboteurs), pick(innocents)]);
  } else {
    if (innocents.length < 2) return null;
    ids = sample(innocents, 2);
  }
  return { text: `Huella de cera en el Ritual de la ronda ${round.index + 1}: ${listOr(g, ids)} usó una cerilla.`, truth: want };
}

function voteClue(g: Game, recipient: PlayerState, want: 'true' | 'false'): Draft | null {
  const ballots = g.lastJudgment;
  if (!ballots) return null;
  const voters = Object.keys(ballots).filter((id) => id !== recipient.id && ballots[id].length);
  if (!voters.length) return null;
  const voter = pick(voters);
  let target = ballots[voter][0];
  if (want === 'false') {
    const alt = activePlayers(g).filter((p) => p.id !== voter && !ballots[voter].includes(p.id));
    if (!alt.length) return null;
    target = pick(alt).id;
  }
  return { text: `${nameOf(g, voter)} votó a ${nameOf(g, target)} en el último juicio.`, truth: want };
}

function missionTargetClue(g: Game, recipient: PlayerState, want: 'true' | 'false'): Draft | null {
  const plotters = new Set(
    g.missions.filter((m) => m.status === 'active' && m.targets.includes(recipient.id)).map((m) => m.playerId),
  );
  const { others } = othersOf(g, recipient);
  const clean = others.filter((p) => !plotters.has(p.id));
  let ids: string[];
  if (want === 'true') {
    if (!plotters.size || !clean.length) return null;
    ids = shuffle([pick([...plotters]), pick(clean).id]);
  } else {
    if (clean.length < 2) return null;
    ids = sample(clean, 2).map((p) => p.id);
  }
  return { text: `Alguien tiene una misión sobre ti: ${listOr(g, ids)}.`, truth: want };
}

// ------------------------------------------------------------- API

export function randomClue(g: Game, recipient: PlayerState, truth: Truth): Draft {
  const generators: (() => Draft | null)[] =
    truth === 'ambiguous'
      ? [() => trioClue(g, recipient, 'ambiguous')]
      : shuffle([
          () => pairClue(g, recipient, truth),
          () => pairClue(g, recipient, truth),
          () => trioClue(g, recipient, truth),
          () => innocentClue(g, recipient, truth),
          () => waxClue(g, truth),
          () => waxClue(g, truth),
          () => voteClue(g, recipient, truth),
          () => missionTargetClue(g, recipient, truth),
        ]);
  for (const gen of generators) {
    const draft = gen();
    if (draft) return draft;
  }
  return pairClue(g, recipient, truth === 'false' ? 'false' : 'true') ?? { text: 'La casa guarda silencio esta vez.', truth: 'true' };
}

export function shopClueTruth(g: Game): Truth {
  const [pTrue, pAmbiguous] = g.settings.difficulty === 'dificil' ? [0.55, 0.2] : g.settings.difficulty === 'facil' ? [0.8, 0.1] : [0.7, 0.15];
  const roll = Math.random();
  return roll < pTrue ? 'true' : roll < pTrue + pAmbiguous ? 'ambiguous' : 'false';
}

export function deliverClue(
  g: Game,
  out: Outbox,
  recipient: PlayerState,
  source: ClueSource,
  draft: Draft,
  forgedBy: string | null = null,
): ClueState {
  const clue: ClueState = {
    id: shortId(),
    recipientId: recipient.id,
    source,
    text: draft.text,
    truth: draft.truth,
    forgedBy,
    round: g.roundIndex,
    createdAt: Date.now(),
  };
  g.clues.push(clue);
  recipient.stats.cluesReceived++;
  const label = source === 'nota' ? 'Te han dejado una nota bajo la puerta' : 'Nueva pista';
  toast(out, recipient.id, { text: label, tone: 'special', private: true, sound: 'reveal' });
  return clue;
}

/** Investigación del Curioso: siempre dice la verdad... según lo que ve (el Doble le engaña). */
export function investigate(g: Game, a: PlayerState, b: PlayerState): Draft {
  const seen = seenAsCuco(a) || seenAsCuco(b);
  const real = isCuco(a) || isCuco(b);
  return {
    text: seen ? `Entre ${a.name} y ${b.name} hay al menos un Cuco.` : `Ni ${a.name} ni ${b.name} son Cucos.`,
    truth: seen === real ? 'true' : 'false',
  };
}

export function recipe(g: Game, abuela: PlayerState): Draft {
  const others = activePlayers(g).filter((p) => p.id !== abuela.id);
  const visible = others.filter(seenAsCuco);
  const clean = others.filter((p) => !seenAsCuco(p));
  if (!visible.length || clean.length < 2) return { text: 'La receta se ha quemado. No hay nada que leer.', truth: 'ambiguous' };
  const ids = shuffle([pick(visible), ...sample(clean, 2)]).map((p) => p.id);
  return { text: `Receta de la abuela: uno de los Cucos está entre ${list(g, ids)}.`, truth: 'true' };
}

export function voteReveal(g: Game, target: PlayerState): Draft {
  const ballot = g.lastJudgment?.[target.id];
  if (!ballot || !ballot.length) return { text: `${target.name} no votó en el último juicio.`, truth: 'true' };
  return { text: `${target.name} votó a ${list(g, ballot)} en el último juicio.`, truth: 'true' };
}

/** Nota del Falsificador: si el señalado es Cuco, la nota lo "limpia"; si no, lo incrimina. */
export function forgedNote(g: Game, recipient: PlayerState, subject: PlayerState): Draft {
  if (isCuco(subject)) return { text: `${subject.name} no es un Cuco.`, truth: 'false' };
  const fillers = activePlayers(g).filter((p) => !isCuco(p) && p.id !== subject.id && p.id !== recipient.id);
  if (!fillers.length) return { text: `${subject.name} es un Cuco.`, truth: 'false' };
  const other = pick(fillers);
  return { text: `Entre ${list(g, shuffle([subject.id, other.id]))} hay al menos un Cuco.`, truth: 'false' };
}
