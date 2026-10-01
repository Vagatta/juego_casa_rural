import { ShieldProvider } from './components/privacy.tsx';
import { match, usePath } from './lib/router.ts';
import { CreateScreen } from './screens/Create.tsx';
import { DevScreen } from './screens/Dev.tsx';
import { DirectorScreen } from './screens/Director.tsx';
import { HomeScreen } from './screens/Home.tsx';
import { HowToScreen } from './screens/HowTo.tsx';
import { JoinScreen } from './screens/Join.tsx';
import { PlayerScreen } from './screens/Player.tsx';
import { WatchScreen } from './screens/Watch.tsx';

export function App() {
  const path = usePath();
  let screen = <HomeScreen />;
  let params: Record<string, string> | null;
  if (path === '/crear') screen = <CreateScreen />;
  else if (path === '/dev') screen = <DevScreen />;
  else if (path === '/como-se-juega') screen = <HowToScreen />;
  else if (path === '/unirse') screen = <JoinScreen />;
  else if ((params = match('/unirse/:code', path))) screen = <JoinScreen initialCode={params.code} />;
  else if ((params = match('/partida/:code', path))) screen = <PlayerScreen key={params.code} code={params.code.toUpperCase()} />;
  else if ((params = match('/director/:code', path))) screen = <DirectorScreen key={params.code} code={params.code.toUpperCase()} />;
  else if ((params = match('/ver/:code', path))) screen = <WatchScreen key={params.code} code={params.code.toUpperCase()} />;
  return <ShieldProvider>{screen}</ShieldProvider>;
}
