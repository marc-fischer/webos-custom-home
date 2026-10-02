import {createContext, useContext} from 'react';

// User-tunable options (QOL config GUI) — persisted in localStorage so nothing
// needs a code edit + redeploy. App.tsx owns the state; ConfigContext fans it
// out to the widgets.
export interface GeoLocation {
	name: string;
	latitude: number;
	longitude: number;
}

export interface HomeConfig {
	clock24: boolean;
	tempUnit: 'fahrenheit' | 'celsius';
	/** Weather location — user-settable in Settings, so the prebuilt app isn't
	 *  pinned to the placeholder. Defaults to the placeholder in weather.ts. */
	location: GeoLocation;
}

export const APP_VERSION = '0.4.3';

export const DEFAULT_CONFIG: HomeConfig = {
	clock24: false,
	tempUnit: 'fahrenheit',
	location: {name: 'Your City', latitude: 40.7128, longitude: -74.0060}
};

const KEY = 'home-config-v1';

export function loadConfig (): HomeConfig {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {...DEFAULT_CONFIG};
		return {...DEFAULT_CONFIG, ...JSON.parse(raw)};
	} catch { return {...DEFAULT_CONFIG}; }
}

export function saveConfig (cfg: HomeConfig): void {
	try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* noop */ }
}

export const ConfigContext = createContext<HomeConfig>(DEFAULT_CONFIG);
export function useConfig (): HomeConfig {
	return useContext(ConfigContext);
}
