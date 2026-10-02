import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import browserslist from 'browserslist';
import {browserslistToTargets} from 'lightningcss';
import legacyCss from './vite-plugin-legacy-css';
import type {Plugin} from 'vite';

// Oldest supported engine: webOS 6 = Chromium 79 (webOS 24 / Chromium 108 is the
// original, proven target). Tailwind v4 needs Chrome 111, so the final stylesheet is
// rewritten by ./vite-plugin-legacy-css.ts (flattens @layer, transform/flex-gap
// fallbacks, …) and then downleveled by Lightning CSS (oklch -> hex, `inset`, media
// ranges, …). Do NOT remove either — without them the panel renders unstyled.
const LEGACY = 'chrome >= 79';
const targets = browserslistToTargets(browserslist(LEGACY));

// webOS loads the app from file://. Old engines (webOS 6) refuse ES-module scripts and
// `crossorigin` assets there (origin "null" fails the CORS check), which leaves a black
// screen. Ship one classic deferred script instead; `defer` keeps module-like timing.
function classicScript (): Plugin {
	return {
		name: 'classic-script',
		apply: 'build',
		enforce: 'post',
		transformIndexHtml (html) {
			return html
				.replace(/<script type="module" crossorigin/g, '<script defer')
				.replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
		}
	};
}

export default defineConfig({
	base: './', // webOS apps load from a local file path — assets must be relative.
	plugins: [react(), tailwindcss(), legacyCss(targets), classicScript()],
	css: {
		// Keep Vite's own CSS pass modern; legacyCss() does the single downlevel + minify
		// on the finished bundle (it has to see un-mangled @layer / :is() to rewrite them).
		transformer: 'lightningcss',
		lightningcss: {targets: browserslistToTargets(browserslist('chrome >= 120'))}
	},
	build: {
		target: 'chrome79', // esbuild: compiles ?. / ?? (Chrome 80) away
		cssMinify: false,
		modulePreload: false,
		cssCodeSplit: false, // keep CSS a real file (iife would inline it into JS, bypassing legacyCss)
		rollupOptions: {output: {format: 'iife', inlineDynamicImports: true}},
		outDir: 'dist'
	}
});
