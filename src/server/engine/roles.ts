import { CERILLAS_PER_CUCO } from '../../shared/constants.ts';
import type { Game } from './state.ts';
import { activePlayers, isCuco } from './state.ts';
import { shuffle } from './rng.ts';

export function cucoCountFor(n: number): number {
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  return 3;
}

/** Reparto de roles según el número de jugadores (ver docs/01-DISENO.md §2). */
export function roleDistribution(n: number): string[] {
  const cucos = cucoCountFor(n);
  // Con un solo Cuco, que tenga habilidad activa: un Doble solitario deja la partida sin pistas fiables.
  const cucoPool = cucos === 1 ? ['cuco_falsificador', 'cuco_carterista'] : ['cuco_falsificador', 'cuco_carterista', 'cuco_doble'];
  const roles = shuffle(cucoPool).slice(0, cucos);

  const turista = n >= 10 ? 1 : 0;
  if (turista) roles.push('turista');

  const curiosos = n >= 8 ? 2 : 1;
  for (let i = 0; i < curiosos; i++) roles.push('curioso');

  const rest = n - roles.length;
  // La Abuela siempre está en mesas grandes; el resto de oficios sale al azar para variar
  const specials = ['abuela', ...shuffle(['manitas', 'fotografa', 'chismoso', 'contable', 'insomne', 'notario', 'buscavidas'])];
  for (let i = 0; i < rest; i++) roles.push(specials[i] ?? 'vecino');
  return roles;
}

export function assignRoles(g: Game): void {
  const players = shuffle(activePlayers(g));
  const roles = roleDistribution(players.length);
  players.forEach((p, i) => {
    p.roleId = roles[i];
    p.cerillas = isCuco(p) ? CERILLAS_PER_CUCO : 0;
  });
  g.cucoCount = players.filter(isCuco).length;
}
