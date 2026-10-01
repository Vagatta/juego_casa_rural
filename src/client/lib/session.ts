// Sesiones guardadas en el dispositivo: refrescar o perder la conexión no te saca de la partida.
export interface Session {
  code: string;
  playerToken?: string;
  hostToken?: string;
  savedAt: number;
}

const KEY = 'casa-rural:sessions';

function readAll(): Record<string, Session> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Session>;
  } catch {
    return {};
  }
}

export function getSession(code: string): Session | null {
  return readAll()[code.toUpperCase()] ?? null;
}

export function saveSession(code: string, patch: Partial<Omit<Session, 'code' | 'savedAt'>>): void {
  const all = readAll();
  const key = code.toUpperCase();
  all[key] = { ...all[key], ...patch, code: key, savedAt: Date.now() };
  // Solo guardamos las últimas partidas: un fin de semana, varias noches
  const recent = Object.values(all).sort((a, b) => b.savedAt - a.savedAt).slice(0, 6);
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(recent.map((s) => [s.code, s]))));
}

export function forgetPlayer(code: string): void {
  const all = readAll();
  const s = all[code.toUpperCase()];
  if (!s) return;
  delete s.playerToken;
  if (!s.hostToken) delete all[code.toUpperCase()];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function lastSession(): Session | null {
  return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
