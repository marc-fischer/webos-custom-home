import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import './index.css';

// Chromium < 84 (webOS 6) has no flexbox `gap`, and @supports can't detect it — measure
// once and flag <html> so the build-time margin fallback (vite-plugin-legacy-css.ts) applies.
function supportsFlexGap (): boolean {
	const flex = document.createElement('div');
	flex.style.cssText = 'display:flex;flex-direction:column;gap:1px;position:absolute;visibility:hidden';
	flex.appendChild(document.createElement('div'));
	flex.appendChild(document.createElement('div'));
	document.body.appendChild(flex);
	const ok = flex.scrollHeight === 1;
	document.body.removeChild(flex);
	return ok;
}
if (!supportsFlexGap()) document.documentElement.classList.add('no-flex-gap');

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
