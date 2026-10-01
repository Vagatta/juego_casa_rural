import { BookOpen, DoorOpen, House } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui.tsx';
import { medalCase } from '../lib/badges.ts';
import { GIcon, MEDAL_ICON } from '../lib/icons.tsx';
import { api } from '../lib/net.ts';
import { navigate } from '../lib/router.ts';
import { lastSession, type Session } from '../lib/session.ts';

export function HomeScreen() {
  const [resume, setResume] = useState<Session | null>(null);

  useEffect(() => {
    const s = lastSession();
    if (!s || Date.now() - s.savedAt > 12 * 3600_000) return;
    api.info(s.code).then((info) => info.phase !== 'FINALE' && setResume(s)).catch(() => {});
  }, []);

  return (
    <main className="page home">
      <div className="home__lamp" aria-hidden />
      <section className="home__hero">
        <div className="home__sign deal">
          <span className="home__house" aria-hidden>
            <GIcon id="casa" size={72} />
          </span>
          <h1 className="home__title">
            La Casa
            <br />
            Rural
          </h1>
        </div>
        <p className="home__tagline hand rise" style={{ animationDelay: '180ms' }}>
          Una casa. Nueve amigos. Demasiados secretos.
        </p>
      </section>

      <nav className="home__actions stagger" aria-label="Menú principal">
        {resume && (
          <Button variant="safe" block arrow onClick={() => navigate(resume.playerToken ? `/partida/${resume.code}` : `/director/${resume.code}`)}>
            Volver a {resume.code}
          </Button>
        )}
        <Button block arrow onClick={() => navigate('/crear')}>
          <House size={24} weight="light" /> Crear partida
        </Button>
        <Button block variant="danger" arrow onClick={() => navigate('/unirse')}>
          <DoorOpen size={24} weight="light" /> Unirse a partida
        </Button>
        <Button block variant="ghost" onClick={() => navigate('/como-se-juega')}>
          <BookOpen size={24} weight="light" /> Cómo se juega
        </Button>
      </nav>

      <MedalShelf />
      <p className="home__foot muted small">6 a 12 jugadores · 60 a 120 minutos · un móvil por persona</p>
    </main>
  );
}

/** El medallero del dispositivo: solo aparece si esta casa ya te ha dado algo. */
function MedalShelf() {
  const cabinet = medalCase();
  if (!cabinet.length) return null;
  return (
    <div className="home__medals">
      {cabinet.map(({ medal, count }) => (
        <span key={medal.id} className="chip" title={medal.desc}>
          <GIcon id={MEDAL_ICON[medal.id] ?? 'medalla'} size={14} /> {medal.name}
          {count > 1 ? ` ×${count}` : ''}
        </span>
      ))}
    </div>
  );
}
