// Generation hooks: capture the scene before a reply, then apply the reply's <npcs> block.

import { MODULE } from '../constants.js';
import { ctx, excludedNames, meta } from '../core/context.js';
import { normFolder, registerFolder } from '../core/folders.js';
import { pickColor } from '../core/npcs.js';
import { extensions, runtime } from '../core/runtime.js';
import { lib, save, settings } from '../core/settings.js';
import { clone, sig } from '../core/utils.js';
import { resolveRef } from '../logic/matching.js';
import { applyOutfitChange, normOutfitChange } from '../logic/outfit.js';
import { normalize, pickEnum } from '../logic/text.js';
import { applyTracker } from '../logic/trackerApply.js';
import { extractTracker } from '../logic/trackerParse.js';
import { updateAutoInjection } from '../prompt/injection.js';
import { adaptUser, currentUser, personaData, userBefore } from '../scene/persona.js';
import { currentRoster, newInstance, rosterBefore, snapOf } from '../scene/roster.js';
import { renderLibraryList } from '../ui/library/libraryList.js';
import { renderRoster } from '../ui/roster/rosterBar.js';
import { showTrackerBlock } from '../ui/trackerBlock.js';

let processing = false;

/** True when no user message comes before chat[idx] (i.e. it is a greeting / intro message). */
function isGreetingIdx(idx) {
    const chat = ctx().chat || [];
    return idx >= 0 && chat.slice(0, idx).every(x => !x.is_user);
}

/**
 * Starting cast for regenerating a greeting: the given roster, plus the cast read from the greeting's
 * "characters" block (any swipe), plus the main character card when "Track the main character" is on.
 */
function greetingCast(idx, base) {
    const s = settings();
    const c = ctx();
    const msg = (c.chat || [])[idx];
    const roster = clone(base || []);
    const has = (id) => roster.some(x => x.id === id);
    const snaps = [snapOf(msg), ...(Array.isArray(msg?.swipe_info) ? msg.swipe_info.map(si => si?.extra?.[MODULE]) : [])].filter(Boolean);
    const greet = snaps.find(x => x.greeting && Array.isArray(x.post) && x.post.length);
    for (const inst of greet?.post || []) if (inst?.id && !has(inst.id)) roster.push(clone(inst));
    const assistantMode = c.characterId === undefined && !c.groupId;
    if (s.trackChar && !assistantMode && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, lib());
        if (id && !has(id)) roster.push(newInstance(id));
    }
    return roster;
}

export function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) { updateAutoInjection(); return; }
    const chat = ctx().chat || [];
    if (type === 'quiet' || type === 'impersonate') { updateAutoInjection(); return; }
    const lastIdx = chat.length - 1;
    const last = chat[lastIdx];
    if ((type === 'swipe' || type === 'continue') && last && !last.is_user) {
        const m = meta();
        const metaHit = m?.pre && m.pre.idx === lastIdx;
        let pre = metaHit ? m.pre.roster : (snapOf(last)?.pre ?? rosterBefore(lastIdx));
        // Regenerating a greeting: the scene "before" it is empty, so seed it with the greeting's cast + the main character card.
        if (isGreetingIdx(lastIdx)) pre = greetingCast(lastIdx, pre);
        const preUser = (metaHit && m.pre.user) ? m.pre.user : (snapOf(last)?.preUser ?? userBefore(lastIdx));
        runtime.genCtx = { type, pre: clone(pre), preUser: clone(adaptUser(preUser)), targetIdx: lastIdx };
    } else {
        runtime.genCtx = { type, pre: clone(currentRoster()), preUser: clone(currentUser()), targetIdx: null };
    }
    updateAutoInjection();
}

export async function processLastMessage() {
    const s = settings();
    if (!s.enabled || processing || !runtime.genCtx) return;
    const c = ctx();
    const chat = c.chat || [];
    const idx = chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system) return;
    const g = runtime.genCtx;
    if (g.idx !== undefined && g.idx !== idx) { runtime.genCtx = null; return; } // stale: belongs to an earlier message
    const existing = snapOf(msg);
    const exPeek = extractTracker(msg.mes);
    if (!exPeek.found && existing && existing.sig === sig(msg.mes)) return; // already processed
    processing = true;
    let processed = null;
    try {
        const ex = exPeek;
        const pre = g.pre ?? rosterBefore(idx);
        const preUser = adaptUser(g.preUser ?? userBefore(idx));
        let post = (g.type === 'continue' && existing?.post) ? existing.post : pre;
        let postUser = (g.type === 'continue' && existing?.postUser) ? adaptUser(existing.postUser) : preUser;
        let trackLog = [];
        if (ex.found) {
            msg.mes = ex.cleaned;
            if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = ex.cleaned;
            if (ex.json) {
                const excludeNames = excludedNames();
                const isUserEntry = (e) => e && typeof e === 'object' && (String(e.id ?? '').toLowerCase() === 'user' || (c.name1 && normalize(e.name) === normalize(c.name1)));
                const userEntry = ex.json.find(isUserEntry);
                if (userEntry && s.trackUser) {
                    const p = personaData();
                    const u = clone(postUser);
                    u.posture = pickEnum(userEntry.posture, s.postures, u.posture);
                    if (s.trackOutfits) {
                        const oc = applyOutfitChange(u.outfit, p.wardrobe, normOutfitChange(userEntry), s.conditions);
                        u.outfit = oc.outfit;
                        if (userEntry.outfit || userEntry.wear) u.dressed = true;
                    }
                    postUser = u;
                }
                // The block lists changes, so apply it to the scene as it stood before this text was written.
                const r = applyTracker(ex.json.filter(e => !isUserEntry(e)), post, {
                    library: lib(),
                    threshold: s.threshold / 100,
                    numericTolerance: s.numericTolerance,
                    postures: s.postures,
                    states: s.states,
                    conditions: s.conditions,
                    allowWardrobeGrowth: s.allowWardrobeGrowth,
                    autoCreate: s.autoCreate,
                    maxNew: Number(s.maxNewPerReply) || 0,
                    traitKeys: s.traitKeys,
                    excludeNames,
                });
                for (const [n, t] of r.created.entries()) {
                    t.color = t.color || pickColor();
                    t.folder = normFolder(s.autoFolder);
                    registerFolder(t.folder);
                    const entry = r.createdEntries?.[n];
                    for (const ext of extensions.values()) {
                        if (typeof ext.fromTracker !== 'function' || !entry) continue;
                        try { const d = ext.fromTracker(entry, t); if (d) { t.ext = t.ext || {}; t.ext[ext.id] = d; } } catch (e) { console.warn(`[NPC Book] ${ext.id} fromTracker failed`, e); }
                    }
                    lib()[t.id] = t;
                }
                for (const t of r.updated || []) lib()[t.id] = t;
                if (r.updated?.length) save();
                if (r.skipped?.length) {
                    toastr.warning(`Skipped ${r.skipped.length} more new character${r.skipped.length > 1 ? 's' : ''} (limit ${s.maxNewPerReply} per reply): ${r.skipped.join(', ')}`, 'NPC Book');
                }
                if (ex.truncated) {
                    toastr.warning(`The <npcs> block was cut off before it ended (reply longer than the response length?). Used the ${ex.json.length} complete entr${ex.json.length === 1 ? 'y' : 'ies'}. Click to see it.`, 'NPC Book', { timeOut: 8000, onclick: () => showTrackerBlock(idx) });
                }
                if (ex.skipped) {
                    toastr.warning(`${ex.skipped} entr${ex.skipped === 1 ? 'y' : 'ies'} in the <npcs> block could not be read and ${ex.skipped === 1 ? 'was' : 'were'} skipped. Click to see it.`, 'NPC Book', { timeOut: 8000, onclick: () => showTrackerBlock(idx) });
                }
                if (ex.repaired) {
                    toastr.info(`${ex.repaired} entr${ex.repaired === 1 ? 'y' : 'ies'} had a broken part (like a stats sheet) that was dropped; the rest was kept.`, 'NPC Book');
                }
                if (r.created.length) {
                    save();
                    toastr.info(`New NPC${r.created.length > 1 ? 's' : ''}: ${r.created.map(t => `${t.name} (${t.id})`).join(', ')}`, 'NPC Book');
                    renderLibraryList();
                }
                post = r.roster;
                trackLog = r.log.map(l => `${l.action}: ${l.name ?? l.id ?? ''}${l.id && l.name && l.id !== l.name ? ` (${l.id})` : ''}${l.items ? ` [${l.items.join(', ')}]` : ''}`);
            } else {
                console.warn('[NPC Book] could not parse tracker block:', ex.error, ex.raw);
                toastr.warning(ex.truncated
                    ? 'The <npcs> block was cut off before its first complete entry (reply longer than the response length?); scene left unchanged. Click to see it.'
                    : 'Could not parse the <npcs> block; scene left unchanged. Click to see what the model wrote.', 'NPC Book', { timeOut: 8000, onclick: () => showTrackerBlock(idx) });
            }
        }
        const block = ex.found
            ? { text: ex.removed, status: !ex.json ? 'unreadable' : ex.truncated ? 'cut off' : 'ok', entries: ex.json?.length ?? 0, log: trackLog }
            : (existing?.block ?? null);
        const snap = { pre: clone(pre), post: clone(post), preUser: clone(preUser), postUser: clone(postUser), raw: ex.found ? ex.raw : (existing?.raw ?? null), block, sig: sig(msg.mes) };
        msg.extra = msg.extra || {};
        msg.extra[MODULE] = snap;
        if (Array.isArray(msg.swipe_info) && msg.swipe_id !== undefined) {
            msg.swipe_info[msg.swipe_id] = msg.swipe_info[msg.swipe_id] || {};
            msg.swipe_info[msg.swipe_id].extra = msg.swipe_info[msg.swipe_id].extra || {};
            msg.swipe_info[msg.swipe_id].extra[MODULE] = clone(snap);
        }
        const m = meta();
        if (m) m.pre = { idx, roster: clone(pre), user: clone(preUser) };
        g.idx = idx;
        await c.saveChat();
        c.saveMetadataDebounced?.();
        if (ex.found) { try { c.updateMessageBlock(idx, msg); } catch (e) { console.warn('[NPC Book] re-render failed', e); } }
        processed = { idx, swipeId: msg.swipe_id ?? 0, type: g.type || 'normal' };
    } catch (e) {
        console.error('[NPC Book] processing failed', e);
    } finally {
        processing = false;
        renderRoster();
    }
    // Tell sister extensions (e.g. TTS) that this message is final: tracker block removed, scene saved.
    if (processed) document.dispatchEvent(new CustomEvent('npcbook:message', { detail: processed }));
}
