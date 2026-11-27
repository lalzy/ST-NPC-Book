// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Outfit operations: what a character wears, per slot. Items are self-contained ({id, name, slots, condition, note?}):
// any clothing can be worn. A catalog (e.g. a sister extension's wardrobe) may offer known items and, when strict,
// limit what can be worn; without one, anything goes.

import { SLOTS, STACKING_SLOTS, inferSlots, normalizeSlot, normalizeSlots } from './slots.js';
import { normalize, pickEnum, slugify } from './text.js';

const NOTHING = /^(nothing|none|naked|nude)$/i;
const SLOT_KEYS = new Set(SLOTS.map(x => x.key));
const IS_NONE = (x) => x === null || x === false || /^(none|nothing|naked|nude|empty|-)?$/i.test(String(x).trim());
/** Example ids from the prompt that small models copy literally; never clothing. */
const PLACEHOLDER = /^(item[_ -]?(id|name)s?|items?|ids?|names?|\.{2,}|…)$/i;

/** The outfit change of a tracker entry: entry.outfit (object, list or string) or a bare entry.wear. */
export function normOutfitChange(entry) {
    const o = entry?.outfit;
    if (o === undefined || o === null) return entry?.wear ? { wear: entry.wear } : null;
    if (Array.isArray(o)) return { wear: o };
    if (typeof o === 'string') return { wear: [o] };
    return o;
}

/** An item in a list by id or (normalized) name. */
export function findItem(list, ref) {
    if (!ref) return null;
    const r = String(ref).trim().toLowerCase();
    const n = normalize(ref);
    return (list || []).find(i => i.id === r) || (list || []).find(i => normalize(i.name) === n) || null;
}

function singular(w) { return w.length > 3 ? w.replace(/(es|s)$/, '') : w; }

/** Find an item by id, exact name, or loosely by words ("jeans" → "Blue Jeans"), preferring the given slot. */
export function findItemLoose(list, ref, slot = null) {
    const exact = findItem(list, ref);
    if (exact) return exact;
    const n = normalize(ref);
    if (!n) return null;
    const rw = n.split(' ').map(singular);
    const match = (pool) => pool.find(i => { const nw = new Set(normalize(i.name).split(' ').map(singular)); return rw.every(w => nw.has(w)); })
        || pool.find(i => normalize(i.name).includes(n));
    const all = list || [];
    return (slot && match(all.filter(i => (i.slots || []).includes(slot)))) || match(all) || null;
}

/** "blue_silk_dress" → "Blue silk dress"; a name that already reads as one is kept as written. */
export function nameFromRef(ref) {
    const s = String(ref).trim();
    if (/\s/.test(s) || !/[_-]/.test(s)) return s;
    const words = s.replace(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A new free item from a name (and optional slots). `taken(id)` keeps the id unique. */
export function makeItem(name, slots = null, taken = () => false, note = '') {
    const nm = nameFromRef(name);
    const base = slugify(nm) || 'item';
    let id = base;
    for (let n = 2; taken(id); n++) id = `${base}_${n}`;
    const sl = slots && (Array.isArray(slots) ? slots.length : true) ? normalizeSlots(slots) : inferSlots(nm);
    return { id, name: nm, slots: sl, ...(note ? { note: String(note) } : {}) };
}

/** An outfit as self-contained worn items (entries without a name are dropped). */
export function resolveOutfit(outfit) {
    const out = [];
    for (const w of Array.isArray(outfit) ? outfit : []) if (w?.name) out.push({ ...w, slots: normalizeSlots(w.slots) });
    return out;
}

function conflicts(a, b) {
    return (a.slots || []).some(s => !STACKING_SLOTS.has(s) && (b.slots || []).includes(s));
}

/** Put on an item (object): anything occupying the same (non-stacking) slots comes off. */
export function wearItem(outfit, item, condition) {
    if (!item?.name) return { outfit, ok: false };
    const next = (outfit || []).filter(w => w.id !== item.id && normalize(w.name) !== normalize(item.name) && !conflicts(w, item));
    next.push({ id: item.id, name: item.name, slots: [...(item.slots || ['other'])], ...(item.note ? { note: item.note } : {}), condition });
    return { outfit: next, ok: true };
}

/**
 * Apply clothing to an outfit. Accepts everything the tracker and greeting blocks use:
 *   "jeans" / ["jeans", "t-shirt"]               put on (replaces whatever is in the same slots)
 *   {"name": "Jeans", "slots": ["lower_outer"]}   an item with its slots
 *   {"lower_outer": "jeans", "feet": "none"}      per slot; "none" / "nothing" / null empties that slot
 *   "nothing"                                    everything off
 *   {"wear": [...], "remove": [...], "condition": {"item": "Wet"}}   explicit lists; "remove": "all"
 *   "jeans (wet)"                                with a condition from the conditions list
 * Items are looked up in `catalog` (known items, e.g. a wardrobe), then among what is worn; anything else becomes a new
 * free item, unless `strict` (then it is rejected). `loose` allows word matching ("jeans" → "Blue Jeans").
 * Returns { outfit, created: [items made up], rejected: [refs], warnings }.
 */
export function applyClothing(outfit, value, { conditions = ['Worn'], catalog = [], strict = false, loose = false } = {}) {
    let cur = (outfit || []).map(x => ({ ...x }));
    const created = [];
    const rejected = [];
    const warnings = [];
    const def = conditions?.[0] ?? 'Worn';
    const list = v => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]));
    const find = (pool, ref, slot) => (loose ? findItemLoose(pool, ref, slot) : findItem(pool, ref));
    const resolve = (raw, slot) => {
        const obj = raw && typeof raw === 'object' ? raw : null;
        let name = String(obj ? (obj.name ?? obj.id ?? '') : raw).trim();
        let cond = obj?.condition ? (pickEnum(obj.condition, conditions, null) || def) : def;
        const cm = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (cm) { const c = pickEnum(cm[2], conditions, null); if (c) { name = cm[1].trim(); cond = c; } }
        if (!name || PLACEHOLDER.test(name)) return null;
        const wantSlots = obj && (obj.slots ?? obj.slot) ? normalizeSlots(obj.slots ?? obj.slot) : (slot ? [slot] : null);
        const known = find(catalog, obj?.id ?? name, slot) || (obj?.id ? find(catalog, name, slot) : null);
        if (known) return { item: known, cond };
        const worn = find(cur, obj?.id ?? name, slot);
        if (worn) return { item: worn, cond: cm || obj?.condition ? cond : (worn.condition || cond) };
        if (strict) { rejected.push(name); return null; }
        const taken = (id) => cur.some(w => w.id === id) || created.some(w => w.id === id) || (catalog || []).some(w => w.id === id);
        const item = makeItem(name, wantSlots, taken, obj?.note ?? '');
        created.push(item);
        return { item, cond };
    };
    const wear = (raw, slot) => {
        const r = resolve(raw, slot);
        if (r) cur = wearItem(cur, r.item, r.cond).outfit;
    };
    const clearSlot = (slot) => { cur = cur.filter(w => !(w.slots || []).includes(slot)); };
    const removeRef = (raw) => {
        const ref = raw && typeof raw === 'object' ? (raw.id ?? raw.name) : raw;
        if (/^all$/i.test(String(ref ?? '').trim())) { cur = []; return; }
        const it = findItemLoose(cur, ref);
        const slotKey = normalize(ref).replace(/[\s()-]+/g, '_').replace(/_+$/, '');
        if (it) cur = cur.filter(w => w !== it);
        else if (SLOT_KEYS.has(slotKey)) clearSlot(slotKey); // "remove": ["feet_outer"] empties that slot
        else rejected.push(String(ref));
    };
    const setCondition = (ref, c) => {
        const w = findItemLoose(cur, ref);
        const cc = pickEnum(c, conditions, null);
        if (w && cc) w.condition = cc; else warnings.push(`condition: could not set "${ref}" to "${c}"`);
    };
    const handle = (val) => {
        if (Array.isArray(val)) { val.forEach(handle); return; }
        if (val && typeof val === 'object') {
            const ref = val.name ?? val.id;
            if (ref !== undefined && ref !== null && typeof ref !== 'object') { wear(val, null); return; }
            for (const [k, x] of Object.entries(val)) {
                const nk = normalize(k);
                if (nk === 'wear' || nk === 'add' || nk === 'put on') list(x).forEach(handle);
                else if (nk === 'remove' || nk === 'take off') list(x).forEach(removeRef);
                else if (nk === 'condition' || nk === 'conditions') { if (x && typeof x === 'object') for (const [r, c] of Object.entries(x)) setCondition(r, c); }
                else {
                    const slot = normalizeSlot(k);
                    if (!slot) { warnings.push(`unknown clothing slot "${k}"`); continue; }
                    clearSlot(slot);
                    for (const ref of list(x)) if (!IS_NONE(ref)) wear(ref, slot);
                }
            }
            return;
        }
        if (val === undefined || val === null || !String(val).trim()) return;
        if (NOTHING.test(String(val).trim())) { cur = []; return; }
        wear(val, null);
    };
    handle(value);
    return { outfit: cur, created, rejected, warnings };
}

/**
 * A tracker outfit change ({wear, remove, condition} or slot keys). Unlike greeting clothing, item names are matched
 * exactly (id or name) so the model's references stay unambiguous. Returns { outfit, created, rejected }.
 */
export function applyOutfitChange(outfit, change, { conditions = ['Worn'], catalog = [], strict = false } = {}) {
    if (!change || typeof change !== 'object') return { outfit: (outfit || []).map(x => ({ ...x })), created: [], rejected: [] };
    const r = applyClothing(outfit, change, { conditions, catalog, strict, loose: false });
    return { outfit: r.outfit, created: r.created, rejected: r.rejected };
}

/** Starting outfit of a template / persona: its own `outfit`. */
export function startingOutfit(t) {
    return resolveOutfit(t?.outfit);
}

/** slotKey -> [{item, condition}] for self-contained worn items. */
export function outfitBySlot(outfit) {
    const map = Object.fromEntries(SLOTS.map(s => [s.key, []]));
    for (const w of outfit || []) {
        if (!w?.name) continue;
        for (const s of w.slots || []) if (map[s]) map[s].push({ item: w, condition: w.condition });
    }
    return map;
}

/**
 * Plain-language exposure summary from what is worn, e.g. "completely naked", "topless, barefoot",
 * "in underwear only". Returns '' when nothing notable is exposed.
 */
export function exposureSummary(outfit) {
    const by = outfitBySlot(outfit);
    const has = (k) => (by[k] || []).length > 0;
    const anything = SLOTS.some(s => has(s.key));
    if (!anything) return 'completely naked';
    const upperOuter = has('cover') || has('upper_outer');
    const upperInner = has('upper_inner');
    const lowerOuter = has('lower_outer');
    const lowerInner = has('lower_inner');
    const feet = has('feet_outer') || has('feet_inner');
    const out = [];
    const noUpper = !upperOuter && !upperInner;
    const noLower = !lowerOuter && !lowerInner;
    if (noUpper && noLower) out.push('naked except for accessories');
    else {
        if (noUpper) out.push('topless (bare chest)');
        else if (!upperOuter && upperInner) out.push('upper body in underwear only');
        if (noLower) out.push('bottomless (genitals exposed)');
        else if (!lowerOuter && lowerInner) out.push('lower body in underwear only');
        if (!upperOuter && !lowerOuter && upperInner && lowerInner) {
            out.splice(0, out.length, 'in underwear only');
        }
    }
    if (!feet) out.push('barefoot');
    return out.join(', ');
}
