import {SETTINGS_APP, type AppItem} from './apps';
import type {CatId} from './screens';

export type {CatId};
export const CATS: CatId[] = ['inputs', 'apps'];

// Persisted layout state (QOL): per-screen tile order plus a hidden-app list. What
// EXISTS always comes live from the TV (installed apps, HDMI inputs): uninstalled
// apps drop out, newly installed ones append, so nothing here needs a code edit.
const ORDER_KEY = 'home-app-order-v2';
const HIDDEN_KEY = 'home-hidden-v1';

function loadOrders (): Partial<Record<CatId, string[]>> {
	try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '{}'); }
	catch { return {}; }
}

/**
 * Assemble the full per-screen lists (hidden items INCLUDED — the caller filters
 * for display). A saved order wins; anything not in it appends in the given order.
 * The Settings tile is always part of Apps.
 */
export function buildLists (apps: AppItem[], inputs: AppItem[]): Record<CatId, AppItem[]> {
	const source: Record<CatId, AppItem[]> = {inputs, apps: [...apps, SETTINGS_APP]};
	const saved = loadOrders();
	const out = {inputs: [], apps: []} as Record<CatId, AppItem[]>;

	for (const cat of CATS) {
		const byId = new Map(source[cat].map((a) => [a.id, a] as const));
		for (const id of saved[cat] || []) {
			const app = byId.get(id);
			if (app) { out[cat].push(app); byId.delete(id); }
		}
		for (const app of byId.values()) out[cat].push(app);
	}
	return out;
}

/** Persist the given categories' current id sequences (merge into stored). */
export function saveOrders (lists: Partial<Record<CatId, AppItem[]>>): void {
	const all = loadOrders();
	for (const cat of CATS) {
		const apps = lists[cat];
		if (apps) all[cat] = apps.map((a) => a.id);
	}
	try { localStorage.setItem(ORDER_KEY, JSON.stringify(all)); } catch { /* storage full/blocked — order just won't persist */ }
}

export function resetOrder (): void {
	try { localStorage.removeItem(ORDER_KEY); } catch { /* noop */ }
}

// --- hidden apps -----------------------------------------------------------

export function loadHidden (): Set<string> {
	try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
	catch { return new Set(); }
}

export function saveHidden (ids: Set<string>): void {
	try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids])); } catch { /* noop */ }
}
