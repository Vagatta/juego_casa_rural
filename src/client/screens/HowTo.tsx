import { ArrowLeft } from '@phosphor-icons/react';
import roles from '../../../content/roles.json';
import type { RoleDef } from '../../shared/types.ts';
import { FACTION_LABEL } from '../components/cards.tsx';
import { GIcon, RoleIcon } from '../lib/icons.tsx';
import { Button, Candles } from '../components/ui.tsx';
import { navigate } from '../lib/router.ts';

const STEPS = [
  { icon: 'mental', title: 'Prueba', text: 'El móvil explica y cronometra. La prueba se juega en la habitación: buscar, equilibrarse, mentir, adivinar.' },
  { icon: 'vela', title: 'Ritual', text: 'Si el equipo supera la prueba, cada uno decide en secreto: encender o apagar. Un solo apagón y se abre una grieta.' },
  { icon: 'curioso', title: 'Investigación', text: 'Compra pistas, usa tu habilidad, cumple misiones, pilla a quien trame algo contra ti.' },
  { icon: 'subasta', title: 'Juicio', text: 'Algunas rondas votáis en secreto. El más votado queda bajo sospecha y no entra en el siguiente Ritual.' },
];

export function HowToScreen() {
  return (
    <main className="page howto">
      <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Volver">
        <ArrowLeft size={22} weight="light" />
      </button>
      <header className="heading rise">
        <h1>Cómo se juega</h1>
        <p className="muted">Se explica en dos minutos. Se domina en una noche.</p>
      </header>

      <section className="paper paper--tilt-l tape rise">
        <p className="hand" style={{ fontSize: 30 }}>
          Entre vosotros hay <strong>Cucos</strong>. Como el pájaro, se cuelan en nidos ajenos. Quieren que la casa se quede con todos.
        </p>
        <Candles velas={3} grietas={1} slots={5} />
        <p className="small">
          Cada prueba superada enciende una <strong>vela</strong>. Cada prueba fallada o saboteada abre una <strong>grieta</strong>. Nadie queda eliminado: todos juegan hasta el final.
        </p>
      </section>

      <section className="stack">
        <h2 className="howto__h">Cada ronda</h2>
        <ol className="howto__steps stagger">
          {STEPS.map((s) => (
            <li key={s.title} className="slab row" style={{ alignItems: 'flex-start', '--gap': '14px' } as React.CSSProperties}>
              <span className="howto__emoji"><GIcon id={s.icon} size={30} /></span>
              <span className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                <strong className="display" style={{ fontSize: 24 }}>{s.title}</strong>
                <span className="muted">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="paper paper--tilt-r">
        <h2 style={{ fontSize: 32 }}><GIcon id="coins" size={26} /> Monedas</h2>
        <p>
          Ganas monedas con pruebas y <strong>misiones secretas</strong>. Las gastas en la Despensa. <strong>Las que te queden al final son tus puntos.</strong>
        </p>
        <p className="muted small" style={{ marginTop: 10 }}>
          ¡PILLADO! Si crees que alguien tiene una misión sobre ti, señálale: si aciertas, +50 y su misión se quema. Si fallas, -20.
        </p>
      </section>

      <section className="stack">
        <h2 className="howto__h">El final</h2>
        <div className="slab">
          <p>
            En la <strong>Gran Acusación</strong> señaláis a los Cucos. Un Cuco queda desenmascarado si más de la mitad de la casa lo señala. Después, La Balanza:
          </p>
          <ul className="howto__balance">
            <li className="chip chip--safe">Huéspedes: velas + 2 por Cuco pillado</li>
            <li className="chip chip--danger">Cucos: grietas + 2 por Cuco escondido</li>
          </ul>
        </div>
      </section>

      <section className="stack">
        <h2 className="howto__h">Los roles</h2>
        <div className="howto__roles stagger">
          {(roles as RoleDef[]).map((r) => (
            <article key={r.id} className={`howto__role howto__role--${r.faction}`}>
              <span className="howto__roleemoji"><RoleIcon roleId={r.id} emoji={r.emoji} size={30} /></span>
              <span className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                <strong>{r.name}</strong>
                <span className="small muted">{FACTION_LABEL[r.faction]} · {r.ability?.name ?? r.passive?.name}</span>
                <span className="small">{r.ability?.text ?? r.passive?.text}</span>
              </span>
            </article>
          ))}
        </div>
      </section>

      <Button block arrow onClick={() => navigate('/unirse')}>
        Entendido, a jugar
      </Button>

      <p className="muted small" style={{ textAlign: 'center' }}>
        Iconos de <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a> (CC-BY 3.0).
      </p>
    </main>
  );
}
