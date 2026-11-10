import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import { createRoot } from 'react-dom/client'
import { startEngine } from '../engine'
import { App } from './App'
import './styles/theme.css'

// The engine sets up window.nnf, which the interface talks to, before the interface starts.
void startEngine().finally(() => createRoot(document.getElementById('root')!).render(<App />))
