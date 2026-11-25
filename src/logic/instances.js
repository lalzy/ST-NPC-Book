// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Chat scene model: instances owned by the chat, and the list of which ones are active.
//
//   Template  = NPC Library card: a blueprint, only read when a chat first needs that NPC.
//   Instance  = the chat's own full copy of a template (card fields, ext data + live state incl. outfit). Drifts freely.
//   Active    = ids of the instances in the scene right now (what is sent to the LLM). Holds no data.
//
// Scene shape: { instances: { [id]: Instance }, active: [id] }

import { startingOutfit } from './outfit.js';

/**
 * Template-only fields, not copied into an instance: library bookkeeping, and the starting outfit
 * (it becomes the instance's current outfit once; after that the instance only has what it wears now).
 */
export const TEMPLATE_ONLY_KEYS = ['folder', 'auto', 'created', 'updated', 'defaultWorn'];

export function emptyScene() { return { instances: {}, active: [] }; }

/** True when a value is a scene object (not a legacy roster array). */
export function isScene(x) { return !!x && typeof x === 'object' && !Array.isArray(x) && x.instances && typeof x.instances === 'object' && Array.isArray(x.active); }

/** Any stored scene value → scene. Legacy roster arrays become a scene whose instances are the listed (active) entries. */
export function toScene(x) {
    if (isScene(x)) return x;
    if (Array.isArray(x)) {
        const instances = {};
        for (const i of x) if (i?.id) instances[i.id] = i;
        return { instances, active: x.filter(i => i?.id).map(i => i.id) };
    }
    return emptyScene();
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
    const outfit = startingOutfit(template, conditions);
    const inst = {
        ...card,
        instanceOf: template.id,
        posture: postures[0] ?? '',
        state: states[0] ?? '',
        feelings: '',
        outfit,
        dressed: outfit.length > 0 || !!template.dressed,
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
