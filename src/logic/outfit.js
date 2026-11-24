// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Wardrobe and outfit operations: wearing, removing, outfit changes, exposure summary.

import { SLOTS, STACKING_SLOTS, inferSlots, normalizeSlots } from './slots.js';
import { normalize, pickEnum, uniqueId } from './text.js';

export function normOutfitChange(entry) {
    const o = entry?.outfit;
    if (!o) return entry?.wear ? { wear: entry.wear } : null;
    if (Array.isArray(o)) return { wear: o };
    return o;
}

export function findItem(wardrobe, ref) {
    if (!ref) return null;
    const r = String(ref).trim().toLowerCase();
    const n = normalize(ref);
    return (wardrobe || []).find(i => i.id === r) || (wardrobe || []).find(i => normalize(i.name) === n) || null;
}

/** Build wardrobe items from LLM/raw data, giving each a unique id. */
export function buildWardrobe(rawItems, existing = []) {
    const out = [...existing];
    const added = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
        const name = String(typeof raw === 'string' ? raw : raw?.name ?? '').trim();
        if (!name) continue;
        if (out.some(i => normalize(i.name) === normalize(name))) continue;
        const item = {
            id: uniqueId(raw?.id || name, x => out.some(i => i.id === x)),
            name,
            slots: (raw?.slots ?? raw?.slot) ? normalizeSlots(raw?.slots ?? raw?.slot) : inferSlots(name),
            note: String(raw?.note ?? raw?.description ?? '').trim(),
        };
        out.push(item);
        added.push(item);
    }
    return { wardrobe: out, added };
}

function conflicts(a, b) {
    return a.slots.some(s => !STACKING_SLOTS.has(s) && b.slots.includes(s));
}

/** Put on an item: anything occupying the same (non-stacking) slots comes off. */
export function wearItem(outfit, wardrobe, ref, condition) {
    const item = findItem(wardrobe, ref);
    if (!item) return { outfit, ok: false };
    const next = outfit.filter(w => {
        if (w.id === item.id) return false;
        const other = findItem(wardrobe, w.id);
        return !(other && conflicts(other, item));
    });
    next.push({ id: item.id, condition });
    return { outfit: next, ok: true };
}

/**
 * Apply an LLM outfit change {wear:[], remove:[], condition:{}} using ONLY items from the wardrobe.
 * Unknown items are ignored (and reported in `rejected`).
 */
export function applyOutfitChange(outfit, wardrobe, change, conditions) {
    let cur = Array.isArray(outfit) ? outfit.map(x => ({ ...x })) : [];
    const rejected = [];
    if (!change || typeof change !== 'object') return { outfit: cur, rejected };
    const defCond = conditions?.[0] ?? 'Worn';
    const list = v => (Array.isArray(v) ? v : (v ? [v] : []));
    for (const ref of list(change.remove)) {
        const item = findItem(wardrobe, ref);
        if (item) cur = cur.filter(w => w.id !== item.id);
        else if (String(ref).toLowerCase() === 'all') cur = [];
        else rejected.push(String(ref));
    }
    for (const ref of list(change.wear)) {
        const r = wearItem(cur, wardrobe, ref, defCond);
        if (r.ok) cur = r.outfit; else rejected.push(String(ref));
    }
    for (const [ref, cond] of Object.entries(change.condition || change.conditions || {})) {
        const item = findItem(wardrobe, ref);
        const w = item && cur.find(x => x.id === item.id);
        const c = pickEnum(cond, conditions, null);
        if (w && c) w.condition = c;
    }
    return { outfit: cur, rejected };
}

export function outfitFromDefault(defaultWorn, wardrobe, conditions) {
    let cur = [];
    for (const id of defaultWorn || []) cur = wearItem(cur, wardrobe, id, conditions?.[0] ?? 'Worn').outfit;
    return cur;
}

/** slotKey -> [{item, condition}] */
export function outfitBySlot(outfit, wardrobe) {
    const map = Object.fromEntries(SLOTS.map(s => [s.key, []]));
    for (const w of outfit || []) {
        const item = findItem(wardrobe, w.id);
        if (!item) continue;
        for (const s of item.slots) if (map[s]) map[s].push({ item, condition: w.condition });
    }
    return map;
}

function singular(w) { return w.length > 3 ? w.replace(/(es|s)$/, '') : w; }

/** Find a wardrobe item by id, exact name, or loosely by words ("jeans" → "Blue Jeans"), preferring the given slot. */
export function findItemLoose(wardrobe, ref, slot = null) {
    const exact = findItem(wardrobe, ref);
    if (exact) return exact;
    const n = normalize(ref);
    if (!n) return null;
    const rw = n.split(' ').map(singular);
    const match = (pool) => pool.find(i => { const nw = new Set(normalize(i.name).split(' ').map(singular)); return rw.every(w => nw.has(w)); })
        || pool.find(i => normalize(i.name).includes(n));
    const all = wardrobe || [];
    return (slot && match(all.filter(i => i.slots.includes(slot)))) || match(all) || null;
}

/**
 * Plain-language exposure summary from what is worn, e.g. "completely naked", "topless, barefoot",
 * "in underwear only". Returns '' when nothing notable is exposed.
 */
export function exposureSummary(outfit, wardrobe) {
    const by = outfitBySlot(outfit, wardrobe);
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
