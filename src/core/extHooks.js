// Calls into registered sister extensions. Every call is guarded: a failing extension is logged and skipped,
// so it can never break NPC Book itself. With no extensions registered, every helper is a no-op.

import { customFields, fieldsFromEntry, mergeFieldValues } from './fields.js';
import { extensions } from './runtime.js';

/** Registered extensions that define `hook` as a function, in registration order. */
export function extsWith(hook) {
    return [...extensions.values()].filter(x => typeof x?.[hook] === 'function');
}

/** Call ext[hook](...args); on error log it and return undefined. */
export function callExt(ext, hook, ...args) {
    try { return ext[hook](...args); } catch (e) { console.warn(`[NPC Book] extension ${ext.id} ${hook} failed`, e); return undefined; }
}

/**
 * Pass `value` through every extension's `hook` in registration order. Each one gets the previous result and returns the
 * new value; returning undefined keeps the value as it was.
 */
export function pipe(hook, value, ...args) {
    let v = value;
    for (const ext of extsWith(hook)) {
        const r = callExt(ext, hook, v, ...args);
        if (r !== undefined) v = r;
    }
    return v;
}

/** Entry keys claimed by extensions (def.entryKeys), normalized to lower case. */
export function claimedEntryKeys() {
    const out = new Set();
    for (const ext of extensions.values()) for (const k of Array.isArray(ext?.entryKeys) ? ext.entryKeys : []) out.add(String(k).toLowerCase());
    for (const f of customFields()) out.add(f.prompt.toLowerCase()); // fields (API 12) are read by NPC Book itself
    return out;
}

/**
 * Let every extension with onTrackerEntry read one tracker / greeting entry and update its own data for that character.
 * `getData(extId)` returns the stored data (or undefined); `setData(extId, data)` stores a new value.
 * The hook gets a copy of the data; returning undefined leaves the stored data alone.
 */
export function runEntryHooks(info, getData, setData) {
    // Fields (registerExtension({ fields }), API 12): values the LLM wrote under a field's prompt name go into that
    // extension's data first, so its own onTrackerEntry already sees them. NPC characters only.
    if (info.kind === 'char') {
        for (const [extId, patch] of Object.entries(fieldsFromEntry(info.entry))) {
            const cur = getData(extId);
            const box = { [extId]: cur === undefined || cur === null ? {} : JSON.parse(JSON.stringify(cur)) };
            setData(extId, mergeFieldValues(box, { [extId]: patch })[extId]);
        }
    }
    for (const ext of extsWith('onTrackerEntry')) {
        const cur = getData(ext.id);
        const data = cur === undefined || cur === null ? null : JSON.parse(JSON.stringify(cur));
        const r = callExt(ext, 'onTrackerEntry', { ...info, data });
        if (r !== undefined) setData(ext.id, r);
    }
}

/**
 * One tracker / greeting entry through every extension's transformEntry(entry, info), in registration order.
 * Returning a new object replaces the entry, undefined keeps it, null drops it. Returns the entry or null.
 */
export function transformEntry(entry, info) {
    let v = entry;
    for (const ext of extsWith('transformEntry')) {
        const r = callExt(ext, 'transformEntry', v, info);
        if (r === null) return null;
        if (r !== undefined) v = r;
    }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** A list of entries through transformEntry. The same array when no extension defines it. */
export function transformEntries(list, info) {
    if (!Array.isArray(list) || !extsWith('transformEntry').length) return list;
    return list.map(e => (e && typeof e === 'object' ? transformEntry(e, info) : e)).filter(e => e !== null);
}

/**
 * Known clothing for one character, from every extension's outfitCatalog(ctx) (e.g. a wardrobe).
 * ctx = { source: 'tracker' | 'greeting' | 'editor', kind: 'char' | 'user', id, subject, ext? } where `ext` is the character's ext data being edited (a draft in
 * editors) and `subject` the stored character. Returns { items, strict, actions: [{ extId, label, icon, run? }] }.
 * Without extensions: no items, not strict (any clothing can be worn), no actions.
 */
export function outfitCatalog(ctx) {
    const out = { items: [], strict: false, actions: [] };
    for (const ext of extsWith('outfitCatalog')) {
        const r = callExt(ext, 'outfitCatalog', ctx);
        if (!r || typeof r !== 'object') continue;
        for (const it of Array.isArray(r.items) ? r.items : []) if (it?.name && !out.items.some(x => x.id === it.id)) out.items.push(it);
        if (r.strict) out.strict = true;
        // An "Edit …" button under the paperdoll: opens this extension's sheet for the character (or calls onEdit).
        if (r.editLabel || typeof r.onEdit === 'function') out.actions.push({ extId: ext.id, label: String(r.editLabel || `Edit ${ext.label || ext.id}`), icon: String(r.editIcon || 'fa-shirt'), run: typeof r.onEdit === 'function' ? r.onEdit : null });
    }
    return out;
}

/** Let extensions set up their data on a new chat instance (onInstanceCreate). Mutates the instance. */
export function instanceCreated(inst, template) {
    for (const ext of extsWith('onInstanceCreate')) {
        const cur = inst.ext?.[ext.id];
        const data = cur === undefined || cur === null ? null : JSON.parse(JSON.stringify(cur));
        const r = callExt(ext, 'onInstanceCreate', { instance: inst, template, data });
        if (r !== undefined) { inst.ext = inst.ext || {}; inst.ext[ext.id] = r; }
    }
}

/** Tell an extension's cardTab / personaSheet that NPC Book stored its data (onSave). */
export function sheetSaved(ext, part, info) {
    if (typeof ext?.[part]?.onSave !== 'function') return;
    try { ext[part].onSave(info); } catch (e) { console.warn(`[NPC Book] extension ${ext.id} ${part}.onSave failed`, e); }
}
