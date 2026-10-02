// Home is the center and carries the app rail itself (Left / Right run through the
// installed apps). Inputs sits above it: Up pans the "world" so that panel centers —
// a directional slide. Background crossfades separately.

export type ScreenId = 'home' | 'inputs';
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface ScreenDef {
	id: Exclude<ScreenId, 'home'>;
	label: string;
	direction: Direction;
	/** app list layout on this screen */
	orientation: 'vertical' | 'horizontal';
	/** accent color — drives the effect-background wash + label glow */
	accent: string;
	/** where this panel sits relative to home (CSS % of viewport) */
	panel: {x: string; y: string};
	/** world translate that brings this panel to center */
	world: {x: string; y: string};
	/** fraction (0..1) along the list axis where the focused tile rests */
	anchor: number;
}

// Mapping: Up=Inputs (HDMI). The list starts at its first item.
export const SCREENS: Record<Exclude<ScreenId, 'home'>, ScreenDef> = {
	inputs: {
		id: 'inputs', label: 'Inputs', direction: 'up', orientation: 'vertical',
		accent: '#b39cff', panel: {x: '0%', y: '-100%'}, world: {x: '0%', y: '100%'},
		anchor: 0.44
	}
};

export const DIRECTION_TO_SCREEN: Partial<Record<Direction, Exclude<ScreenId, 'home'>>> = {
	up: 'inputs'
};

/** The two tile lists: HDMI inputs (own screen) and installed apps (rail on home). */
export type CatId = 'inputs' | 'apps';
export const CAT_META: Record<CatId, {label: string; accent: string}> = {
	inputs: {label: 'Inputs', accent: '#b39cff'},
	apps: {label: 'Apps', accent: '#7ca8ff'}
};

export const HOME_WORLD = {x: '0%', y: '0%'};

export function worldForScreen (screen: ScreenId) {
	return screen === 'home' ? HOME_WORLD : SCREENS[screen].world;
}
