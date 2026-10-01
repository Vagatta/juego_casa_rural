import { useState } from 'react';
import { AVATARS } from '../../shared/constants.ts';
import { Button, InlineError } from '../components/ui.tsx';
import { api } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';

const NAMES = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta', 'Pablo', 'Sara', 'Sergio', 'Lucía', 'Iván', 'Nuria'];

interface Sandbox {
  code: string;
  hostToken: string;
  players: { name: string; token: string }[];
}

/** Mesa de pruebas para desarrollo: una TV del director + un móvil por jugador, todo en iframes. */
export function DevScreen() {
  const [n, setN] = useState(6);
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await api.create({ durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: n, hostPlays: false });
      const players: Sandbox['players'] = [];
      for (let i = 0; i < n; i++) {
        const j = await api.join(g.code, { name: NAMES[i], avatar: AVATARS[i % AVATARS.length] });
        players.push({ name: NAMES[i], token: j.playerToken });
      }
      setSandbox({ code: g.code, hostToken: g.hostToken, players });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!sandbox) {
    return (
      <main className="page center" style={{ justifyContent: 'center' }}>
        <span className="eyebrow">Solo para desarrollo</span>
        <h1 style={{ fontSize: 44 }}>Mesa de pruebas</h1>
        <p className="muted center">Levanta una casa con jugadores de mentira y mira todas las pantallas a la vez: la TV del director arriba y un móvil por persona debajo.</p>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="dev-n">Jugadores</label>
          <input id="dev-n" className="input" type="number" min={4} max={12} value={n} onChange={(e) => setN(Math.max(4, Math.min(12, Number(e.target.value) || 6)))} />
        </div>
        <InlineError error={error} />
        <Button block arrow variant="danger" disabled={busy} onClick={build}>
          {busy ? 'Levantando la casa...' : `Levantar mesa de ${n}`}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Volver
        </Button>
      </main>
    );
  }

  return (
    <main className="devboard">
      <header className="devboard__bar">
        <strong className="display">Casa {sandbox.code}</strong>
        <span className="muted small">Mesa de pruebas — {sandbox.players.length} móviles</span>
        <Button small variant="ghost" onClick={() => setSandbox(null)}>
          Otra mesa
        </Button>
      </header>
      <div className="devboard__tv">
        <iframe title="Director" src={`/director/${sandbox.code}#t=${sandbox.hostToken}`} />
      </div>
      <div className="devboard__grid">
        {sandbox.players.map((p) => (
          <figure key={p.token} className="devboard__phone">
            <iframe title={p.name} src={`/partida/${sandbox.code}#t=${p.token}`} />
            <figcaption>{p.name}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
