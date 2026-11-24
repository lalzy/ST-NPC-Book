// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Greeting starting-cast block: parsing and applying intro overrides.

import { matchBracket, stripTrailingCommas } from './json.js';
import { findItem, findItemLoose, wearItem } from './outfit.js';
import { inferSlots, normalizeSlot } from './slots.js';
import { normalize, pickEnum, uniqueId } from './text.js';

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
 * Apply a clothing override to an outfit. Items missing from the wardrobe are created (returned in `added`).
 *   "jeans" / ["jeans", "t-shirt"]            put on (replaces whatever is in the same slots)
 *   {"bottom-outer": "jeans", "feet": "none"}  per slot; "none" / "nothing" / null empties that slot
 *   "nothing"                                 everything off
 *   {"wear": [...], "remove": [...]}           explicit lists; "remove": "all"
 *   "jeans (wet)"                             with a condition from the conditions list
 */
export function applyClothingOverride(outfit, wardrobe, value, conditions = ['Worn']) {
    let cur = (outfit || []).map(x => ({ ...x }));
    let wd = [...(wardrobe || [])];
    const added = [];
    const warnings = [];
    const def = conditions?.[0] ?? 'Worn';
    const list = v => (Array.isArray(v) ? v : (v === undefined ? [] : [v]));
    const isNone = x => x === null || x === false || /^(none|nothing|naked|nude|empty|-)?$/i.test(String(x).trim());
    const resolve = (ref, slot) => {
        let name = String(ref).trim();
        let cond = def;
        const cm = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (cm) { const c = pickEnum(cm[2], conditions, null); if (c) { name = cm[1].trim(); cond = c; } }
        let item = findItemLoose(wd, name, slot);
        if (!item) {
            item = { id: uniqueId(name, x => wd.some(i => i.id === x)), name, slots: slot ? [slot] : inferSlots(name), note: '' };
            wd = [...wd, item];
            added.push(item);
        }
        return { item, cond };
    };
    const wear = (ref, slot) => { const { item, cond } = resolve(ref, slot); cur = wearItem(cur, wd, item.id, cond).outfit; };
    const clearSlot = (slot) => { cur = cur.filter(w => !(findItem(wd, w.id)?.slots || []).includes(slot)); };
    const removeRef = (ref) => {
        if (/^all$/i.test(String(ref).trim())) { cur = []; return; }
        const it = findItemLoose(wd, ref);
        if (it) cur = cur.filter(w => w.id !== it.id); else warnings.push(`remove: "${ref}" is not in the wardrobe`);
    };
    const setCondition = (ref, c) => {
        const it = findItemLoose(wd, ref);
        const w = it && cur.find(x => x.id === it.id);
        const cc = pickEnum(c, conditions, null);
        if (w && cc) w.condition = cc; else warnings.push(`condition: could not set "${ref}" to "${c}"`);
    };
    const handle = (val) => {
        if (Array.isArray(val)) { val.forEach(handle); return; }
        if (val && typeof val === 'object') {
            for (const [k, x] of Object.entries(val)) {
                const nk = normalize(k);
                if (nk === 'wear') list(x).forEach(handle);
                else if (nk === 'remove') list(x).forEach(removeRef);
                else if (nk === 'condition' || nk === 'conditions') { if (x && typeof x === 'object') for (const [r, c] of Object.entries(x)) setCondition(r, c); }
                else {
                    const slot = normalizeSlot(k);
                    if (!slot) { warnings.push(`unknown clothing slot "${k}"`); continue; }
                    clearSlot(slot);
                    for (const ref of list(x)) if (!isNone(ref)) wear(ref, slot);
                }
            }
            return;
        }
        if (isNone(val)) { cur = []; return; }
        wear(val, null);
    };
    handle(value);
    return { outfit: cur, wardrobe: wd, added, warnings };
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
 * Returns { instance, wardrobe, added, warnings }.
 */
export function applyCastOverrides(inst, overrides, { wardrobe = [], postures = [], states = [], conditions = ['Worn'] } = {}) {
    const out = { ...inst, outfit: (inst?.outfit || []).map(x => ({ ...x })) };
    let wd = [...(wardrobe || [])];
    const added = [];
    const warnings = [];
    const asEnum = (v, list) => { const t = String(v ?? '').trim(); return t ? pickEnum(t, list, t) : ''; };
    const dress = (v) => {
        const r = applyClothingOverride(out.outfit, wd, v, conditions);
        out.outfit = r.outfit; wd = r.wardrobe; added.push(...r.added); warnings.push(...r.warnings);
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
    return { instance: out, wardrobe: wd, added, warnings };
}
