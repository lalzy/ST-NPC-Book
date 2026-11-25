// Starting cast: reads the "characters" block of greeting messages into the scene.

import { MODULE } from '../constants.js';
import { ctx, hasChat, meta } from '../core/context.js';
import { claimedEntryKeys, outfitCatalog, runEntryHooks, transformEntry } from '../core/extHooks.js';
import { lib, settings } from '../core/settings.js';
import { allTemplates } from '../core/libraries.js';
import { clone, esc, sig } from '../core/utils.js';
import { applyCastOverrides, extractCharacterList } from '../logic/castList.js';
import { attachInstance, cloneScene, toScene } from '../logic/instances.js';
import { resolveOutfit } from '../logic/outfit.js';
import { resolveRef } from '../logic/matching.js';
import { normalize } from '../logic/text.js';
import { personaData, userBefore } from '../scene/persona.js';
import { instanceOpts, snapOf } from '../scene/roster.js';
import { decorateAll } from '../speakers/decorate.js';
import { renderRoster } from '../ui/roster/rosterBar.js';

/**
 * Reads a `{"characters": [{"id": ..., overrides}]}` JSON block from the greeting(s) at the start of the chat and puts them in the scene.
 * Overrides (posture, state, feelings, clothing / slot keys) replace the card defaults for this intro only.
 */
export async function processGreetings() {
    const s = settings();
    if (!s.enabled || !hasChat()) return;
    const c = ctx();
    const chat = c.chat || [];
    let changed = false;
    let carried = toScene(meta()?.base);
    const notes = { missing: new Set(), warnings: new Set(), errors: new Set() };
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_user) break;
        if (msg.is_system) continue;
        const texts = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [msg.mes];
        const cur = msg.swipe_id ?? 0;
        let msgChanged = false;
        for (let k = 0; k < texts.length; k++) {
            const ex = extractCharacterList(texts[k]);
            if (!ex.found) continue;
            if (ex.error) { console.warn('[NPC Book] intro cast block:', ex.error); notes.errors.add(ex.error); }
            if (ex.cleaned === texts[k]) continue; // block could not be read and was left in place
            const preUser = userBefore(i);
            const cast = applyIntroCast(ex.entries, carried, preUser, notes);
            const snap = { pre: clone(carried), post: clone(cast.scene), preUser: clone(preUser), postUser: clone(cast.user), raw: null, sig: sig(ex.cleaned), greeting: true };
            if (Array.isArray(msg.swipes) && msg.swipes.length) msg.swipes[k] = ex.cleaned;
            if (Array.isArray(msg.swipe_info)) {
                msg.swipe_info[k] = msg.swipe_info[k] || {};
                msg.swipe_info[k].extra = msg.swipe_info[k].extra || {};
                msg.swipe_info[k].extra[MODULE] = clone(snap);
            }
            if (k === cur) {
                msg.mes = ex.cleaned;
                msg.extra = msg.extra || {};
                msg.extra[MODULE] = snap;
            }
            msgChanged = true;
        }
        if (msgChanged) {
            changed = true;
            try { c.updateMessageBlock(i, msg); } catch (e) { /* not rendered yet */ }
        }
        const sn = snapOf(msg);
        if (sn?.post) carried = toScene(sn.post);
    }
    if (notes.missing.size) toastr.warning(`Not in the NPC Library: ${[...notes.missing].join(', ')}`, 'NPC Book');
    if (notes.errors.size) toastr.error(`Could not read the intro characters block: ${[...notes.errors].join('; ')}`, 'NPC Book');
    if (notes.warnings.size) {
        console.warn('[NPC Book] intro cast:', [...notes.warnings]);
        toastr.warning([...notes.warnings].map(esc).join('<br>'), 'NPC Book: intro cast', { escapeHtml: false });
    }
    if (changed) {
        await c.saveChat?.();
        renderRoster();
        decorateAll();
    }
}

const IN_SCENE_KEYS = ['in_scene', 'inscene', 'present'];

/** true / false from a JSON value (booleans, "yes"/"no", "in"/"out", 1/0), else null. */
function parseBool(v) {
    if (typeof v === 'boolean') return v;
    const n = String(v ?? '').trim().toLowerCase();
    if (['true', 'yes', 'in', 'in_scene', 'in-scene', '1', 'present'].includes(n)) return true;
    if (['false', 'no', 'out', 'not_in_scene', 'not-in-scene', '0', 'absent'].includes(n)) return false;
    return null;
}

function isUserRef(ref) {
    const n = normalize(ref);
    const name1 = normalize(ctx().name1);
    return ['user', 'you', 'persona'].includes(n) || (!!name1 && n === name1 && !allTemplates()[String(ref).trim().toLowerCase()]);
}

/**
 * Build the scene for an intro message from its cast entries [{ref, overrides}].
 * Each NPC is the chat's instance if it has one, else a new instance from its template; overrides replace parts of that.
 * Clothing named in an override is worn as written (or matched to a sister extension's catalog, e.g. a wardrobe).
 */
function applyIntroCast(entries, carried, user, notes) {
    const s = settings();
    const opts = { postures: s.postures, states: s.states, conditions: s.conditions };
    const scene = cloneScene(carried);
    let u = clone(user);
    const claimed = claimedEntryKeys();
    for (const raw of entries || []) {
        // Sister extensions may rewrite or drop a cast entry (transformEntry), and keys they claim (entryKeys) are theirs:
        // NPC Book does not warn about them. With no extensions this is the entry as written.
        const full = transformEntry({ id: raw.ref, ...raw.overrides }, { source: 'greeting', messageIndex: null });
        if (!full) continue;
        const { id: ref, ...rest } = full;
        const e = { ref: String(ref ?? raw.ref), overrides: Object.fromEntries(Object.entries(rest).filter(([k]) => !claimed.has(k.toLowerCase()))) };
        if (isUserRef(e.ref)) {
            // "in_scene": false starts the scene without the user (also "in-scene", "inScene", "present"). Leave it out to keep them in.
            const sceneKey = Object.keys(e.overrides).find(k => IN_SCENE_KEYS.includes(k.toLowerCase().replace(/[-\s]/g, '_')));
            if (sceneKey !== undefined) {
                const v = parseBool(e.overrides[sceneKey]);
                if (v === null) notes.warnings.add(`${ctx().name1}: "${sceneKey}" should be true or false`);
                else u = { ...u, absent: !v };
                delete e.overrides[sceneKey];
            }
            const p = personaData();
            const worn = resolveOutfit(u.outfit, p.wardrobe || []);
            const cat = outfitCatalog({ source: 'greeting', kind: 'user', id: 'user', subject: p, ext: { ...(p.ext || {}), ...(u.ext || {}) } });
            const r = applyCastOverrides({ posture: u.posture, outfit: worn }, e.overrides, { ...opts, catalog: cat.items, strict: cat.strict });
            const outfitChanged = JSON.stringify(r.instance.outfit) !== JSON.stringify(worn);
            u = { ...u, posture: r.instance.posture, outfit: r.instance.outfit, dressed: u.dressed || outfitChanged };
            r.warnings.forEach(w => notes.warnings.add(`${ctx().name1}: ${w}`));
            runEntryHooks({ kind: 'user', source: 'greeting', id: 'user', name: ctx().name1, entry: full, isNew: false, user: u },
                (x) => u.ext?.[x] ?? personaData().ext?.[x],
                (x, d) => { u.ext = { ...(u.ext || {}), [x]: d }; });
            continue;
        }
        const id = resolveRef(e.ref, scene.instances) ?? resolveRef(e.ref, allTemplates());
        const inst = id ? attachInstance(scene, id, allTemplates(), instanceOpts()) : null;
        if (!inst) { notes.missing.add(e.ref); continue; }
        const cat = outfitCatalog({ source: 'greeting', kind: 'char', id: inst.id, subject: inst, ext: inst.ext || {} });
        const r = applyCastOverrides({ ...inst, outfit: resolveOutfit(inst.outfit, inst.wardrobe || []) }, e.overrides, { ...opts, catalog: cat.items, strict: cat.strict });
        if (JSON.stringify(r.instance.outfit) !== JSON.stringify(inst.outfit)) r.instance.dressed = true;
        Object.assign(inst, r.instance);
        r.warnings.forEach(w => notes.warnings.add(`${inst.name}: ${w}`));
        runEntryHooks({ kind: 'char', source: 'greeting', id: inst.id, name: inst.name, entry: full, isNew: false, instance: inst },
            (x) => inst.ext?.[x],
            (x, d) => { inst.ext = inst.ext || {}; inst.ext[x] = d; });
    }
    return { scene, user: u };
}
