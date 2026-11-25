// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Greeting starting-cast block: parsing and applying intro overrides.

import { matchBracket, stripTrailingCommas } from './json.js';
import { applyClothing } from './outfit.js';
import { normalizeSlot } from './slots.js';
import { normalize, pickEnum } from './text.js';

/** Turn the parsed "characters" array into [{ ref, overrides }]. Every entry must be an object with an "id". */
export function castEntries(list) {
    if (!Array.isArray(list)) throw new Error('"characters" must be an array');
    return list.map((x, n) => {
        if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.id !== 'string' || !x.id.trim()) {
            throw new Error(`entry ${n + 1} needs an "id", e.g. {"id": "suzie"}`);
        }
        const { id, ...overrides } = x;
        return { ref: id.trim(), overrides };
    });
}

/**
 * Finds the starting-cast JSON block in a greeting:
 *   ```json
 *   {
 *     "characters": [
 *       {"id": "suzie", "posture": "sitting", "clothing": {"bottom-outer": "jeans"}},
 *       {"id": "tom"}
 *     ]
 *   }
 *   ```
 * `"characters"` must start a line (after an optional `{`). The block must be valid JSON and contain only "characters".
 * The surrounding braces and code fence are removed with it. On any error the greeting is left unchanged.
 * Returns { found, entries: [{ref, overrides}], cleaned, error }.
 */
export function extractCharacterList(text) {
    const src = String(text ?? '');
    const re = /"characters"\s*:\s*\[/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const lineStart = src.lastIndexOf('\n', m.index - 1) + 1;
        if (!/^\s*\{?\s*$/.test(src.slice(lineStart, m.index))) continue;
        const fail = (error) => ({ found: true, entries: [], cleaned: src, error });
        const open = m.index + m[0].length - 1;
        const close = matchBracket(src, open);
        if (close < 0) return fail('unclosed [ in "characters"');
        let start = m.index;
        let end = close + 1;
        const before = src.slice(0, start).match(/\{\s*$/);
        const after = src.slice(end).match(/^\s*,?\s*\}/);
        if (before && !after) return fail('the JSON block may only contain "characters"');
        if (before && after) { start -= before[0].length; end += after[0].length; }
        const fb = src.slice(0, start).match(/```[a-z]*\s*$/i);
        const fa = src.slice(end).match(/^\s*```/);
        if (fb && fa) { start -= fb[0].length; end += fa[0].length; }
        let entries;
        try { entries = castEntries(JSON.parse(stripTrailingCommas(src.slice(open, close + 1)))); } catch (e) { return fail(e?.message || String(e)); }
        const cleaned = (src.slice(0, start) + src.slice(end)).replace(/\n{3,}/g, '\n\n').trim();
        return { found: true, entries, cleaned, error: null };
    }
    return { found: false, entries: [], cleaned: src, error: null };
}

/**
 * Apply a clothing override to an outfit (see applyClothing in outfit.js for the accepted shapes). Items are matched
 * loosely against `catalog` (known items, e.g. a wardrobe) and what is worn; anything else is created as a new item
 * (returned in `added`), unless `strict`. Returns { outfit, added, warnings }.
 */
export function applyClothingOverride(outfit, value, { conditions = ['Worn'], catalog = [], strict = false } = {}) {
    const r = applyClothing(outfit, value, { conditions, catalog, strict, loose: true });
    const warnings = [...r.warnings, ...r.rejected.map(x => `"${x}" is not allowed (not in the wardrobe)`)];
    return { outfit: r.outfit, added: r.created, warnings };
}

const OVERRIDE_FIELDS = {
    posture: ['posture', 'pose', 'position'],
    state: ['state', 'mood'],
    feelings: ['feelings', 'feeling', 'thoughts'],
    clothing: ['clothing', 'clothes', 'outfit', 'wearing', 'wear'],
};

/**
 * Apply intro-cast overrides ({posture, state, feelings, clothing, or slot keys directly}) to a scene instance.
 * Posture / state use the list value when it matches (case-insensitive), otherwise the text as written.
 * Returns { instance, added (clothing made up for this greeting), warnings }.
 */
export function applyCastOverrides(inst, overrides, { catalog = [], strict = false, postures = [], states = [], conditions = ['Worn'] } = {}) {
    const out = { ...inst, outfit: (inst?.outfit || []).map(x => ({ ...x })) };
    const added = [];
    const warnings = [];
    const asEnum = (v, list) => { const t = String(v ?? '').trim(); return t ? pickEnum(t, list, t) : ''; };
    const dress = (v) => {
        const r = applyClothingOverride(out.outfit, v, { conditions, catalog, strict });
        out.outfit = r.outfit; added.push(...r.added); warnings.push(...r.warnings);
    };
    for (const [rawK, v] of Object.entries(overrides || {})) {
        const k = normalize(rawK).replace(/[\s-]+/g, '_');
        const field = Object.keys(OVERRIDE_FIELDS).find(f => OVERRIDE_FIELDS[f].includes(k));
        if (field === 'posture') out.posture = asEnum(v, postures);
        else if (field === 'state') out.state = asEnum(v, states);
        else if (field === 'feelings') out.feelings = String(v ?? '').trim();
        else if (field === 'clothing') dress(v);
        else if (normalizeSlot(rawK)) dress({ [rawK]: v });
        else warnings.push(`unknown field "${rawK}"`);
    }
    return { instance: out, added, warnings };
}
