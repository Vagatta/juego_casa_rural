import '@fontsource/big-shoulders-stencil-display/700';
import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource-variable/figtree';
import '@fontsource/caveat/500';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { resumeOnGesture } from './lib/sound.ts';

resumeOnGesture();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
