import { randomBytes, randomInt } from 'node:crypto';

export const rand = (n: number): number => randomInt(n);
export const chance = (p: number): boolean => randomInt(1_000_000) < p * 1_000_000;

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() sobre lista vacía');
  return items[randomInt(items.length)];
}

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const sample = <T>(items: readonly T[], n: number): T[] => shuffle(items).slice(0, n);

/** Elección ponderada: weights[i] >= 0 */
export function weighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (total <= 0) return null;
  let roll = (randomInt(1_000_000) / 1_000_000) * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export const secretToken = (): string => randomBytes(16).toString('hex');
export const shortId = (): string => randomBytes(6).toString('base64url');
