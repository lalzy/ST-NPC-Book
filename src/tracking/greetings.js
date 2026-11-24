// Starting cast: reads the "characters" block of greeting messages into the scene.

import { MODULE } from '../constants.js';
import { ctx, hasChat, meta } from '../core/context.js';
import { lib, save, settings } from '../core/settings.js';
import { clone, esc, sig } from '../core/utils.js';
import { applyCastOverrides, extractCharacterList } from '../logic/castList.js';
import { attachInstance, cloneScene, toScene } from '../logic/instances.js';
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
    const notes = { missing: new Set(), added: [], warnings: new Set(), errors: new Set() };
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
    if (notes.added.length) {
        save(); // persona wardrobe additions live in settings; NPC additions are in the chat's instances
        toastr.info(`Added to wardrobe: ${notes.added.join('; ')}`, 'NPC Book');
    }
    if (changed) {
        await c.saveChat?.();
        renderRoster();
        decorateAll();
    }
}

function isUserRef(ref) {
    const n = normalize(ref);
    const name1 = normalize(ctx().name1);
    return ['user', 'you', 'persona'].includes(n) || (!!name1 && n === name1 && !lib()[String(ref).trim().toLowerCase()]);
}

/**
 * Build the scene for an intro message from its cast entries [{ref, overrides}].
 * Each NPC is the chat's instance if it has one, else a new instance from its template; overrides replace parts of that.
 * Clothing named in an override but missing from the wardrobe is added to the instance's wardrobe (never the template's).
 */
function applyIntroCast(entries, carried, user, notes) {
    const s = settings();
    const opts = { postures: s.postures, states: s.states, conditions: s.conditions };
    const scene = cloneScene(carried);
    let u = clone(user);
    for (const e of entries || []) {
        if (isUserRef(e.ref)) {
            const p = personaData();
            const r = applyCastOverrides({ posture: u.posture, outfit: u.outfit || [] }, e.overrides, { ...opts, wardrobe: p.wardrobe });
            const outfitChanged = JSON.stringify(r.instance.outfit) !== JSON.stringify(u.outfit || []);
            u = { ...u, posture: r.instance.posture, outfit: r.instance.outfit, dressed: u.dressed || outfitChanged };
            if (r.added.length) { p.wardrobe = r.wardrobe; notes.added.push(`${ctx().name1}: ${r.added.map(x => x.name).join(', ')}`); }
            r.warnings.forEach(w => notes.warnings.add(`${ctx().name1}: ${w}`));
            continue;
        }
        const id = resolveRef(e.ref, scene.instances) ?? resolveRef(e.ref, lib());
        const inst = id ? attachInstance(scene, id, lib(), instanceOpts()) : null;
        if (!inst) { notes.missing.add(e.ref); continue; }
        const r = applyCastOverrides(inst, e.overrides, { ...opts, wardrobe: inst.wardrobe || [] });
        Object.assign(inst, r.instance);
        inst.wardrobe = r.wardrobe;
        if (r.added.length) notes.added.push(`${inst.name}: ${r.added.map(x => x.name).join(', ')}`);
        r.warnings.forEach(w => notes.warnings.add(`${inst.name}: ${w}`));
    }
    return { scene, user: u };
}
