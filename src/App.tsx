import {useState, useEffect, useCallback, useMemo, useRef, type ReactNode} from 'react';
import Settings from './components/Settings';
import Home from './screens/Home';
import AltScreen from './screens/AltScreen';
import {useRemoteNav} from './hooks/useRemoteNav';
import {SCREENS, worldForScreen, type ScreenDef, type ScreenId, type CatId} from './lib/screens';
import {appsFromLaunchPoints, inputsFromDevices, DEFAULT_INPUTS, DEMO_APPS, type AppItem} from './lib/apps';
import {buildLists, saveOrders, loadHidden, saveHidden} from './lib/order';
import {ConfigContext, loadConfig, saveConfig, type HomeConfig} from './lib/config';
import {launchApp, listLaunchPoints, listInputs, assertSoundOutput, guardSoundOutput, isWebOS} from './service/luna';

const JITTER_MS = 150_000;   // OLED guard: shift the whole UI ±2px this often

function Panel ({def, children}: {def?: ScreenDef; children: ReactNode}) {
	const panel = def ? def.panel : {x: '0%', y: '0%'};
	return (
		<div className="absolute inset-0 h-full w-full" style={{transform: `translate(${panel.x}, ${panel.y})`}}>
			{children}
		</div>
	);
}

export default function App () {
	const [screen, setScreen] = useState<ScreenId>('home');
	// focused tile per list — home (apps) keeps its place while you visit Inputs
	const [sel, setSel] = useState<Record<CatId, number>>({inputs: 0, apps: 0});
	// what the TV actually has: installed apps + HDMI inputs (demo/default set off-TV
	// and until the TV answers)
	const [installed, setInstalled] = useState<AppItem[]>(() => (isWebOS() ? [] : DEMO_APPS));
	const [inputs, setInputs] = useState<AppItem[]>(DEFAULT_INPUTS);
	const [hidden, setHidden] = useState<Set<string>>(loadHidden);
	// full per-screen lists (hidden included); the visible slices drive the UI
	const [lists, setLists] = useState<Record<CatId, AppItem[]>>(() => buildLists(installed, inputs));
	const [moving, setMoving] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [config, setConfig] = useState<HomeConfig>(loadConfig);
	const [toast, setToast] = useState<string | null>(null);
	const [launchFx, setLaunchFx] = useState<string | null>(null);   // app id pulsing
	const [jitter, setJitter] = useState({x: 0, y: 0});
	// snapshot of the list being reordered, restored on Back (cancel)
	const moveSnapshot = useRef<Record<CatId, AppItem[]> | null>(null);
	const toastTimer = useRef(0);

	const visible = useMemo(() => ({
		inputs: lists.inputs.filter((a) => !hidden.has(a.id)),
		apps: lists.apps.filter((a) => !hidden.has(a.id))
	}), [lists, hidden]);

	const showToast = useCallback((msg: string, ms = 2600) => {
		setToast(msg);
		window.clearTimeout(toastTimer.current);
		toastTimer.current = window.setTimeout(() => setToast(null), ms);
	}, []);

	// Read the real app list and HDMI inputs off the TV. Runs once; off-webOS the
	// demo apps / default inputs stay.
	useEffect(() => {
		if (!isWebOS()) return;
		listLaunchPoints()
			.then((res) => setInstalled(appsFromLaunchPoints(res.launchPoints || [])))
			.catch((e: unknown) => {
				// eslint-disable-next-line no-console
				console.error('listLaunchPoints failed', e);
				showToast(`Couldn't read the installed apps — ${e instanceof Error ? e.message : String(e)}`.slice(0, 160), 15000);
			});
		listInputs()
			.then((res) => {
				const found = inputsFromDevices(res.devices || []);
				if (found.length) setInputs(found);
			})
			.catch(() => { /* keep HDMI 1–4 */ });
	}, [showToast]);

	useEffect(() => { setLists(buildLists(installed, inputs)); }, [installed, inputs]);

	// eARC guard: LG home re-negotiates audio routing on focus changes; we don't,
	// so the receiver can lose audio after boot or after we launch an app.
	// guardSoundOutput subscribes to the live sink (re-asserting the instant it
	// drifts off the receiver) and also retries through the cold-boot window,
	// where a stuck output emits no event for the subscription to catch. The
	// visibilitychange kick still covers return-to-foreground: while we're
	// backgrounded the web app is frozen and misses pushes, so we re-assert once
	// on the way back in (eARC is warm by then).
	useEffect(() => {
		if (!isWebOS()) return;
		const cancelGuard = guardSoundOutput();
		const onVis = () => { if (!document.hidden) assertSoundOutput().catch(() => { /* best-effort */ }); };
		document.addEventListener('visibilitychange', onVis);
		return () => { cancelGuard(); document.removeEventListener('visibilitychange', onVis); };
	}, []);

	// OLED guard: drift every fixed element by a couple of pixels now and then.
	useEffect(() => {
		const id = window.setInterval(() => {
			setJitter({x: Math.round(Math.random() * 4 - 2), y: Math.round(Math.random() * 4 - 2)});
		}, JITTER_MS);
		return () => window.clearInterval(id);
	}, []);

	// The list the remote is driving: the app rail on home, else that screen's own list.
	const cat: CatId = screen === 'home' ? 'apps' : screen;
	const itemCount = visible[cat].length;
	const selected = Math.max(0, Math.min(sel[cat], itemCount - 1));
	const setSelected = useCallback((updater: (prev: number) => number) => {
		setSel((prev) => ({...prev, [cat]: updater(prev[cat])}));
	}, [cat]);

	// Changing screen drops any reorder in progress; Inputs always opens on its first item.
	useEffect(() => {
		setMoving(false);
		if (screen === 'inputs') setSel((prev) => ({...prev, inputs: 0}));
	}, [screen]);

	const onLaunch = useCallback(() => {
		const app = visible[cat][selected];
		if (!app) return;
		if (app.launchType === 'internal') { setSettingsOpen(true); return; }
		// pulse the tile so the press visibly registered (webOS can take a beat)
		setLaunchFx(app.id);
		window.setTimeout(() => setLaunchFx(null), 700);
		if (isWebOS()) {
			// eARC guard: re-assert sound output once the launched app has taken
			// the foreground — the raw luna launch skips LG home's audio renegotiation.
			window.setTimeout(() => { assertSoundOutput().catch(() => { /* best-effort */ }); }, 1500);
			launchApp(app.id).catch((e: unknown) => {
				// eslint-disable-next-line no-console
				console.error('launch failed', app.id, e);
				showToast(`Couldn't launch ${app.title}`);
			});
		} else {
			// eslint-disable-next-line no-console
			console.log('launch (stub, not on webOS):', app.id, app.launchType);
		}
	}, [cat, selected, visible, showToast]);

	// --- Reorder (move) mode -------------------------------------------------
	const onMoveStart = useCallback(() => {
		moveSnapshot.current = lists;
		setMoving(true);
	}, [lists]);

	const onMoveStep = useCallback((delta: -1 | 1) => {
		const vis = visible[cat];
		const target = selected + delta;
		if (target < 0 || target >= vis.length) return;
		// swap within the FULL list (hidden tiles keep their slots)
		const a = vis[selected].id, b = vis[target].id;
		setLists((prev) => {
			const next = [...prev[cat]];
			const ia = next.findIndex((x) => x.id === a), ib = next.findIndex((x) => x.id === b);
			[next[ia], next[ib]] = [next[ib], next[ia]];
			return {...prev, [cat]: next};
		});
		setSelected(() => target);   // focus travels with the tile
	}, [cat, selected, visible, setSelected]);

	const onMoveCommit = useCallback(() => {
		saveOrders(lists);
		setMoving(false);
		moveSnapshot.current = null;
	}, [lists]);

	const onMoveCancel = useCallback(() => {
		if (moveSnapshot.current) {
			const snap = moveSnapshot.current;
			setLists(snap);
			const len = snap[cat].filter((a) => !hidden.has(a.id)).length;
			setSelected((p) => Math.max(0, Math.min(p, len - 1)));
		}
		setMoving(false);
		moveSnapshot.current = null;
	}, [cat, hidden, setSelected]);

	// --- Settings ------------------------------------------------------------
	const onConfigChange = useCallback((c: HomeConfig) => { setConfig(c); saveConfig(c); }, []);
	const onOrderReset = useCallback(() => setLists(buildLists(installed, inputs)), [installed, inputs]);
	const closeSettings = useCallback(() => setSettingsOpen(false), []);
	const onToggleHide = useCallback((id: string) => {
		setHidden((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			saveHidden(next);
			return next;
		});
	}, []);

	useRemoteNav({
		screen, setScreen, selected, setSelected, itemCount, onLaunch,
		moving, onMoveStart, onMoveStep, onMoveCommit, onMoveCancel,
		enabled: !settingsOpen
	});
	const world = worldForScreen(screen);

	return (
		<ConfigContext.Provider value={config}>
			<div className="relative h-full w-full overflow-hidden bg-black">
				{/* World pan is a pure CSS transform transition — compositor-only, no
				   per-frame JS. Changing `screen` moves the whole cross of panels.
				   The extra px offset is the slow OLED anti-burn-in jitter. */}
				<div
					className="absolute inset-0 z-10 h-full w-full"
					style={{
						transform: `translate(calc(${world.x} + ${jitter.x}px), calc(${world.y} + ${jitter.y}px))`,
						// Longer, gentle ease-in-out — smoother in and out of home (user pref:
						// slower is fine if smoother). Compositor-only, so cost is unchanged.
						transition: 'transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
						willChange: 'transform'
					}}
				>
					<Panel>
						<Home
							active={screen === 'home'}
							items={visible.apps}
							selected={Math.max(0, Math.min(sel.apps, visible.apps.length - 1))}
							moving={moving && screen === 'home'}
							launchingId={screen === 'home' ? launchFx : null}
						/>
					</Panel>
					{Object.values(SCREENS).map((def) => (
						<Panel key={def.id} def={def}>
							<AltScreen
								def={def}
								items={visible[def.id]}
								selected={def.id === screen ? selected : 0}
								active={def.id === screen}
								moving={moving && def.id === screen}
								launchingId={def.id === screen ? launchFx : null}
							/>
						</Panel>
					))}
				</div>

				{settingsOpen && (
					<Settings
						config={config} onChange={onConfigChange} onClose={closeSettings}
						onOrderReset={onOrderReset}
						lists={lists} hidden={hidden} onToggleHide={onToggleHide}
					/>
				)}

				{/* Feedback toast (launch errors) */}
				<div
					className="absolute left-1/2 top-[6vh] z-50 -translate-x-1/2 whitespace-nowrap rounded-full px-7 py-3.5 text-lg font-medium"
					style={{
						color: '#ffffff',
						background: '#000000',
						border: '2px solid #7ca8ff',
						opacity: toast ? 1 : 0,
						transform: `translateX(-50%) translateY(${toast ? 0 : -8}px)`,
						transition: 'opacity 0.3s ease, transform 0.3s ease',
						pointerEvents: 'none'
					}}
				>
					{toast}
				</div>
			</div>
		</ConfigContext.Provider>
	);
}
