// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Applies a parsed tracker block to the chat scene (arrivals, returns, changes, departures, new NPCs).

import { attachInstance, cloneScene, unusedTemplates } from './instances.js';
import { resolveEntry } from './matching.js';
import { applyOutfitChange, normOutfitChange, resolveOutfit } from './outfit.js';
import { PROFILE_TRAIT_KEYS, profileFromEntry } from './profile.js';
import { cleanId, normalize, pickEnum, uniqueId } from './text.js';

function titleFromId(id) { return String(id).replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim(); }

/** True when a tracker entry says the character left the scene. */
function isLeaving(entry) {
    if (entry.left === true || entry.leave === true || entry.gone === true || entry.present === false) return true;
    return /^(left|leaves|leaving|gone|exit|exits|exited|departed)$/i.test(String(entry.left ?? entry.status ?? entry.action ?? '').trim());
}

/**
 * Apply a tracker block to the previous scene. The block lists CHANGES only:
 *   {"id": "x", "posture": "..."}          a character in the scene: only the fields that changed
 *   {"id": "x"} / {"name": "...", ...}      someone not in the scene yet arrives (known NPC, or a new one)
 *   {"id": "x", "left": true}               someone leaves
 * Characters that are not mentioned stay exactly as they were.
 * Who someone is: the chat's own instances first (active ones preferred), then templates this chat has not used yet,
 * else a new template is created. A template is only read to create an instance; after that only the instance changes.
 * Leaving only deactivates: the instance stays in the chat for when the character returns.
 * prepareNew(template, entry) may decorate a newly created template before its instance is copied from it.
 * onEntry(instance, entry, { isNew }, scene) runs last for every applied (non-leaving) entry, on the scene's own instance.
 * catalogFor(instance) → { items, strict } offers known clothing (e.g. a wardrobe) for outfit changes; without it,
 * any clothing can be worn. onCreate(instance, template) is passed on to new instances.
 * Returns { scene, created: [template], createdEntries, skipped, log }.
 */
export function applyTracker(list, prevScene, { library, threshold, numericTolerance, postures, states, conditions = ['Worn'], autoCreate = true, traitKeys = [], excludeNames = [], maxNew = 0, prepareNew = null, onEntry = null, catalogFor = null, onCreate = null }) {
    const scene = cloneScene(prevScene);
    const lib = { ...(library || {}) };
    const opts = { postures, states, conditions, onCreate };
    const created = [];
    const createdEntries = [];
    const skipped = [];
    const log = [];
    const excluded = new Set(excludeNames.map(normalize).filter(Boolean));

    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = { ...raw, id: cleanId(raw.id) };
        const nm = String(entry.name ?? '').trim();
        if (!nm && !entry.id) continue;
        if (nm && excluded.has(normalize(nm))) continue;

        // 1) the chat's own instances, 2) templates not instanced in this chat yet
        let { id, reason, score } = resolveEntry(entry, { library: scene.instances, presentIds: scene.active, threshold, numericTolerance });
        if (!id) {
            const t = resolveEntry(entry, { library: unusedTemplates(scene, lib), presentIds: [], threshold, numericTolerance });
            if (t.id) ({ id, score } = t), reason = `template:${t.reason}`;
        }
        if (isLeaving(entry)) {
            const at = id ? scene.active.indexOf(id) : -1;
            if (at >= 0) { scene.active.splice(at, 1); log.push({ name: nm || scene.instances[id]?.name, action: 'left', id }); }
            continue;
        }
        let isNew = false;
        if (!id) {
            if (!autoCreate) { log.push({ name: nm, action: 'skipped', reason }); continue; }
            if (maxNew > 0 && created.length >= maxNew) { skipped.push(nm || entry.id); log.push({ name: nm, action: 'skipped-limit' }); continue; }
            const newId = uniqueId(entry.id || nm, x => !!lib[x] || !!scene.instances[x]);
            const traits = {};
            for (const k of traitKeys) traits[k] = '';
            for (const [k, v] of Object.entries(entry.traits || {})) {
                const key = normalize(k).replace(/\s+/g, '_');
                if (PROFILE_TRAIT_KEYS.has(key)) continue; // stored as card fields, not identity traits
                traits[key] = String(v ?? '');
            }
            // What they wear now: any clothing (a sister extension may have rewritten the entry to match its catalog).
            const initial = applyOutfitChange([], normOutfitChange(entry), { conditions }).outfit;
            const t = {
                id: newId,
                name: nm || titleFromId(newId),
                portrait: '',
                description: String(entry.description ?? '').trim(),
                details: String(entry.details ?? entry.description ?? '').trim(),
                traits,
                ...profileFromEntry(entry),
                outfit: initial,
                ...(normOutfitChange(entry) ? { dressed: true } : {}),
                auto: true,
                created: Date.now(),
            };
            if (typeof prepareNew === 'function') prepareNew(t, entry);
            lib[newId] = t;
            created.push(t); createdEntries.push(entry);
            id = newId;
            isNew = true;
            log.push({ name: t.name, action: 'created', id, reason });
        }
        const hadInstance = !!scene.instances[id];
        const wasActive = scene.active.includes(id);
        const inst = attachInstance(scene, id, lib, opts);
        if (!inst) continue;
        if (!isNew) {
            if (!wasActive) log.push({ name: inst.name, action: hadInstance ? 'returned' : 'arrived', id, reason, score });
            else log.push({ name: inst.name, action: 'changed', id });
            const cat = typeof catalogFor === 'function' ? (catalogFor(inst) || {}) : {};
            const oc = applyOutfitChange(resolveOutfit(inst.outfit, inst.wardrobe || []), normOutfitChange(entry), { conditions, catalog: cat.items || [], strict: !!cat.strict });
            inst.outfit = oc.outfit;
            if (normOutfitChange(entry)) inst.dressed = true; // clothing was set (even to nothing): always report it
            if (oc.created.length) log.push({ name: inst.name, action: 'clothing-new', id, items: oc.created.map(x => x.name) });
            if (oc.rejected.length) log.push({ name: inst.name, action: 'outfit-rejected', items: oc.rejected });
        }
        inst.posture = pickEnum(entry.posture, postures, inst.posture);
        inst.state = pickEnum(entry.state, states, inst.state);
        const feelings = entry.feelings ?? entry.thoughts;
        if (feelings !== undefined && feelings !== null && String(feelings).trim()) inst.feelings = String(feelings).trim();
        if (typeof onEntry === 'function') onEntry(inst, entry, { isNew }, scene);
    }
    return { scene, created, createdEntries, skipped, log };
}
