import {useEffect, useRef} from 'react';
import {DIRECTION_TO_SCREEN, SCREENS, type Direction, type ScreenId} from '../lib/screens';

const KEY_TO_DIR: Record<string, Direction> = {
	ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
};

const HOLD_MS = 550;   // OK held this long on a tile → move (reorder) mode

interface Handlers {
	screen: ScreenId;
	setScreen: (s: ScreenId) => void;
	// alt-screen list state
	selected: number;
	setSelected: (updater: (prev: number) => number) => void;
	itemCount: number;
	onLaunch: () => void;
	// reorder (move) mode
	moving: boolean;
	onMoveStart: () => void;
	onMoveStep: (delta: -1 | 1) => void;
	onMoveCommit: () => void;
	onMoveCancel: () => void;
	/** settings overlay open → it owns the keys, this hook goes quiet */
	enabled: boolean;
}

// One handler for the whole app. Home carries the app rail: Left / Right move along
// it (clamped), Up opens Inputs. On Inputs, Up / Down move the selection and running
// past either end, a cross-axis arrow or Back returns home. On both, a short OK press
// launches and HOLDING OK enters move mode (arrows reorder, OK saves, Back cancels).
export function useRemoteNav ({screen, setScreen, selected, setSelected, itemCount, onLaunch, moving, onMoveStart, onMoveStep, onMoveCommit, onMoveCancel, enabled}: Handlers) {
	// long-press bookkeeping survives re-renders but never triggers them
	const hold = useRef<{timer: number; fired: boolean}>({timer: 0, fired: false});

	useEffect(() => {
		if (!enabled) return;

		const onKeyDown = (e: KeyboardEvent) => {
			const isBack = e.keyCode === 461 || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack';
			const dir = KEY_TO_DIR[e.key];

			if (e.key === 'Enter') {
				e.preventDefault();
				if (e.repeat) return;
				// commit reorder; flag the press so its keyup can't double as a launch
				if (moving) { hold.current.fired = true; onMoveCommit(); return; }
				// arm the long-press; a short press launches on keyup instead
				hold.current.fired = false;
				hold.current.timer = window.setTimeout(() => {
					hold.current.fired = true;
					onMoveStart();
				}, HOLD_MS);
				return;
			}

			if (isBack) {
				if (moving) { e.preventDefault(); onMoveCancel(); return; }
				if (screen !== 'home') { e.preventDefault(); setScreen('home'); }
				return;
			}
			if (!dir) return;
			e.preventDefault();

			const onHome = screen === 'home';
			const vertical = !onHome && SCREENS[screen as Exclude<ScreenId, 'home'>].orientation === 'vertical';
			const along = vertical ? {next: 'down', prev: 'up'} : {next: 'right', prev: 'left'};
			const step = dir === along.next ? 1 : dir === along.prev ? -1 : 0;

			// Move mode: along-axis arrows shift the held tile; ends clamp and
			// cross-axis presses do nothing (never leaves the list mid-reorder).
			if (moving) {
				if (step) onMoveStep(step);
				return;
			}

			if (step) {
				const target = selected + step;
				if (target >= 0 && target < itemCount) setSelected(() => target);
				else if (!onHome) setScreen('home');   // ran past the end of Inputs
				return;
			}
			// cross-axis: from home it opens that direction's screen (if any), elsewhere it leaves
			if (onHome) {
				const target = DIRECTION_TO_SCREEN[dir];
				if (target) setScreen(target);
			} else {
				setScreen('home');
			}
		};

		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key !== 'Enter') return;
			window.clearTimeout(hold.current.timer);
			// short press (hold never fired) while not in move mode → launch
			if (!hold.current.fired && !moving) onLaunch();
			hold.current.fired = false;
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			window.clearTimeout(hold.current.timer);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		};
	}, [screen, setScreen, selected, setSelected, itemCount, onLaunch, moving, onMoveStart, onMoveStep, onMoveCommit, onMoveCancel, enabled]);
}
