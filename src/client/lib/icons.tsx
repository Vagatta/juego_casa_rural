// Iconos del juego: SVGs de game-icons.net (CC-BY 3.0) en src/client/assets/icons/.
// Se sirven con ?raw, se les quita el fondo negro que trae el pack y se tiñen con
// currentColor para que hereden el color del texto/botón que los rodea.
import type { ChallengeCategory, ShopItemId } from '../../shared/types.ts';

const files = import.meta.glob<string>('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });

const GLYPHS: Record<string, string> = {};
for (const [path, raw] of Object.entries(files)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '');
  GLYPHS[name] = raw
    .replace(/<path d="M0 0h512v512H0z"\s*\/>/, '') // fondo negro del pack
    .replace(/fill="#fff"/g, 'fill="currentColor"');
}

export function GIcon({ id, size = 20, className = '' }: { id: string; size?: number; className?: string }) {
  const svg = GLYPHS[id];
  if (!svg) return null;
  return <span className={`gicon ${className}`} style={{ fontSize: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-hidden />;
}

// ---------------------------------------------------------------- mapas

/** Avatares: el emoji sigue siendo lo que viaja por el protocolo (snapshots
 *  antiguos incluidos); aquí solo cambia cómo se dibuja. */
export const AVATAR_ICON: Record<string, string> = {
  '🐓': 'av-gallo',
  '🦉': 'av-buho',
  '🐐': 'av-cabra',
  '🍄': 'av-seta',
  '🕯️': 'vela',
  '🗝️': 'av-llave',
  '🍷': 'av-vino',
  '🧀': 'av-queso',
  '🪓': 'av-hacha',
  '🦊': 'av-zorro',
  '🐗': 'av-jabali',
  '🌰': 'av-bellota',
};

export const SHOP_ICON: Record<ShopItemId, string> = {
  pista: 'pista',
  candado: 'candado',
  voto_doble: 'voto-doble',
  ganzua: 'ganzua',
  mirilla: 'mirilla',
  sobre: 'sobre',
  coartada: 'coartada',
  altavoz: 'altavoz',
  espejo: 'espejo',
  nota: 'nota',
};

export const CATEGORY_ICON: Record<ChallengeCategory, string> = {
  mental: 'mental',
  social: 'social',
  fisica: 'fisica',
  movil: 'movil',
  mentira: 'mentira',
};

export const ROLE_ICON: Record<string, string> = {
  curioso: 'curioso',
  abuela: 'abuela',
  manitas: 'manitas',
  fotografa: 'fotografa',
  chismoso: 'chismoso',
  vecino: 'vecino',
  contable: 'contable',
  buscavidas: 'buscavidas',
  insomne: 'insomne',
  notario: 'notario',
  cuco_falsificador: 'cuco_falsificador',
  cuco_carterista: 'cuco_carterista',
  cuco_doble: 'cuco_doble',
  turista: 'turista',
};

/** El emoji que el rol trae en el contenido → icono del set (fallback: cuco para
 *  la facción, avatar genérico si no). */
export function RoleIcon({ roleId, emoji, size = 48 }: { roleId: string; emoji: string; size?: number }) {
  return <GIcon id={ROLE_ICON[roleId] ?? 'cuco_base'} size={size} />;
}

/** Medallas del medallero local (badges.ts), por id — no por emoji. */
export const MEDAL_ICON: Record<string, string> = {
  podio: 'podio-ganador',
  premio: 'medalla',
  ganador: 'trofeo',
  oculto: 'espia',
  turista: 'turista',
  casino: 'dados',
  vidente: 'prediccion',
  buscavidas: 'buscavidas',
  pobre: 'patata',
  veterano: 'vela',
};

/** Premios de la ceremonia final (finale.ts `give(...)`), por id. */
export const AWARD_ICON: Record<string, string> = {
  detective: 'curioso',
  traidor: 'cuco_base',
  sospechoso: 'espia',
  mentiroso: 'mentira',
  misionero: 'nota',
  manos: 'cuco_carterista',
  campeon: 'trofeo',
  ludopata: 'dados',
};
