import { ArrowRight, CheckCircle, WifiSlash } from '@phosphor-icons/react';
import { AVATAR_ICON, GIcon } from '../lib/icons.tsx';
import { type ReactNode, useEffect, useRef } from 'react';
import type { PublicPlayer } from '../../shared/types.ts';
import { useServerNow } from '../lib/net.ts';
import { play } from '../lib/sound.ts';

// ---------------------------------------------------------------- botón

export function Button({
  children,
  variant,
  block,
  small,
  arrow,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'danger' | 'safe' | 'ghost'; block?: boolean; small?: boolean; arrow?: boolean }) {
  const cls = ['btn', variant && `btn--${variant}`, block && 'btn--block', small && 'btn--small', rest.className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls}>
      {children}
      {arrow && (
        <span className="btn__icon" aria-hidden>
          <ArrowRight size={18} weight="bold" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- jugador

export function Token({
  player,
  size = 56,
  label = true,
  selected,
  onClick,
  dim,
  badge,
}: {
  player: Pick<PublicPlayer, 'name' | 'avatar' | 'color'> & Partial<PublicPlayer>;
  size?: number;
  label?: boolean;
  selected?: boolean;
  onClick?: () => void;
  dim?: boolean;
  badge?: ReactNode;
}) {
  const offline = player.connected === false && !player.left;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`token ${selected ? 'is-selected' : ''} ${dim || player.left ? 'is-dim' : ''} ${player.suspect ? 'is-suspect' : ''}`}
      onClick={onClick}
      style={{ '--pc': player.color, '--size': `${size}px` } as React.CSSProperties}
      {...(onClick ? { type: 'button', 'aria-pressed': !!selected } : {})}
    >
      <span className="token__disc" aria-hidden>
        {AVATAR_ICON[player.avatar] ? (
          <span className="token__emoji"><GIcon id={AVATAR_ICON[player.avatar]} size={Math.round(size * 0.52)} /></span>
        ) : (
          <span className="token__emoji">{player.avatar}</span>
        )}
        {offline && (
          <span className="token__flag token__flag--off">
            <WifiSlash size={12} weight="bold" />
          </span>
        )}
        {player.acted && (
          <span className="token__flag token__flag--ok">
            <CheckCircle size={14} weight="fill" />
          </span>
        )}
        {badge && <span className="token__badge">{badge}</span>}
      </span>
      {label && <span className="token__name">{player.name}</span>}
    </Tag>
  );
}

// ---------------------------------------------------------------- velas

export function Candles({ velas, grietas, slots, compact }: { velas: number; grietas: number; slots: number; compact?: boolean }) {
  const total = Math.max(slots, velas + grietas);
  return (
    <div className={`candles ${compact ? 'candles--compact' : ''}`} role="img" aria-label={`${velas} velas encendidas, ${grietas} grietas`}>
      {Array.from({ length: total }, (_, i) => {
        const state = i < velas ? 'lit' : i < velas + grietas ? 'cracked' : 'idle';
        return (
          <span key={i} className={`candle candle--${state}`} style={{ '--i': i } as React.CSSProperties}>
            <span className="candle__flame" />
            <span className="candle__wick" />
            <span className="candle__body" />
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- temporizador

export function useCountdown(endsAt: number | null, pausedMs: number | null = null): number | null {
  const now = useServerNow(250);
  if (pausedMs !== null) return Math.ceil(pausedMs / 1000);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Timer({ endsAt, pausedMs = null, big, label }: { endsAt: number | null; pausedMs?: number | null; big?: boolean; label?: string }) {
  const left = useCountdown(endsAt, pausedMs);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (left !== null && left !== last.current && left <= 5 && left > 0 && pausedMs === null) play('tick');
    last.current = left;
  }, [left, pausedMs]);
  if (left === null) return null;
  const urgent = left <= 10 && pausedMs === null;
  return (
    <div className={`timer ${big ? 'timer--big' : ''} ${urgent ? 'is-urgent' : ''}`} role="timer" aria-live="off">
      {label && <span className="timer__label">{pausedMs !== null ? 'En pausa' : label}</span>}
      <span className="timer__digits">{mmss(left)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- misc

export function Coins({ n, big }: { n: number; big?: boolean }) {
  return (
    <span className={`coins ${big ? 'coins--big' : ''}`}>
      <span className="coins__disc" aria-hidden>
        <GIcon id="coins" size={big ? 20 : 14} />
      </span>
      <span className="coins__n">{n}</span>
      <span className="sr-only">monedas</span>
    </span>
  );
}

export function Stamp({ children, tone = 'danger', rotate = -8 }: { children: ReactNode; tone?: 'danger' | 'safe' | 'warn' | 'special'; rotate?: number }) {
  return (
    <span className={`stamp stamp--${tone}`} style={{ '--rot': `${rotate}deg` } as React.CSSProperties}>
      {children}
    </span>
  );
}

export function Heading({ kicker, title, sub }: { kicker?: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="heading rise">
      {kicker && <span className="eyebrow">{kicker}</span>}
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </header>
  );
}

export function InlineError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error-text" role="alert">
      {error}
    </p>
  );
}
