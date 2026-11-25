// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Applies a parsed tracker block to the chat scene (arrivals, returns, changes, departures, new NPCs).

import { attachInstance, cloneScene, unusedTemplates } from './instances.js';
import { identityCandidates, resolveEntry } from './matching.js';
import { applyOutfitChange, normOutfitChange, resolveOutfit } from './outfit.js';
import { PROFILE_TRAIT_KEYS, profileFromEntry } from './profile.js';
import { cleanId, normalize, pickEnum, uniqueId } from './text.js';
import { closestEnum } from './enumMatch.js';

/** The placeholder id the LLM gives a new character ("to_be_allocated", "to_be_allocated_2", …; older: "generated"): replaced with the real id. */
export function isTempId(id) { return /^(?:to_be_allocated|generated)(?:[_-]?\d+)?$/.test(String(id ?? '').trim().toLowerCase()); }

function titleFromId(id) { return String(id).replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim(); }

/** True when a tracker entry says the character left the scene. */
function isLeaving(entry) {
    if (entry.left === true || entry.leave === true || entry.gone === true || entry.present === false) return true;
    return /^(left|leaves|leaving|gone|exit|exits|exited|departed)$/i.test(String(entry.left ?? entry.status ?? entry.action ?? '').trim());
}

/** True when a tracker entry says the character died ("dead": true, or a state / status / posture of dead, slain…). */
export function isDead(entry) {
    if (entry.dead === true || entry.died === true || entry.killed === true) return true;
    const word = /^(dead|died|dies|killed|slain|deceased|lifeless|corpse)$/i;
    return [entry.dead, entry.status, entry.state, entry.posture, entry.action, entry.left].some(v => v !== undefined && v !== null && typeof v !== 'object' && word.test(String(v).trim()));
}

/**
 * Apply a tracker block to the previous scene. The block lists CHANGES only:
 *   {"id": "x", "posture": "..."}          a character in the scene: only the fields that changed
 *   {"id": "x"} / {"name": "...", ...}      someone not in the scene yet arrives (known NPC, or a new one)
 *   {"id": "x", "left": true}               someone leaves
 *   {"id": "x", "dead": true}               someone dies: leaves the scene for good, the instance is marked dead (kept)
 * Characters that are not mentioned stay exactly as they were.
 * Who someone is: the chat's own instances first (active ones preferred), then templates this chat has not used yet,
 * else a new template is created. A template is only read to create an instance; after that only the instance changes.
 * Leaving only deactivates: the instance stays in the chat for when the character returns.
 * prepareNew(template, entry) may decorate a newly created template before its instance is copied from it.
 * onEntry(instance, entry, { isNew }, scene) runs last for every applied (non-leaving) entry, on the scene's own instance.
 * catalogFor(instance) → { items, strict } offers known clothing (e.g. a wardrobe) for outfit changes; without it,
 * any clothing can be worn. onCreate(instance, template) is passed on to new instances.
 * choices[i], when given, is the user's answer for list[i] (see findLookups): { link: id } uses that instance or template,
 * { create: true } makes a new NPC from the entry without matching.
 * Returns { scene, created: [template], createdEntries, skipped, log, ids } where ids[i] is the id list[i] ended up as.
 */
export function applyTracker(list, prevScene, { library, threshold, numericTolerance, postures, states, conditions = ['Worn'], autoCreate = true, traitKeys = [], excludeNames = [], maxNew = 0, prepareNew = null, onEntry = null, catalogFor = null, onCreate = null, choices = [] }) {
    const scene = cloneScene(prevScene);
    const lib = { ...(library || {}) };
    const opts = { postures, states, conditions, onCreate };
    const created = [];
    const createdEntries = [];
    const skipped = [];
    const log = [];
    const ids = [];
    const excluded = new Set(excludeNames.map(normalize).filter(Boolean));

    const items = Array.isArray(list) ? list : [];
    for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        if (!raw || typeof raw !== 'object') continue;
        const entry = { ...raw, id: cleanId(raw.id) };
        if (isTempId(entry.id)) entry.id = '';
        const nm = String(entry.name ?? '').trim();
        if (!nm && !entry.id) continue;
        if (nm && excluded.has(normalize(nm))) continue;
        const choice = choices[i] || null;

        // The user's pick wins. Otherwise: 1) the chat's own instances, 2) templates not instanced in this chat yet.
        let id = null, reason = '', score = null;
        if (choice?.link && (scene.instances[choice.link] || lib[choice.link])) { id = choice.link; reason = 'user-picked'; }
        else if (choice?.create) reason = 'user-create-new';
        else ({ id, reason, score } = resolveEntry(entry, { library: scene.instances, presentIds: scene.active, threshold, numericTolerance }));
        if (!id && !choice) {
            const t = resolveEntry(entry, { library: unusedTemplates(scene, lib), presentIds: [], threshold, numericTolerance });
            if (t.id) ({ id, score } = t), reason = `template:${t.reason}`;
        }
        if (id && isDead(entry)) {
            const at = scene.active.indexOf(id);
            if (at >= 0) scene.active.splice(at, 1);
            if (scene.instances[id]) scene.instances[id] = { ...scene.instances[id], dead: true };
            log.push({ name: nm || scene.instances[id]?.name, action: 'died', id });
            ids[i] = id;
            continue;
        }
        // a dead character doesn't walk back in (unless the entry says it's alive again)
        if (id && scene.instances[id]?.dead && entry.dead !== false && entry.alive !== true) {
            log.push({ name: nm || scene.instances[id]?.name, action: 'skipped-dead', id });
            ids[i] = id;
            continue;
        }
        if (id && scene.instances[id]?.dead) scene.instances[id] = { ...scene.instances[id], dead: false };
        if (isLeaving(entry)) {
            const at = id ? scene.active.indexOf(id) : -1;
            if (at >= 0) { scene.active.splice(at, 1); log.push({ name: nm || scene.instances[id]?.name, action: 'left', id }); }
            if (id) ids[i] = id;
            continue;
        }
        let isNew = false;
        if (!id) {
            if (!autoCreate && !choice?.create) { log.push({ name: nm, action: 'skipped', reason }); continue; }
            if (maxNew > 0 && created.length >= maxNew && !choice?.create) { skipped.push(nm || entry.id); log.push({ name: nm, action: 'skipped-limit' }); continue; }
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
        ids[i] = id;
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
        inst.posture = closestEnum(entry.posture, postures, inst.posture);
        inst.state = closestEnum(entry.state, states, inst.state);
        const feelings = entry.feelings ?? entry.thoughts;
        if (feelings !== undefined && feelings !== null && String(feelings).trim()) inst.feelings = String(feelings).trim();
        if (typeof onEntry === 'function') onEntry(inst, entry, { isNew }, scene);
    }
    return { scene, created, createdEntries, skipped, log, ids };
}

/**
 * Entries the user should decide on before the block is applied: someone the LLM brought in who is not already
 * one of this chat's instances by id (or by exact name with matching identity). Their name, role and gender are matched
 * (see identityCandidates) against this chat's instances first; only when none comes close, against library templates this chat has not used.
 * An entry marked "new": true always goes through the name match. Characters leaving, excluded names and entries
 * without a name are skipped. isSpecified(name) → true when the story named this person before (then only name matches count).
 * Returns [{ index, entry, source: 'instance' | 'template', candidates: [{ id, score }] }]
 * (only entries with at least one candidate), and `unmatched`: indexes that had a name but no candidate.
 */
export function findLookups(list, prevScene, { library, threshold, numericTolerance, excludeNames = [], minScore = 0.7, limit = 5, isSpecified = null, matcherFor = null }) {
    const scene = cloneScene(prevScene);
    const excluded = new Set(excludeNames.map(normalize).filter(Boolean));
    const lookups = [];
    const unmatched = [];
    const items = Array.isArray(list) ? list : [];
    for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        if (!raw || typeof raw !== 'object' || isLeaving(raw)) continue;
        const entry = { ...raw, id: cleanId(raw.id) };
        if (isTempId(entry.id)) entry.id = '';
        const nm = String(entry.name ?? '').trim();
        if (!nm || excluded.has(normalize(nm))) continue;
        const isNew = entry.new === true || String(entry.new).toLowerCase() === 'true';
        if (!isNew) {
            const hit = resolveEntry(entry, { library: scene.instances, presentIds: scene.active, threshold, numericTolerance });
            if (hit.id) continue;
        } else if (entry.id && scene.active.includes(entry.id)) continue; // already in the scene
        // A name the story already used (e.g. the user wrote it) is that person: only name matches, no role-only stand-ins.
        const specified = typeof isSpecified === 'function' && !!isSpecified(nm);
        // An extension library that claims the entry may match it its own way (e.g. enemies by what they are).
        const own = typeof matcherFor === 'function' ? matcherFor(raw) : null;
        const keep = (list) => (specified && !own ? list.filter(c => c.name >= minScore) : list);
        const match = own || ((e, pool) => identityCandidates(e, pool, { min: minScore, limit }));
        let candidates = keep(match(raw, scene.instances));
        let source = 'instance';
        if (!candidates.length) {
            const pool = unusedTemplates(scene, library);
            candidates = keep(match(raw, pool));
            source = 'template';
        }
        if (candidates.length) lookups.push({ index: i, entry: raw, source, candidates, specified });
        else unmatched.push(i);
    }
    return { lookups, unmatched };
}
