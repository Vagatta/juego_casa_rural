import { Eye, EyeSlash, LockKey } from '@phosphor-icons/react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { play } from '../lib/sound.ts';
import { Button } from './ui.tsx';

// ------------------------------------------------------------------ escudo global
// Un toque en "Ocultar" tapa la pantalla entera al instante. Para cuando alguien se asoma.

const ShieldCtx = createContext<{ hidden: boolean; hide: () => void; show: () => void }>({ hidden: false, hide: () => {}, show: () => {} });

export function ShieldProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const hide = useCallback(() => setHidden(true), []);
  const show = useCallback(() => setHidden(false), []);
  useEffect(() => {
    // Si el móvil se bloquea o cambia de app, al volver la pantalla está tapada
    const onHide = () => document.visibilityState === 'hidden' && setHidden(true);
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  return (
    <ShieldCtx.Provider value={{ hidden, hide, show }}>
      {children}
      {hidden && (
        <button type="button" className="shield" onClick={show} aria-label="Mostrar la pantalla">
          <span className="seal">
            <LockKey size={30} weight="light" />
          </span>
          <span className="display shield__title">Pantalla oculta</span>
          <span className="muted">Toca cuando nadie mire</span>
        </button>
      )}
    </ShieldCtx.Provider>
  );
}

export const useShield = () => useContext(ShieldCtx);

export function HideButton() {
  const { hide } = useShield();
  return (
    <button type="button" className="icon-btn" onClick={hide} aria-label="Ocultar información">
      <EyeSlash size={22} weight="light" />
    </button>
  );
}

// ------------------------------------------------------------------ puerta de privacidad
// Todo lo secreto pasa antes por aquí: aviso explícito + revelado voluntario + botón de ocultar.

const revealedKeys = new Set<string>();

export function PrivacyGate({ id, title = 'Información privada', children, compact }: { id: string; title?: string; children: ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState(() => revealedKeys.has(id));
  const reveal = () => {
    revealedKeys.add(id);
    play('reveal');
    setOpen(true);
  };
  const conceal = () => {
    revealedKeys.delete(id);
    setOpen(false);
  };

  if (!open) {
    return (
      <div className={`gate ${compact ? 'gate--compact' : ''} rise`}>
        <span className="seal" aria-hidden>
          <LockKey size={30} weight="light" />
        </span>
        <div className="stack center" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h2 className="gate__title">{title}</h2>
          <p className="muted">Asegúrate de que nadie está mirando.</p>
        </div>
        <Button onClick={reveal} arrow>
          <Eye size={22} weight="light" /> Ver
        </Button>
      </div>
    );
  }
  return (
    <div className="gate-open">
      {children}
      <Button variant="ghost" small onClick={conceal} className="gate-open__hide">
        <EyeSlash size={18} weight="light" /> Ocultar información
      </Button>
    </div>
  );
}
