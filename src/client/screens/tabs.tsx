import { SignOut } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { PILLADO_PENALTY, PILLADO_REWARD, SHOP_ITEMS } from '../../shared/constants.ts';
import type { GameView, ShopItemId } from '../../shared/types.ts';
import { PlayerPicker, RoleCard, Sheet } from '../components/cards.tsx';
import { PrivacyGate } from '../components/privacy.tsx';
import { Button, Coins, InlineError } from '../components/ui.tsx';
import { medalCase, medalsEarned } from '../lib/badges.ts';
import { GIcon, MEDAL_ICON, ROLE_ICON, SHOP_ICON } from '../lib/icons.tsx';
import { useAction, useGame, useServerNow } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';
import { usePlayers } from './phases.tsx';

const DIFF_LABEL = { facil: 'Fácil', media: 'Media', dificil: 'Difícil', epica: 'Épica' } as const;

function LightningTimer({ endsAt }: { endsAt: number }) {
  const now = useServerNow(500);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return <p className="note__suspect"><GIcon id="relampago" size={13} /> Relámpago — te quedan {left} s. Después se apaga.</p>;
}
const SOURCE_LABEL = {
  despensa: { icon: 'pista', label: 'Comprada en la Despensa' },
  investigar: { icon: 'curioso', label: 'Tu investigación' },
  receta: { icon: 'abuela', label: 'Receta de la abuela' },
  revelado: { icon: 'fotografa', label: 'Revelado' },
  mirilla: { icon: 'mirilla', label: 'Por la mirilla' },
  nota: { icon: 'nota', label: 'Nota bajo la puerta' },
  chisme: { icon: 'chismoso', label: 'Rumor' },
  espejo: { icon: 'espejo', label: 'El espejo' },
} as const;

function TabHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="heading rise" style={{ gap: 4 }}>
      <h1 style={{ fontSize: 44 }}>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </header>
  );
}

// ---------------------------------------------------------------- misiones

export function MissionsTab() {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const [pillarOpen, setPillarOpen] = useState(false);
  const [target, setTarget] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const { active } = usePlayers();
  const me = view.me!;
  const missions = view.missions ?? [];
  const current = missions.filter((m) => m.status === 'active');
  const past = missions.filter((m) => m.status !== 'active');

  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <TabHeader title="Misiones" sub="Cúmplelas sin que se note. Al final se leerán en voz alta." />
      <PrivacyGate id={`missions:${view.code}`} title="Misiones secretas">
        {current.length === 0 && <p className="muted center">Sin misiones activas. Te llegarán nuevas al empezar la ronda.</p>}
        <div className="stack stagger" style={{ '--gap': '22px' } as React.CSSProperties}>
          {current.map((m) => (
            <article key={m.id} className={m.suspect || m.saboteur ? 'note tape note--suspect' : 'note tape'}>
              {m.suspect && <p className="note__suspect"><GIcon id="mirilla" size={13} /> Orden de la casa — estás bajo sospecha. Todos lo saben.</p>}
              {m.saboteur && <p className="note__suspect"><GIcon id="mentira" size={13} /> Orden oscura — sabotaje. Nadie más la conoce.</p>}
              {m.partner && <p className="note__suspect"><GIcon id="pareja" size={13} /> Misión en pareja — tu cómplice es {m.partner}.</p>}
              {m.custom && <p className="note__suspect"><GIcon id="casa" size={13} /> Misión de la casa — la escribió vuestro anfitrión.</p>}
              {m.expiresAt && <LightningTimer endsAt={m.expiresAt} />}
              <p className="note__text">{m.text}</p>
              <div className="note__meta">
                <span className={`diff diff--${m.difficulty}`}>{DIFF_LABEL[m.difficulty]}</span>
                <span>+{m.reward} <GIcon id="coins" size={12} /></span>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <Button small variant="safe" className="grow" disabled={busy} onClick={() => run({ type: 'claimMission', missionId: m.id })}>
                  ¡Cumplida!
                </Button>
                {!m.suspect &&
                  (confirmDiscard === m.id ? (
                    <Button small variant="danger" disabled={busy} onClick={() => run({ type: 'discardMission', missionId: m.id }).then(() => setConfirmDiscard(null))}>
                      ¿Seguro?
                    </Button>
                  ) : (
                    <Button small variant="ghost" className="note__ghost" onClick={() => setConfirmDiscard(m.id)}>
                      Descartar
                    </Button>
                  ))}
              </div>
            </article>
          ))}
        </div>
        <InlineError error={error} />
      </PrivacyGate>

      <div className="slab stack">
        <strong className="display" style={{ fontSize: 26 }}>¡PILLADO!</strong>
        <p className="muted small">¿Alguien trama algo contra ti? Señálale. Si tiene una misión sobre ti: +{PILLADO_REWARD} y se la quemas. Si no: -{PILLADO_PENALTY}. Una vez por ronda.</p>
        <Button variant="danger" block disabled={!me.pilladoAvailable} onClick={() => setPillarOpen(true)}>
          {me.pilladoAvailable ? '¡Te pillé!' : 'Ya lo has usado esta ronda'}
        </Button>
      </div>

      {past.length > 0 && (
        <details className="past">
          <summary>Historial ({past.length})</summary>
          <div className="stack" style={{ '--gap': '14px', marginTop: 14 } as React.CSSProperties}>
            {past.map((m) => (
              <article key={m.id} className="note note--done">
                <p className="note__text">{m.text}</p>
                <div className="note__meta">
                  <span>{{ completed: 'Cumplida', burned: 'Te pillaron', discarded: 'Descartada', active: '' }[m.status]}</span>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}

      <Sheet open={pillarOpen} onClose={() => setPillarOpen(false)} title="¿A quién pillas?">
        <PlayerPicker players={active.filter((p) => p.id !== me.id)} max={1} selected={target} onChange={setTarget} />
        <Button
          block
          variant="danger"
          disabled={busy || !target.length}
          onClick={async () => {
            if (await run({ type: 'pillar', targetId: target[0] })) {
              setPillarOpen(false);
              setTarget([]);
            }
          }}
        >
          ¡PILLADO!
        </Button>
        <InlineError error={error} />
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------- pistas

export function CluesTab() {
  const { view } = useGame();
  const { run, busy, error } = useAction();
  const me = view.me!;
  const clues = [...(view.clues ?? [])].reverse();
  // El sello del Notario solo sirve sobre notas bajo la puerta, una vez por noche
  const canCertify = me.role?.ability?.id === 'notario' && !!me.ability?.canUse && view.phase === 'INVESTIGATION';
  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <TabHeader title="Pistas" sub="Algunas son ciertas. Otras, no tanto. Tú decides en cuáles confiar." />
      <PrivacyGate id={`clues:${view.code}`} title="Tus pistas">
        {clues.length === 0 && <p className="muted center">Aún no sabes nada. Compra una pista en la Despensa o espera a que alguien te deje una nota.</p>}
        <div className="stack stagger" style={{ '--gap': '20px' } as React.CSSProperties}>
          {clues.map((c) => (
            <article key={c.id} className={`note clue clue--${c.source}`}>
              <span className="clue__source"><GIcon id={SOURCE_LABEL[c.source].icon} size={13} /> {SOURCE_LABEL[c.source].label} · ronda {c.round + 1}</span>
              <p className="note__text">{c.text}</p>
              {c.certified && <p className="note__suspect"><GIcon id="notario" size={13} /> Certificada por el Notario</p>}
              {c.source === 'nota' && !c.certified && canCertify && (
                <Button small variant="ghost" disabled={busy} onClick={() => run({ type: 'certify', clueId: c.id })}>
                  <GIcon id="notario" size={14} /> Certificar con el sello
                </Button>
              )}
            </article>
          ))}
        </div>
        <InlineError error={error} />
      </PrivacyGate>
    </section>
  );
}

// ---------------------------------------------------------------- despensa

export function ShopTab() {
  const { view } = useGame();
  const { run, busy, error, setError } = useAction();
  const { active } = usePlayers();
  const me = view.me!;
  const [item, setItem] = useState<ShopItemId | null>(null);
  const [target, setTarget] = useState<string[]>([]);
  const [amount, setAmount] = useState(20);
  const [flipAmount, setFlipAmount] = useState(20);
  const [message, setMessage] = useState('');
  const def = SHOP_ITEMS.find((i) => i.id === item);

  const buy = async (id: ShopItemId, targetId?: string) => {
    const ok = await run({ type: 'buy', item: id, targetId, amount: id === 'sobre' ? amount : undefined, text: id === 'altavoz' || id === 'nota' ? message : undefined });
    if (ok) {
      setItem(null);
      setTarget([]);
      setMessage('');
    }
  };

  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <TabHeader title="La Despensa" sub={view.shopOpen ? 'Abierta durante la investigación.' : 'Cerrada. Abre durante la investigación.'} />
      <div className="slab row spread">
        <span className="muted">Tienes</span>
        <Coins n={me.coins} big />
      </div>
      {view.market.length > 0 && (
        <div className="slab market">
          <span className="display market__title"><GIcon id="gafas" size={16} /> Mercado negro · esta ronda</span>
          {view.market.map((id) => {
            const i = SHOP_ITEMS.find((x) => x.id === id)!;
            return (
              <span key={id} className="chip chip--warn">
                <GIcon id={SHOP_ICON[id]} size={14} /> {i.name} · {view.shopPrices[id]} <GIcon id="coins" size={12} />
              </span>
            );
          })}
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {me.inventory.candado > 0 && <span className="chip chip--safe"><GIcon id="candado" size={14} /> Candado ×{me.inventory.candado}</span>}
        {me.inventory.voto_doble > 0 && <span className="chip chip--warn"><GIcon id="voto-doble" size={14} /> Voto doble</span>}
        {me.inventory.coartada > 0 && <span className="chip chip--safe"><GIcon id="coartada" size={14} /> Coartada</span>}
      </div>
      <div className="shop stagger">
        {SHOP_ITEMS.map((i) => {
          const price = view.shopPrices[i.id];
          // No se deshabilita: un botón muerto no dice por qué no responde
          const closed = !view.shopOpen;
          const poor = i.id !== 'sobre' && me.coins < price;
          const dimmed = closed || poor;
          return (
            <button
              type="button"
              key={i.id}
              className={`shop__item ${dimmed ? 'is-dimmed' : ''}`}
              aria-disabled={dimmed}
              disabled={busy}
              onClick={() => {
                if (closed) return setError('La despensa abre durante la investigación. Aguanta.');
                if (poor) return setError(`Te faltan ${price - me.coins} 🪙 para ${i.name}.`);
                if (i.target || i.textInput) setItem(i.id);
                else void buy(i.id);
              }}
            >
              <span className="shop__emoji"><GIcon id={SHOP_ICON[i.id]} size={34} /></span>
              <span className="display shop__name">{i.name}</span>
              <span className="shop__text">{i.text}</span>
              <span className="shop__price">{i.id === 'sobre' ? 'Tú eliges' : <>{price} <GIcon id="coins" size={13} /></>}</span>
            </button>
          );
        })}
      </div>
      {/* Doble o nada: la moneda salta a la tele delante de todos */}
      <div className="slab stack center" style={{ '--gap': '10px' } as React.CSSProperties}>
        <span className="display" style={{ fontSize: 22 }}><GIcon id="coinflip" size={22} /> Doble o nada</span>
        <p className="muted small" style={{ margin: 0 }}>
          Cara te llevas el doble, cruz lo pierdes todo. Una jugada por ronda — la moneda se ve en la tele.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {[20, 40, 80].map((n) => (
            <Button key={n} small variant={flipAmount === n ? 'danger' : 'ghost'} disabled={me.coins < n} onClick={() => setFlipAmount(n)}>
              {n}
            </Button>
          ))}
          <Button small variant={flipAmount === me.coins ? 'danger' : 'ghost'} disabled={me.coins < 10} onClick={() => setFlipAmount(me.coins)}>
            Todo
          </Button>
        </div>
        <Button
          variant="danger"
          arrow
          disabled={busy || !view.shopOpen || me.coins < Math.max(10, flipAmount)}
          onClick={() => run({ type: 'coinflip', amount: Math.min(flipAmount, me.coins) })}
        >
          Tirar la moneda · {Math.min(flipAmount, me.coins)} <GIcon id="coins" size={14} />
        </Button>
      </div>
      <InlineError error={error} />

      <Sheet open={!!item} onClose={() => setItem(null)} title={def ? def.name : ''} icon={def ? SHOP_ICON[def.id] : undefined}>
        <p className="muted">{def?.text}</p>
        {def?.target && <PlayerPicker players={active.filter((p) => p.id !== me.id)} max={1} selected={target} onChange={setTarget} />}
        {item === 'altavoz' && (
          <div className="field">
            <label htmlFor="altavoz-text">Mensaje que gritará la casa</label>
            <input id="altavoz-text" className="input" maxLength={120} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="«Yo vi a Marcos junto a la despensa»" />
          </div>
        )}
        {item === 'nota' && (
          <div className="field">
            <label htmlFor="nota-text">La nota que encontrará bajo su puerta</label>
            <input id="nota-text" className="input" maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="«Sé que Pablo miente. Cocina, cinco minutos»" />
            <p className="muted small">Anónima e indistinguible de las del Falsificador. Que tiemble.</p>
          </div>
        )}
        {item === 'sobre' && (
          <div className="field">
            <label htmlFor="sobre-amount">Monedas en el sobre</label>
            <input id="sobre-amount" className="input" type="number" min={1} max={me.coins} value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(me.coins, Number(e.target.value) || 1)))} />
          </div>
        )}
        <Button
          block
          arrow
          disabled={busy || (!!def?.target && !target.length) || ((item === 'altavoz' || item === 'nota') && !message.trim())}
          onClick={() => item && buy(item, target[0])}
        >
          {item === 'sobre' ? 'Entregar' : 'Comprar'} · {item === 'sobre' ? amount : item ? view.shopPrices[item] : 0} <GIcon id="coins" size={14} />
        </Button>
        <InlineError error={error} />
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------- habilidad

export function AbilityPanel() {
  const { view } = useGame();
  const me = view.me!;
  const ability = me.role?.ability;
  const { run, busy, error } = useAction();
  const { active } = usePlayers();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  if (!ability || !me.ability) return null;

  const use = async () => {
    if (await run({ type: 'ability', targets: picks })) {
      setOpen(false);
      setPicks([]);
    }
  };
  // Falsificador: el primero recibe la nota, el segundo es a quien señala
  const pool = ability.id === 'falsificar' && picks.length === 1 ? active.filter((p) => p.id !== picks[0]) : active.filter((p) => p.id !== me.id || ability.id === 'falsificar');
  const step = Math.min(picks.length, ability.targets - 1);

  return (
    <div className="ability slab stack">
      <div className="row spread">
        <strong className="display" style={{ fontSize: 26 }}>
          <GIcon id={ROLE_ICON[me.role!.id] ?? 'cuco_base'} size={18} /> {ability.name}
        </strong>
        {me.ability.usesLeft !== null && <span className="chip">{me.ability.usesLeft} {me.ability.usesLeft === 1 ? 'uso' : 'usos'}</span>}
      </div>
      <p className="muted small">{ability.text}</p>
      {ability.id === 'notario' ? (
        <p className="small muted center">{me.ability.canUse ? 'Ve a Pistas y pulsa «Certificar» en una nota bajo la puerta.' : me.ability.reason}</p>
      ) : (
        <Button block variant={me.role!.faction === 'cuco' ? 'danger' : 'safe'} disabled={!me.ability.canUse || busy} onClick={() => (ability.targets ? setOpen(true) : run({ type: 'ability', targets: [] }))}>
          {me.ability.canUse ? 'Usar' : me.ability.reason}
        </Button>
      )}
      <InlineError error={open ? null : error} />
      <Sheet open={open} onClose={() => { setOpen(false); setPicks([]); }} title={ability.name}>
        <p className="display" style={{ fontSize: 22 }}>{ability.targetLabels?.[step] ?? 'Elige'}</p>
        {ability.id === 'falsificar' ? (
          <PlayerPicker
            players={picks.length === 0 ? active.filter((p) => p.id !== me.id) : pool}
            max={1}
            selected={picks.length === 2 ? [picks[1]] : []}
            onChange={(ids) => setPicks((cur) => (cur.length === 0 ? ids : [cur[0], ...ids]))}
          />
        ) : (
          <PlayerPicker players={active.filter((p) => p.id !== me.id)} max={ability.targets} selected={picks} onChange={setPicks} />
        )}
        {ability.id === 'falsificar' && picks.length > 0 && (
          <Button small variant="ghost" onClick={() => setPicks([])}>
            Cambiar destinatario
          </Button>
        )}
        <Button block arrow disabled={busy || picks.length !== ability.targets} onClick={use}>
          Confirmar
        </Button>
        <InlineError error={error} />
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- cuaderno

export function NotesTab() {
  const { view, send } = useGame();
  const me = view.me!;
  const [text, setText] = useState(me.notes);
  const [savedAt, setSavedAt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El servidor es quien guarda: si llega una vista con notas más nuevas (relevo de móvil), se respetan
  useEffect(() => {
    if (me.notes !== text && document.activeElement?.tagName !== 'TEXTAREA') setText(me.notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.notes]);

  const save = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ack = await send({ type: 'note', text: value });
      if (ack.ok) setSavedAt(Date.now());
    }, 600);
  };

  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <TabHeader title="Tu cuaderno" sub="Apuntes de detective. Solo los ves tú — y sobreviven al relevo de móvil." />
      <PrivacyGate id={`notes:${view.code}`} title="Tu cuaderno" compact>
        <div className="note">
          <textarea
            className="notes__pad"
            rows={10}
            maxLength={500}
            placeholder="Marcos mintió en la ronda 2. Laura tiene demasiadas monedas. ¿Quién apagó la vela?"
            value={text}
            onChange={(e) => save(e.target.value)}
          />
        </div>
        <p className="small muted center">{savedAt ? 'Guardado ✓' : `${text.length}/500`}</p>
      </PrivacyGate>
    </section>
  );
}

// ---------------------------------------------------------------- medallero

function MedalCase({ view }: { view: GameView }) {
  const tonight = view.phase === 'FINALE' ? medalsEarned(view) : [];
  const cabinet = medalCase();
  if (!tonight.length && !cabinet.length) return null;
  return (
    <div className="slab stack">
      <strong className="display" style={{ fontSize: 24 }}><GIcon id="medalla" size={20} /> Tu medallero</strong>
      {tonight.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {tonight.map((m) => (
            <span key={m.id} className="chip chip--safe" title={m.desc}>
              <GIcon id={MEDAL_ICON[m.id] ?? 'medalla'} size={14} /> {m.name} · esta noche
            </span>
          ))}
        </div>
      )}
      {cabinet.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {cabinet.map(({ medal, count }) => (
            <span key={medal.id} className="chip" title={medal.desc}>
              <GIcon id={MEDAL_ICON[medal.id] ?? 'medalla'} size={14} /> {medal.name}{count > 1 ? ` ×${count}` : ''}
            </span>
          ))}
        </div>
      )}
      <p className="muted small">Las medallas viven en este móvil y se acumulan entre noches.</p>
    </div>
  );
}

// ---------------------------------------------------------------- yo

export function MeTab() {
  const { view } = useGame();
  const me = view.me!;
  const [flipped, setFlipped] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { run, busy } = useAction();

  return (
    <section className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <TabHeader title={me.name} />
      {me.role && (
        <PrivacyGate id={`me:${view.code}`} title="Tu identidad">
          <RoleCard role={me.role} flipped={flipped} onFlip={() => setFlipped(!flipped)} teammates={me.teammates} players={view.players} />
          {me.role.faction === 'cuco' && <p className="chip chip--danger" style={{ alignSelf: 'center' }}><GIcon id="cerilla" size={14} /> Cerillas: {me.cerillas}</p>}
        </PrivacyGate>
      )}
      {view.phase === 'INVESTIGATION' && <AbilityPanel />}
      <MedalCase view={view} />
      {!view.hostOnline && !me.isHost && view.phase !== 'LOBBY' && (
        <div className="slab stack">
          <strong>El director no está</strong>
          <p className="muted small">Si lleva más de un minuto desconectado, puedes tomar el mando para que la partida siga.</p>
          <Button small variant="ghost" onClick={() => run({ type: 'claimHost' })} disabled={busy}>
            <GIcon id="corona" size={16} /> Tomar el mando
          </Button>
        </div>
      )}
      {confirmLeave ? (
        <div className="slab stack">
          <p>¿Seguro que te vas a dormir? Podrás volver desde este móvil.</p>
          <div className="row">
            <Button small variant="danger" className="grow" onClick={async () => { await run({ type: 'leave' }); navigate('/', true); }}>
              Salir
            </Button>
            <Button small variant="ghost" className="grow" onClick={() => setConfirmLeave(false)}>
              Me quedo
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" small onClick={() => setConfirmLeave(true)} style={{ alignSelf: 'center' }}>
          <SignOut size={18} weight="light" /> Abandonar la partida
        </Button>
      )}
    </section>
  );
}
