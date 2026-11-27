// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Chat scene model: instances owned by the chat, and the list of which ones are active.
//
//   Template  = NPC Library card: a blueprint, only read when a chat first needs that NPC.
//   Instance  = the chat's own full copy of a template (card fields, ext data + live state incl. outfit). Drifts freely.
//               It remembers a fingerprint of the template's card fields (templateSync), so a later change to the
//               template can be shown and pulled in on request (syncFromTemplate). Nothing is pulled in by itself.
//   Active    = ids of the instances in the scene right now (what is sent to the LLM). Holds no data.
//
// Scene shape: { instances: { [id]: Instance }, active: [id] }

import { startingOutfit } from './outfit.js';

/**
 * Template-only fields, not copied into an instance: library bookkeeping, and the starting outfit
 * (it becomes the instance's current outfit once; after that the instance only has what it wears now).
 */
export const TEMPLATE_ONLY_KEYS = ['folder', 'auto', 'created', 'updated'];

export function emptyScene() { return { instances: {}, active: [] }; }

/** True when a value is a scene object. */
export function isScene(x) { return !!x && typeof x === 'object' && !Array.isArray(x) && x.instances && typeof x.instances === 'object' && Array.isArray(x.active); }

/** Any stored scene value → scene (anything else: an empty scene). */
export function toScene(x) {
    return isScene(x) ? x : emptyScene();
}

export function cloneScene(x) { return JSON.parse(JSON.stringify(toScene(x))); }

/** Active instances in scene order (missing ids are skipped). */
export function activeInstances(scene) {
    const sc = toScene(scene);
    return sc.active.map(id => sc.instances[id]).filter(Boolean);
}

/**
 * A new instance: a 1:1 copy of the template at this moment, plus the starting live state.
 * onCreate(instance, template), if given, may adjust it (sister extensions set up their per-chat data there).
 */
export function instanceFromTemplate(template, { postures = [], states = [], conditions = ['Worn'], onCreate = null } = {}) {
    const card = JSON.parse(JSON.stringify(template));
    for (const k of TEMPLATE_ONLY_KEYS) delete card[k];
    const outfit = startingOutfit(template);
    const inst = {
        ...card,
        instanceOf: template.id,
        posture: postures[0] ?? '',
        state: states[0] ?? '',
        feelings: '',
        outfit,
        dressed: outfit.length > 0 || !!template.dressed,
        templateSync: templateFingerprints(template),
    };
    if (typeof onCreate === 'function') onCreate(inst, template);
    return inst;
}

/**
 * Make sure the scene has an instance for `id` (the chat's own first, else a new one from the template) and that it is active.
 * Mutates the scene. Returns the instance, or null when there is neither an instance nor a template.
 */
export function attachInstance(scene, id, library, opts) {
    let inst = scene.instances[id];
    if (!inst) {
        const t = (library || {})[id];
        if (!t) return null;
        inst = instanceFromTemplate(t, opts);
        scene.instances[id] = inst;
    }
    if (!scene.active.includes(id)) scene.active.push(id);
    return inst;
}

/** Templates that this scene has not instanced yet (the only templates a chat may still draw from). */
export function unusedTemplates(scene, library) {
    const sc = toScene(scene);
    return Object.fromEntries(Object.entries(library || {}).filter(([id]) => !sc.instances[id]));
}

/* ---------- Template changes and sync ---------- */

/**
 * Card fields an instance can pull from its template, in groups (what the sync dialog lists).
 * Each sister extension's data on the card (template.ext[id], e.g. a wardrobe) is one more group, keyed `ext:<id>`.
 * Live state (posture, state, feelings, current outfit, dead) is never part of a sync.
 */
export const SYNC_GROUPS = [
    { key: 'name', label: 'Name', fields: ['name'] },
    { key: 'portrait', label: 'Portrait', fields: ['portrait'] },
    { key: 'color', label: 'Dialogue color', fields: ['color'] },
    { key: 'description', label: 'Description', fields: ['description'] },
    { key: 'details', label: 'Details', fields: ['details'] },
    { key: 'dialogue', label: 'Dialogue examples', fields: ['dialogue'] },
    { key: 'traits', label: 'Identity', fields: ['traits'] },
    { key: 'profile', label: 'Profile (height, pronouns, sexuality, experience)', fields: ['height', 'pronouns', 'sexuality', 'sexualExperience'] },
];

/** Empty values ('' / [] / {} / null / missing) count as the same thing. */
function norm(v) {
    if (v === undefined || v === null || v === '') return null;
    if (Array.isArray(v)) return v.length ? v : null;
    if (typeof v === 'object') {
        const keys = Object.keys(v).sort();
        if (!keys.length) return null;
        const out = {};
        for (const k of keys) out[k] = v[k];
        return out;
    }
    return v;
}

/** Short FNV-1a hash of a value (stable key order at the top level). */
function hashOf(v) {
    const str = JSON.stringify(norm(v));
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

/** The value of one sync group on a card or instance. */
function groupValue(card, key) {
    if (key.startsWith('ext:')) return card?.ext?.[key.slice(4)];
    const g = SYNC_GROUPS.find(x => x.key === key);
    if (!g) return undefined;
    if (g.fields.length === 1) return card?.[g.fields[0]];
    return Object.fromEntries(g.fields.map(f => [f, norm(card?.[f])]));
}

/** Every sync group key that applies to this template (fixed groups + one per extension data entry). */
export function syncKeys(template) {
    return [...SYNC_GROUPS.map(g => g.key), ...Object.keys(template?.ext || {}).map(id => `ext:${id}`)];
}

/** { groupKey: hash } of a template's card fields, as an instance stores it (templateSync). */
export function templateFingerprints(template) {
    return Object.fromEntries(syncKeys(template).map(k => [k, hashOf(groupValue(template, k))]));
}

/**
 * Sync groups where the template changed since the instance was made or last synced.
 * A group missing from the fingerprint was empty on the template then.
 */
export function templateChanges(inst, template) {
    if (!inst || !template) return [];
    const seen = inst.templateSync || {};
    const keys = new Set([...syncKeys(template), ...Object.keys(seen || {}).filter(k => k.startsWith('ext:'))]);
    const out = [];
    for (const k of keys) {
        const now = hashOf(groupValue(template, k));
        const before = seen[k] ?? hashOf(undefined);
        if (now !== before) out.push(k);
    }
    return out;
}

/**
 * Pull the chosen groups from the template into the instance (mutates it). Other fields and live state are kept.
 * Every group in `reviewed` (default: the chosen ones) is marked as seen, so it stops showing as changed.
 */
export function syncFromTemplate(inst, template, keys, reviewed = keys) {
    if (!inst || !template) return inst;
    for (const k of keys || []) {
        if (k.startsWith('ext:')) {
            const id = k.slice(4);
            const v = template.ext?.[id];
            inst.ext = { ...(inst.ext || {}) };
            if (v === undefined) delete inst.ext[id]; else inst.ext[id] = JSON.parse(JSON.stringify(v));
            continue;
        }
        const g = SYNC_GROUPS.find(x => x.key === k);
        if (!g) continue;
        for (const f of g.fields) {
            if (template[f] === undefined) delete inst[f];
            else inst[f] = JSON.parse(JSON.stringify(template[f]));
        }
    }
    const fp = templateFingerprints(template);
    const sync = { ...(inst.templateSync || {}) };
    for (const k of new Set([...(keys || []), ...(reviewed || [])])) {
        if (fp[k] !== undefined) sync[k] = fp[k]; else delete sync[k];
    }
    inst.templateSync = sync;
    return inst;
}
