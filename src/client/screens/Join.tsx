import { ArrowLeft } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { AVATARS, CODE_LENGTH } from '../../shared/constants.ts';
import { Button, InlineError } from '../components/ui.tsx';
import { api } from '../lib/net.ts';
import { AVATAR_ICON, GIcon } from '../lib/icons.tsx';
import { navigate } from '../lib/router.ts';
import { getSession, saveSession } from '../lib/session.ts';

export function AvatarGrid({ value, onChange, taken = [] }: { value: string; onChange: (a: string) => void; taken?: string[] }) {
  return (
    <div className="avatars" role="radiogroup" aria-label="Avatar">
      {AVATARS.map((a) => (
        <button type="button" key={a} role="radio" aria-checked={value === a} className={`avatar ${value === a ? 'is-on' : ''}`} onClick={() => onChange(a)} disabled={taken.includes(a) && value !== a}>
          {AVATAR_ICON[a] ? <GIcon id={AVATAR_ICON[a]} size={30} /> : a}
        </button>
      ))}
    </div>
  );
}

export function JoinScreen({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [step, setStep] = useState<'code' | 'profile' | 'relevo'>('code');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [taken, setTaken] = useState<string[]>([]);
  const [absent, setAbsent] = useState<{ id: string; name: string; avatar: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkCode = async (c = code) => {
    if (c.length !== CODE_LENGTH) return setError(`El código tiene ${CODE_LENGTH} caracteres`);
    setBusy(true);
    setError(null);
    try {
      // Si este móvil ya estaba dentro, volvemos directamente
      if (getSession(c)?.playerToken) return navigate(`/partida/${c}`, true);
      const info = await api.info(c);
      // Esa casa ya cerró, pero la noche sigue en otra: seguir el rastro
      if (info.rematchTo) {
        setCode(info.rematchTo);
        return checkCode(info.rematchTo);
      }
      if (!info.joinable) {
        if (info.absentPlayers?.length) {
          setAbsent(info.absentPlayers);
          setStep('relevo');
          return;
        }
        throw new Error(info.phase === 'LOBBY' ? 'La casa está llena' : 'La partida ya ha empezado');
      }
      setTaken(info.takenAvatars);
      if (info.takenAvatars.includes(avatar)) setAvatar(AVATARS.find((a) => !info.takenAvatars.includes(a)) ?? avatar);
      setStep('profile');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialCode.length === CODE_LENGTH) void checkCode(initialCode.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe tu nombre');
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(code, { name: name.trim(), avatar });
      saveSession(res.code, { playerToken: res.playerToken });
      navigate(`/partida/${res.code}`, true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const takeOver = async (playerId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(code, { takeId: playerId });
      saveSession(res.code, { playerToken: res.playerToken });
      navigate(`/partida/${res.code}`, true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <button type="button" className="icon-btn" onClick={() => (step === 'code' ? navigate('/') : setStep('code'))} aria-label="Volver">
        <ArrowLeft size={22} weight="light" />
      </button>

      {step === 'relevo' ? (
        <div className="stack stagger" style={{ '--gap': '22px' } as React.CSSProperties}>
          <header className="heading">
            <span className="eyebrow">Casa {code}</span>
            <h1>Tomar el relevo</h1>
            <p className="muted">La noche ya va en marcha. Si el móvil de alguien ha muerto, otro puede continuar con su identidad, sus monedas y sus secretos.</p>
          </header>
          <div className="stack">
            {absent.map((p) => (
              <button key={p.id} type="button" className="mode" disabled={busy} onClick={() => takeOver(p.id)}>
                <span className="mode__emoji">{AVATAR_ICON[p.avatar] ? <GIcon id={AVATAR_ICON[p.avatar]} size={28} /> : p.avatar}</span>
                <span className="display mode__title">{p.name}</span>
                <span className="mode__text">Continuar como {p.name}</span>
              </button>
            ))}
          </div>
          <InlineError error={error} />
        </div>
      ) : step === 'code' ? (
        <form
          className="stack stagger"
          style={{ '--gap': '22px' } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void checkCode();
          }}
        >
          <header className="heading">
            <h1>Llamar a la puerta</h1>
            <p className="muted">Pide el código a quien ha abierto la casa.</p>
          </header>
          <div className="field">
            <label htmlFor="code">Código de partida</label>
            <input
              id="code"
              className="input input--code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="X7K92"
              autoFocus
            />
          </div>
          <InlineError error={error} />
          <Button type="submit" block variant="danger" arrow disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? 'Llamando...' : 'Entrar'}
          </Button>
          {code.length === CODE_LENGTH && (
            <Button variant="ghost" block onClick={() => navigate(`/ver/${code}`, true)}>
              <GIcon id="mirilla" size={16} /> Solo quiero mirar la partida
            </Button>
          )}
        </form>
      ) : (
        <form className="stack stagger" style={{ '--gap': '22px' } as React.CSSProperties} onSubmit={join}>
          <header className="heading">
            <span className="eyebrow">Casa {code}</span>
            <h1>¿Quién eres?</h1>
          </header>
          <div className="field">
            <label htmlFor="name">Tu nombre</label>
            <input id="name" className="input" maxLength={16} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como te llaman en la casa" autoFocus />
          </div>
          <div className="field">
            <span className="label">Tu avatar</span>
            <AvatarGrid value={avatar} onChange={setAvatar} taken={taken} />
          </div>
          <InlineError error={error} />
          <Button type="submit" block arrow disabled={busy}>
            {busy ? 'Entrando...' : 'Entrar en la casa'}
          </Button>
        </form>
      )}
    </main>
  );
}
