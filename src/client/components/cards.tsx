import { X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import type { PublicPlayer, RoleDef } from '../../shared/types.ts';
import type { ToastItem } from '../lib/net.ts';
import { GIcon, RoleIcon } from '../lib/icons.tsx';
import { Token } from './ui.tsx';

export const FACTION_LABEL = { huesped: 'Huésped', cuco: 'Cuco', turista: 'Neutral' } as const;

// ---------------------------------------------------------------- carta de rol

export function RoleCard({ role, flipped, onFlip, teammates = [], players = [] }: { role: RoleDef; flipped: boolean; onFlip?: () => void; teammates?: string[]; players?: PublicPlayer[] }) {
  const mates = players.filter((p) => teammates.includes(p.id));
  return (
    <div className={`rolecard ${flipped ? 'is-flipped' : ''} rolecard--${role.faction}`}>
      <button type="button" className="rolecard__inner" onClick={onFlip} aria-label={flipped ? 'Tu identidad' : 'Girar la carta'} disabled={!onFlip}>
        <span className="rolecard__face rolecard__back" aria-hidden={flipped}>
          <span className="rolecard__backframe">
            <span className="rolecard__house"><GIcon id="casa" size={44} /></span>
            <span className="display rolecard__backtitle">La Casa Rural</span>
            <span className="muted small">Toca para girar</span>
          </span>
        </span>
        <span className="rolecard__face rolecard__front" aria-hidden={!flipped}>
          <span className="rolecard__band">{FACTION_LABEL[role.faction]}</span>
          <span className="rolecard__emoji"><RoleIcon roleId={role.id} emoji={role.emoji} size={52} /></span>
          <span className="display rolecard__name">{role.name}</span>
          <span className="rolecard__summary hand">{role.summary}</span>
          <span className="rolecard__objective">{role.objective}</span>
          {role.ability && (
            <span className="rolecard__ability">
              <strong>{role.ability.name}.</strong> {role.ability.text}
            </span>
          )}
          {role.passive && (
            <span className="rolecard__ability">
              <strong>{role.passive.name}.</strong> {role.passive.text}
            </span>
          )}
          {mates.length > 0 && (
            <span className="rolecard__mates">
              <span className="small">{mates.length === 1 ? 'Tu compañero Cuco' : 'Tus compañeros Cuco'}</span>
              <span className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {mates.map((m) => (
                  <Token key={m.id} player={m} size={40} />
                ))}
              </span>
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- selector de jugadores

export function PlayerPicker({
  players,
  max,
  selected,
  onChange,
  disabled,
}: {
  players: PublicPlayer[];
  max: number;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: string) => {
    if (disabled) return;
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (max === 1) onChange([id]);
    else if (selected.length < max) onChange([...selected, id]);
  };
  return (
    <div className="picker stagger">
      {players.map((p) => (
        <Token key={p.id} player={{ ...p, acted: false }} size={62} selected={selected.includes(p.id)} onClick={() => toggle(p.id)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- avisos

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <button type="button" key={t.id} className={`toast toast--${t.tone}`} onClick={() => onDismiss(t.id)}>
          {t.private && <GIcon id="candado" size={14} />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- hoja inferior

export function Sheet({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: string; icon?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 260);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!mounted) return null;
  return (
    <div className={`sheet ${open ? 'is-open' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet__backdrop" onClick={onClose} aria-label="Cerrar" />
      <div className="sheet__panel">
        <div className="row spread sheet__head">
          <h2>{icon && <GIcon id={icon} size={20} />} {title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={22} weight="light" />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
