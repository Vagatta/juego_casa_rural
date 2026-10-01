// Medallero local: las medallas se derivan de la ceremonia final y se acumulan
// en este dispositivo entre partidas y noches. Nada sale del navegador.
import type { GameView } from '../../shared/types.ts';

export interface MedalDef {
  id: string;
  emoji: string;
  name: string;
  desc: string;
}

export const MEDALS: MedalDef[] = [
  { id: 'podio', emoji: '🥇', name: 'Rey de la casa', desc: 'Terminar primera en el podio.' },
  { id: 'premio', emoji: '🏅', name: 'Laureado', desc: 'Llevarte un premio de la ceremonia.' },
  { id: 'ganador', emoji: '🏆', name: 'Facción victoriosa', desc: 'Tu bando ganó La Balanza.' },
  { id: 'oculto', emoji: '🐦', name: 'Cuco en la sombra', desc: 'Ser Cuco y salir sin ser desenmascarado.' },
  { id: 'turista', emoji: '🧳', name: 'Turista consumado', desc: 'Ganar como Turista siendo el más señalado.' },
  { id: 'casino', emoji: '🎰', name: 'Apostante de oro', desc: 'Acertar una apuesta en la Gran Acusación.' },
  { id: 'vidente', emoji: '🔮', name: 'Vidente', desc: 'Oler a un Cuco en la ronda 1, sin pruebas.' },
  { id: 'buscavidas', emoji: '🎩', name: 'Buscavidas', desc: 'Acabar entre los tres más ricos jugando a tu aire.' },
  { id: 'pobre', emoji: '🥔', name: 'Pobre pero honrado', desc: 'Terminar último en el podio. Alguien tiene que serlo.' },
  { id: 'veterano', emoji: '🕯️', name: 'Veterano', desc: 'Jugar 3 noches en esta casa.' },
];

const KEY = 'casa-rural:medals';
const SEEN_KEY = 'casa-rural:finale-seen';

function read(): { nights: number; medals: Record<string, number> } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { nights: raw.nights ?? 0, medals: raw.medals ?? {} };
  } catch {
    return { nights: 0, medals: {} };
  }
}

/** Medallas que le corresponden a `me` según la ceremonia de esta partida. */
export function medalsEarned(view: GameView): MedalDef[] {
  const me = view.me;
  const f = view.finale;
  if (!me || !f || view.phase !== 'FINALE') return [];
  const earned: MedalDef[] = [];
  const top = f.ranking[0];
  const last = f.ranking[f.ranking.length - 1];
  if (top?.playerId === me.id) earned.push(MEDALS.find((m) => m.id === 'podio')!);
  if (last?.playerId === me.id && f.ranking.length > 1) earned.push(MEDALS.find((m) => m.id === 'pobre')!);
  if (f.awards.some((a) => a.playerId === me.id)) earned.push(MEDALS.find((m) => m.id === 'premio')!);
  if (me.role?.faction && me.role.faction !== 'turista' && f.balance.winner === (me.role.faction === 'cuco' ? 'cucos' : 'huespedes')) earned.push(MEDALS.find((m) => m.id === 'ganador')!);
  if (f.turistaWon === me.id) earned.push(MEDALS.find((m) => m.id === 'turista')!);
  if (me.role?.faction === 'cuco' && !f.unmasked.includes(me.id)) earned.push(MEDALS.find((m) => m.id === 'oculto')!);
  if (f.bets.some((b) => b.playerId === me.id && b.won)) earned.push(MEDALS.find((m) => m.id === 'casino')!);
  if (f.predictions.some((x) => x.playerId === me.id && x.hit)) earned.push(MEDALS.find((m) => m.id === 'vidente')!);
  if (f.buscavidasWon === me.id) earned.push(MEDALS.find((m) => m.id === 'buscavidas')!);
  return earned;
}

/** Registra la noche (una vez por partida) y devuelve las medallas nuevas de esta vez. */
export function recordNight(view: GameView): MedalDef[] {
  if (view.phase !== 'FINALE' || !view.finale || !view.me) return [];
  const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  if (seen.has(view.code)) return [];
  seen.add(view.code);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-20)));
  const earned = medalsEarned(view);
  const state = read();
  state.nights += 1;
  if (state.nights >= 3) earned.push(MEDALS.find((m) => m.id === 'veterano')!);
  for (const m of earned) state.medals[m.id] = (state.medals[m.id] ?? 0) + 1;
  localStorage.setItem(KEY, JSON.stringify(state));
  return earned;
}

/** El medallero acumulado de este dispositivo. */
export function medalCase(): { medal: MedalDef; count: number }[] {
  const { medals } = read();
  return MEDALS.filter((m) => medals[m.id]).map((m) => ({ medal: m, count: medals[m.id] }));
}

export const nightsPlayed = (): number => read().nights;
