// Build-time CSS downlevel for old webOS engines (webOS 6 = Chromium 79).
//
// Tailwind v4 targets Chrome 111+. Lightning CSS can downlevel colors, `inset`,
// media-query ranges etc., but NOT the structural features below — on Chromium 79
// each of them silently drops rules, so the app renders unstyled. This plugin
// rewrites the final stylesheet so the same build works on 79 and newer:
//
//   @layer (Chrome 99)            -> flattened, cascade order kept via specificity
//   @property (Chrome 85)         -> Tailwind's `--tw-*` reset block applied always
//   translate/scale/rotate (104)  -> `transform` fallback inside @supports not (...)
//   :is() / :where() (Chrome 88)  -> expanded to plain selectors
//   flex `gap` (Chrome 84)        -> sibling-margin fallback under `.no-flex-gap`
//                                    (class set at runtime, see src/main.tsx)
//   padding-inline/-block (87)    -> physical longhands (Lightning CSS leaves these)
//   gradient `in oklab` (111)     -> interpolation hint stripped
import type {Plugin} from 'vite';
import postcss, {type AtRule, type ChildNode, type Container, type Plugin as PostcssPlugin, type Rule} from 'postcss';
import cascadeLayers from '@csstools/postcss-cascade-layers';
import isPseudoClass from '@csstools/postcss-is-pseudo-class';
import {transform, type Targets} from 'lightningcss';

/** Class added to <html> at runtime when flexbox `gap` is unsupported. */
export const NO_FLEX_GAP = 'no-flex-gap';

// Every var() carries its neutral default: Tailwind only defines the `--tw-*` variables
// that some utility in the build actually uses (no `scale-*` class → no `--tw-scale-x`),
// and one undefined variable would invalidate the whole declaration.
const TRANSFORM_FALLBACK =
	'translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) rotate(var(--tw79-rotate, 0deg)) scale(var(--tw-scale-x, 1), var(--tw-scale-y, 1))';

// Tailwind's own `--tw-*` reset is gated to old Safari/Firefox; Chromium < 85 needs it too.
function alwaysResetProperties (root: Container) {
	root.walkAtRules('supports', (at) => {
		if (!at.params.includes('-webkit-hyphens')) return;
		at.replaceWith(at.nodes ?? []);
	});
}

function stripGradientInterpolation (root: Container) {
	root.walkDecls('--tw-gradient-position', (decl) => {
		decl.value = decl.value.replace(/\s+in\s+[a-z]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/i, '');
	});
}

// Split on top-level whitespace (not inside parentheses).
function splitValue (value: string): string[] {
	const parts: string[] = [];
	let depth = 0, cur = '';
	for (const ch of value.trim()) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
	}
	if (cur) parts.push(cur);
	return parts;
}

// `padding-inline: a b` -> `padding-left: a; padding-right: b` (the UI is LTR-only).
function physicalShorthands (root: Container) {
	root.walkDecls(/^(padding|margin)-(inline|block)$/, (decl) => {
		const [box, axis] = decl.prop.split('-');
		const [start, end = start] = splitValue(decl.value);
		const [a, b] = axis === 'inline' ? ['left', 'right'] : ['top', 'bottom'];
		decl.replaceWith(
			decl.clone({prop: `${box}-${a}`, value: start}),
			decl.clone({prop: `${box}-${b}`, value: end})
		);
	});
}

// Non-@layer at-rules (e.g. @media) wrapping a node, outermost first.
function conditions (node: ChildNode): AtRule[] {
	const out: AtRule[] = [];
	for (let p = node.parent; p && p.type !== 'root'; p = p.parent as Container | undefined) {
		if (p.type === 'atrule' && (p as AtRule).name !== 'layer') out.unshift(p as AtRule);
	}
	return out;
}

function wrap (rule: Rule, ats: AtRule[]): ChildNode {
	let node: ChildNode = rule;
	for (let i = ats.length - 1; i >= 0; i--) {
		const at = ats[i].clone({nodes: []});
		at.append(node);
		node = at;
	}
	return node;
}

// `.flex.gap-N` -> margin between siblings, per flex-direction utility present in the sheet.
// The fallback zeroes the children's other margins, so don't put margin utilities on
// direct children of a `flex gap-*` container.
function flexGapFallback (root: Container) {
	const SIDE = {row: 'left', col: 'top', 'row-reverse': 'right', 'col-reverse': 'bottom'} as const;
	const directions: {selector: string; side: string; ats: AtRule[]}[] = [];
	root.walkRules(/^\.(\\.|[\w-])*flex-(row|col)(-reverse)?$/, (rule) => {
		const dir = /flex-((?:row|col)(?:-reverse)?)$/.exec(rule.selector)![1] as keyof typeof SIDE;
		directions.push({selector: rule.selector, side: SIDE[dir], ats: conditions(rule)});
	});

	root.walkRules(/^\.gap-(\\.|[\w-])+$/, (rule) => {
		let value: string | undefined;
		rule.each((n) => { if (n.type === 'decl' && n.prop === 'gap') value = n.value; });
		if (!value || conditions(rule).length) return;
		const base = `.${NO_FLEX_GAP} .flex${rule.selector}`;
		const out: ChildNode[] = [postcss.rule({selector: `${base}>*+*`, nodes: [postcss.decl({prop: 'margin-left', value})]})];
		for (const d of directions) {
			const r = postcss.rule({selector: `${base}${d.selector}>*+*`});
			r.append({prop: 'margin', value: '0'}, {prop: `margin-${d.side}`, value});
			out.push(wrap(r, d.ats));
		}
		rule.after(out);
	});
}

// Individual transform properties -> one `transform`, composed from the same `--tw-*`
// variables so translate/scale/rotate utilities still combine on one element.
function transformFallback (root: Container) {
	const done = new Set<Rule>();
	let resetDone = false;
	root.walkDecls(/^(translate|scale|rotate)$/, (decl) => {
		const rule = decl.parent as Rule;
		if (rule.type !== 'rule' || done.has(rule)) return;
		done.add(rule);

		const fallback = rule.clone({nodes: []});
		rule.each((n) => {
			if (n.type !== 'decl') return;
			// transform: scale() takes numbers only on old engines; Tailwind stores percentages.
			const pct = /^--tw-scale-[xyz]$/.test(n.prop) && /^(-?[\d.]+)%$/.exec(n.value);
			if (pct) fallback.append({prop: n.prop, value: String(parseFloat(pct[1]) / 100)});
			if (n.prop === 'rotate') fallback.append({prop: '--tw79-rotate', value: n.value === 'none' ? '0deg' : n.value});
		});
		fallback.append({prop: 'transform', value: TRANSFORM_FALLBACK});

		const at = postcss.atRule({name: 'supports', params: 'not (translate: 0)'});
		// our own rotate variable must not inherit from a rotated ancestor
		if (!resetDone && fallback.some((n) => n.type === 'decl' && n.prop === '--tw79-rotate')) {
			resetDone = true;
			const reset = postcss.atRule({name: 'supports', params: 'not (translate: 0)'});
			reset.append(postcss.rule({selector: '*, ::before, ::after', nodes: [postcss.decl({prop: '--tw79-rotate', value: '0deg'})]}));
			root.walkRules((first) => { if (!reset.parent && first.parent === rule.parent) first.before(reset); });
		}
		at.append(fallback);
		rule.after(at);
	});
}

// :where() has no pre-88 equivalent; treat it as :is() (slightly higher specificity) and
// let postcss-is-pseudo-class expand it.
function whereToIs (root: Container) {
	root.walkRules(/:where\(/, (rule) => { rule.selector = rule.selector.replace(/:where\(/g, ':is('); });
}

const prepare: PostcssPlugin = {
	postcssPlugin: 'legacy-css-prepare',
	Once (root) {
		alwaysResetProperties(root);
		stripGradientInterpolation(root);
		physicalShorthands(root);
		flexGapFallback(root);
		transformFallback(root);
		whereToIs(root);
	}
};

export async function downlevelCss (code: string, targets: Targets, filename = 'style.css'): Promise<string> {
	const flat = await postcss([
		prepare,
		isPseudoClass({onComplexSelector: 'warning'}),
		cascadeLayers()
	]).process(code, {from: filename});
	for (const w of flat.warnings()) console.warn(`[legacy-css] ${w.toString()}`);
	return transform({filename, code: Buffer.from(flat.css), minify: true, targets}).code.toString();
}

export default function legacyCss (targets: Targets): Plugin {
	return {
		name: 'legacy-css',
		apply: 'build',
		enforce: 'post',
		async generateBundle (_, bundle) {
			for (const asset of Object.values(bundle)) {
				if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
				asset.source = await downlevelCss(String(asset.source), targets, asset.fileName);
			}
		}
	};
}
