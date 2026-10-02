export interface AppItem {
	id: string;         // webOS appId — used for the real luna launch
	title: string;
	color: string;      // brand accent — tints the tile + dynamic background
	/** icon bundled into the app (public/icons/*). WAM sandboxes web apps to their own
	 *  dir, so cross-app icon paths are blocked — we ship copies pulled off the TV.
	 *  Monogram fallback if it ever fails to load. */
	icon?: string;
	/** 'internal' opens one of OUR screens (no luna launch) — e.g. the settings overlay */
	launchType?: 'app' | 'input' | 'internal';
}

// Artwork for well-known apps: brand accent + an icon bundled in public/icons/. The
// app LIST itself is read live from the TV (see appsFromLaunchPoints) — this only
// dresses up ids we recognise; everything else gets the TV's own icon or a monogram.
const KNOWN: Record<string, {color: string; icon?: string}> = {
	'netflix': {color: '#e50914', icon: 'icons/netflix.png'},
	'com.disney.disneyplus-prod': {color: '#1f6feb', icon: 'icons/disney.png'},
	'amazon': {color: '#00a8e1', icon: 'icons/prime.png'},
	'com.wbd.stream': {color: '#7b2ff7', icon: 'icons/hbomax.png'},
	'hulu': {color: '#1ce783', icon: 'icons/hulu.png'},
	'com.apple.appletv': {color: '#b8bcc4', icon: 'icons/appletv.png'},
	'youtube.leanback.ytv.v1': {color: '#ff4e45', icon: 'icons/youtubetv.png'},
	'com.plutotv.app': {color: '#ffdd00', icon: 'icons/pluto.png'},
	'com.tubitv.ott.tubi': {color: '#8b5cf6', icon: 'icons/tubi.png'},
	'com.espn.espnplus-prod': {color: '#d50a0a', icon: 'icons/espn.png'},
	'imdbtv': {color: '#f5c518', icon: 'icons/freevee.png'},
	'vudu': {color: '#3399ff', icon: 'icons/fandango.png'},
	'youtube.leanback.v4': {color: '#ff0033', icon: 'icons/youtube.png'},
	'spotify-beehive': {color: '#1db954', icon: 'icons/spotify.png'},
	'twitch.adamffdev.v1': {color: '#9146ff', icon: 'icons/twitch.jpg'},
	'com.instantbits.cast.webvideo': {color: '#ff9500', icon: 'icons/webvideo.png'},
	'org.webosbrew.hbchannel': {color: '#34d399', icon: 'icons/homebrew.png'},
	'com.twin.app.gamingportal': {color: '#a855f7', icon: 'icons/gamingportal.png'},
	'com.ubisoft.lg.justdancenow': {color: '#ff2e93', icon: 'icons/justdance.png'},
	'com.twin.app.homegym': {color: '#22c55e', icon: 'icons/fitness.png'},
	'com.lgshop.app': {color: '#f59e0b', icon: 'icons/shoptime.png'}
};

const PALETTE = ['#7ca8ff', '#b39cff', '#5eead4', '#7ee7a6', '#f59e0b', '#ff7a90', '#38bdf8', '#e879f9'];
function colorFor (id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

/** In-app settings overlay — always the last tile on the Apps screen. */
export const SETTINGS_APP: AppItem = {
	id: 'internal.settings', title: 'Settings', color: '#94a3b8', icon: 'icons/settings.png', launchType: 'internal'
};

const OWN_ID = 'tld.my.customhome';
const INPUT_ID = /^com\.webos\.app\.(hdmi|externalinput)/;

/** Everything on the TV's launcher (webOS already leaves out hidden system apps),
 *  minus ourselves and the input "apps" (those live on the Inputs screen), A→Z. */
export function appsFromLaunchPoints (points: {id: string; title: string; icon?: string}[]): AppItem[] {
	const seen = new Set<string>();
	const apps: AppItem[] = [];
	for (const lp of points) {
		if (!lp.id || lp.id === OWN_ID || INPUT_ID.test(lp.id) || seen.has(lp.id)) continue;
		seen.add(lp.id);
		const known = KNOWN[lp.id];
		// Our service hands back a copy inside our own dir (relative path). A raw absolute
		// path is another app's dir, which webOS may block — AppArt then shows a monogram.
		const tvIcon = lp.icon ? (lp.icon.charAt(0) === '/' ? `file://${lp.icon}` : lp.icon) : undefined;
		apps.push({id: lp.id, title: lp.title || lp.id, color: known?.color ?? colorFor(lp.id), icon: known?.icon ?? tvIcon});
	}
	apps.sort((a, b) => a.title.localeCompare(b.title));
	return apps;
}

const INPUT_COLORS = ['#2f6cf6', '#e60012', '#22c55e', '#f59e0b'];

/** HDMI 1–4, used until (or unless) the TV reports its real inputs. */
export const DEFAULT_INPUTS: AppItem[] = [1, 2, 3, 4].map((n) => ({
	id: `com.webos.app.hdmi${n}`, title: `HDMI ${n}`, color: INPUT_COLORS[n - 1], launchType: 'input' as const
}));

/** HDMI inputs as reported by the TV (keeps the names you gave them in the TV's menu). */
export function inputsFromDevices (devices: {appId?: string; label?: string; connected?: boolean}[]): AppItem[] {
	const inputs: AppItem[] = [];
	for (const d of devices) {
		const m = /^com\.webos\.app\.hdmi(\d+)$/.exec(d.appId || '');
		if (!m) continue;
		const n = Number(m[1]);
		const name = `HDMI ${n}`;
		const label = d.label && d.label !== name ? `${d.label} · ${name}` : name;
		inputs.push({id: d.appId!, title: label, color: INPUT_COLORS[(n - 1) % INPUT_COLORS.length], launchType: 'input'});
	}
	inputs.sort((a, b) => a.id.localeCompare(b.id));
	return inputs;
}

/** Off-TV (desktop dev) stand-in so the Apps screen isn't empty. */
export const DEMO_APPS: AppItem[] = appsFromLaunchPoints([
	{id: 'netflix', title: 'Netflix'}, {id: 'youtube.leanback.v4', title: 'YouTube'},
	{id: 'amazon', title: 'Prime Video'}, {id: 'spotify-beehive', title: 'Spotify'},
	{id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel'}, {id: 'com.webos.app.browser', title: 'Web Browser'}
]);
