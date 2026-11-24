// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Applies a parsed tracker block to the scene roster (arrivals, changes, departures, new NPCs).

import { resolveEntry } from './matching.js';
import { applyOutfitChange, buildWardrobe, normOutfitChange, outfitFromDefault } from './outfit.js';
import { PROFILE_TRAIT_KEYS, profileFromEntry } from './profile.js';
import { cleanId, normalize, pickEnum, uniqueId } from './text.js';

function titleFromId(id) { return String(id).replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim(); }

/** True when a tracker entry says the character left the scene. */
function isLeaving(entry) {
    if (entry.left === true || entry.leave === true || entry.gone === true || entry.present === false) return true;
    return /^(left|leaves|leaving|gone|exit|exits|exited|departed)$/i.test(String(entry.left ?? entry.status ?? entry.action ?? '').trim());
}

/**
 * Apply a tracker block to the previous roster. The block lists CHANGES only:
 *   {"id": "x", "posture": "..."}          a character in the scene: only the fields that changed
 *   {"id": "x"} / {"name": "...", ...}      someone not in the scene yet arrives (known NPC, or a new one)
 *   {"id": "x", "left": true}               someone leaves
 * Characters that are not mentioned stay exactly as they were.
 * Returns { roster, created: [template], updated: [template], log: [] }.
 */
export function applyTracker(list, prevRoster, { library, threshold, numericTolerance, postures, states, conditions = ['Worn'], allowWardrobeGrowth = false, autoCreate = true, traitKeys = [], excludeNames = [], maxNew = 0 }) {
    const prev = Array.isArray(prevRoster) ? prevRoster : [];
    const presentIds = prev.map(i => i.id);
    const lib = { ...(library || {}) };
    const created = [];
    const createdEntries = [];
    const updated = [];
    const skipped = [];
    const log = [];
    const roster = prev.map(i => ({ ...i, outfit: (i.outfit || []).map(w => ({ ...w })) }));
    const excluded = new Set(excludeNames.map(normalize).filter(Boolean));

    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = { ...raw, id: cleanId(raw.id) };
        const nm = String(entry.name ?? '').trim();
        if (!nm && !entry.id) continue;
        if (nm && excluded.has(normalize(nm))) continue;

        let { id, reason, score } = resolveEntry(entry, { library: lib, presentIds, threshold, numericTolerance });
        if (isLeaving(entry)) {
            const at = id ? roster.findIndex(i => i.id === id) : -1;
            if (at >= 0) { roster.splice(at, 1); log.push({ name: nm || lib[id]?.name, action: 'left', id }); }
            continue;
        }
        if (!id) {
            if (!autoCreate) { log.push({ name: nm, action: 'skipped', reason }); continue; }
            if (maxNew > 0 && created.length >= maxNew) { skipped.push(nm || entry.id); log.push({ name: nm, action: 'skipped-limit' }); continue; }
            const newId = uniqueId(entry.id || nm, x => !!lib[x]);
            const traits = {};
            for (const k of traitKeys) traits[k] = '';
            for (const [k, v] of Object.entries(entry.traits || {})) {
                const key = normalize(k).replace(/\s+/g, '_');
                if (PROFILE_TRAIT_KEYS.has(key)) continue; // stored as card fields, not identity traits
                traits[key] = String(v ?? '');
            }
            const wb = buildWardrobe(entry.wardrobe);
            const initial = applyOutfitChange([], wb.wardrobe, normOutfitChange(entry), conditions).outfit;
            const t = {
                id: newId,
                name: nm || titleFromId(newId),
                portrait: '',
                description: String(entry.description ?? '').trim(),
                details: String(entry.details ?? entry.description ?? '').trim(),
                traits,
                ...profileFromEntry(entry),
                wardrobe: wb.wardrobe,
                defaultWorn: initial.map(w => w.id),
                auto: true,
                created: Date.now(),
            };
            lib[newId] = t;
            created.push(t); createdEntries.push(entry);
            id = newId;
            log.push({ name: t.name, action: 'created', id, reason });
        }
        const isNew = created.some(c => c.id === id);
        const tpl = lib[id];
        if (tpl && allowWardrobeGrowth && Array.isArray(entry.wardrobe) && !isNew) {
            const grown = buildWardrobe(entry.wardrobe, tpl.wardrobe || []);
            if (grown.added.length) { lib[id] = { ...tpl, wardrobe: grown.wardrobe }; updated.push(lib[id]); }
        }
        const wardrobe = lib[id]?.wardrobe || [];
        let inst = roster.find(i => i.id === id);
        if (!inst) {
            inst = { outfit: outfitFromDefault(lib[id]?.defaultWorn, wardrobe, conditions), id, name: lib[id]?.name ?? nm, posture: postures?.[0] ?? '', state: states?.[0] ?? '', feelings: '' };
            roster.push(inst);
            if (!isNew) log.push({ name: inst.name, action: 'arrived', id, reason, score });
        } else {
            log.push({ name: inst.name, action: 'changed', id });
        }
        if (!isNew) {
            const oc = applyOutfitChange(inst.outfit, wardrobe, normOutfitChange(entry), conditions);
            inst.outfit = oc.outfit;
            if (oc.rejected.length) log.push({ name: inst.name, action: 'outfit-rejected', items: oc.rejected });
        }
        inst.posture = pickEnum(entry.posture, postures, inst.posture);
        inst.state = pickEnum(entry.state, states, inst.state);
        const feelings = entry.feelings ?? entry.thoughts;
        if (feelings !== undefined && feelings !== null && String(feelings).trim()) inst.feelings = String(feelings).trim();
    }
    return { roster, created, createdEntries, skipped, updated: updated.filter(u => !created.some(c => c.id === u.id)), log };
}
