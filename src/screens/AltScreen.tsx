import {useState, memo} from 'react';
import type {ScreenDef} from '../lib/screens';
import type {AppItem} from '../lib/apps';

// OLED look: pure-black page, solid (alpha-free) surfaces and hard 3px focus borders —
// no glows, soft shadows or scaled layers, which smear when the 1080p UI plane is
// upscaled to the 4K panel. PERF: no per-tile motion components and no filter:blur;
// the track is ONE compositor transform with a CSS transition.
//
// Fixed tile metrics → focus-follow needs no measurement.
const V = {tile: 'h-[104px] w-[560px]', size: 104, step: 128, half: 52};   // vertical rows
const H = {tile: 'h-[320px] w-[248px]', size: 248, step: 276, half: 124};  // horizontal cards
const C = {tile: 'h-[232px] w-[200px]', size: 200, step: 224, half: 100};  // compact cards (home rail)

const EASE = 'var(--m3-dur-medium) var(--m3-ease-emphasized)';

// Real app icon with a monogram fallback if it's missing or off-device: a solid
// brand-color chip with a dark letter.
function AppArt ({app, size}: {app: AppItem; size: number}) {
	const [broken, setBroken] = useState(false);
	const show = app.icon && !broken;
	return (
		<div
			className="flex shrink-0 items-center justify-center overflow-hidden"
			style={{width: size, height: size, borderRadius: size * 0.22, background: show ? 'transparent' : app.color}}
		>
			{show ? (
				<img
					src={app.icon}
					alt=""
					draggable={false}
					onError={() => setBroken(true)}
					style={{width: '100%', height: '100%', objectFit: 'cover'}}
				/>
			) : (
				<span className="font-semibold" style={{fontSize: size * 0.46, color: '#000000'}}>{app.title[0]}</span>
			)}
		</div>
	);
}

// memo: on each move only the two tiles whose `focused` flips re-render, not all 12.
const Tile = memo(function Tile ({app, focused, vertical, compact, tileClass, moving, launching}: {app: AppItem; focused: boolean; vertical: boolean; compact: boolean; tileClass: string; moving: boolean; launching: boolean}) {
	const held = focused && moving;   // this tile is being reordered
	return (
		<div className={`relative shrink-0 ${tileClass}`}>
			<div
				className={`absolute inset-0 flex items-center overflow-hidden rounded-[20px] ${vertical ? 'flex-row px-6' : compact ? 'flex-col p-4' : 'flex-col p-6'}`}
				style={{
					// constant 3px border (only its color/style changes) → focus never shifts the content
					border: held ? `3px dashed ${app.color}` : `3px solid ${focused ? app.color : '#1c1c21'}`,
					// flat brand tint over a solid base: opaque, so the edge stays hard
					background: focused ? `linear-gradient(${app.color}30, ${app.color}30), #0a0a0c` : '#0a0a0c',
					color: focused ? '#ffffff' : '#b4b4be',
					opacity: !focused && moving ? 0.4 : 1,
					// quick press-pulse so a launch visibly registered (webOS can take a beat)
					animation: launching ? 'launch-pulse 0.55s var(--m3-ease-emphasized)' : 'none',
					transition: `opacity ${EASE}`
				}}
			>
				{vertical ? (
					<>
						<AppArt app={app} size={56} />
						<span className="ml-5 truncate text-2xl font-medium">{app.title}</span>
					</>
				) : (
					<>
						<div className="flex flex-1 items-center justify-center">
							<AppArt app={app} size={compact ? 84 : 96} />
						</div>
						<span className={`w-full truncate text-center font-medium ${compact ? 'text-lg' : 'text-xl'}`}>{app.title}</span>
					</>
				)}
			</div>
		</div>
	);
});

/**
 * The scrolling tile track. Absolutely positioned in its (relative) parent: `anchor`
 * (0..1) is where the focused tile rests along the list axis, `cross` (0..1) where the
 * track's center line sits on the other axis.
 */
export function Rail ({items, index, focus, vertical, compact = false, anchor, cross = 0.5, moving, launchingId}: {
	items: AppItem[]; index: number; focus: boolean; vertical: boolean; compact?: boolean;
	anchor: number; cross?: number; moving: boolean; launchingId: string | null;
}) {
	const g = vertical ? V : compact ? C : H;
	const scrollPx = index * g.step + g.half;
	const transform = vertical
		? `translate3d(-50%, calc(${anchor * 100}vh - ${scrollPx}px), 0)`
		: `translate3d(calc(${anchor * 100}vw - ${scrollPx}px), -50%, 0)`;
	return (
		<div
			className={`absolute ${vertical ? 'flex-col' : 'flex-row'} flex items-center gap-[var(--rail-gap)]`}
			style={{
				...(vertical ? {left: `${cross * 100}%`, top: 0} : {left: 0, top: `${cross * 100}%`}),
				// gap via a utility class (not inline) so the Chromium 79 flex-gap fallback covers it
				['--rail-gap' as string]: `${g.step - g.size}px`,
				transform,
				willChange: 'transform',
				transition: `transform ${EASE}`
			}}
		>
			{items.map((app, i) => (
				<Tile key={app.id} app={app} focused={focus && i === index} vertical={vertical} compact={compact} tileClass={g.tile} moving={moving} launching={app.id === launchingId} />
			))}
		</div>
	);
}

/** Reorder hint — shown while a tile is held; hold OK on a tile to start. */
export function MoveHint ({title, vertical, accent, moving, place = 'bottom-[6vh]'}: {title?: string; vertical: boolean; accent: string; moving: boolean; place?: string}) {
	return (
		<div
			className={`absolute ${place} left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-6 py-3 text-lg font-medium`}
			style={{
				color: '#ffffff',
				background: '#000000',
				border: `2px solid ${accent}`,
				opacity: moving ? 1 : 0,
				transition: `opacity ${EASE}`,
				pointerEvents: 'none'
			}}
		>
			Moving “{title}” — {vertical ? '↑ ↓' : '← →'} reorder · OK save · Back cancel
		</div>
	);
}

export default function AltScreen ({def, items, selected, active, moving, launchingId}: {def: ScreenDef; items: AppItem[]; selected: number; active: boolean; moving: boolean; launchingId: string | null}) {
	const vertical = def.orientation === 'vertical';

	// An inactive panel rests on its first item, so becoming active never scrolls.
	const idx = active ? selected : 0;

	return (
		// overflow-hidden: a long rail must not spill into the neighbouring (home) panel
		<div className="relative h-full w-full overflow-hidden">
			<h1 className="absolute left-[5vw] top-[8vh] z-10 text-[42px] font-normal tracking-tight" style={{color: def.accent}}>
				{def.label}
			</h1>
			<MoveHint title={items[selected]?.title} vertical={vertical} accent={def.accent} moving={moving} />
			<Rail items={items} index={idx} focus={active} vertical={vertical} anchor={def.anchor} moving={moving} launchingId={launchingId} />
		</div>
	);
}
