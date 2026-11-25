// Generation hooks: capture the scene before a reply, then apply the reply's <npcs> block.

import { MODULE } from '../constants.js';
import { ctx, excludedNames } from '../core/context.js';
import { newNpcFolder, registerFolder } from '../core/folders.js';
import { pickColor } from '../core/npcs.js';
import { outfitCatalog, runEntryHooks, transformEntries } from '../core/extHooks.js';
import { addToLibrary, allTemplates, claimingLibrary } from '../core/libraries.js';
import { extensions, runtime } from '../core/runtime.js';
import { lib, save, settings } from '../core/settings.js';
import { clone, sig } from '../core/utils.js';
import { attachInstance, cloneScene, toScene } from '../logic/instances.js';
import { resolveRef } from '../logic/matching.js';
import { applyOutfitChange, normOutfitChange, resolveOutfit } from '../logic/outfit.js';
import { cleanId, normalize, pickEnum, slugify } from '../logic/text.js';
import { closestEnum } from '../logic/enumMatch.js';
import { nameMentioned, remapSpeakerIds, renameInText, sanitizeSpeakerTags } from '../logic/rename.js';
import { applyTracker, findLookups, isTempId } from '../logic/trackerApply.js';
import { extractTracker } from '../logic/trackerParse.js';
import { updateAutoInjection } from '../prompt/injection.js';
import { adaptUser, currentUser, personaData, userBefore } from '../scene/persona.js';
import { currentScene, instanceOpts, sceneBefore, snapOf } from '../scene/roster.js';
import { renderLibraryList } from '../ui/library/libraryList.js';
import { renderRoster } from '../ui/roster/rosterBar.js';
import { pickMatch } from '../ui/matchPicker.js';
import { showTrackerBlock } from '../ui/trackerBlock.js';

let processing = false;

/**
 * For each character the LLM brought in who is not one of this chat's NPCs by id, look for close names
 * (this chat's NPCs first, then library cards this chat has not used) and let the user pick one or "Create new".
 * Returns choices aligned with `list`, for applyTracker.
 */
async function askMatches(list, scene, excludeNames, beforeAsk, earlierTexts) {
    const s = settings();
    const { lookups } = findLookups(list, scene, {
        isSpecified: (name) => nameMentioned(name, earlierTexts),
        library: allTemplates(),
        threshold: s.threshold / 100,
        numericTolerance: s.numericTolerance,
        excludeNames,
        minScore: (Number(s.nameMatch) || 70) / 100,
    });
    const choices = [];
    if (lookups.length) { try { beforeAsk?.(); } catch { /* cosmetic */ } }
    const sc = toScene(scene);
    for (let k = 0; k < lookups.length; k++) {
        const lk = lookups[k];
        const pool = lk.source === 'instance' ? sc.instances : allTemplates();
        try { choices[lk.index] = await pickMatch(lk, pool, { step: k + 1, steps: lookups.length }); } catch (e) {
            console.error('[NPC Book] match popup failed', e);
            choices[lk.index] = { create: true };
        }
    }
    return { choices, lookups };
}

/**
 * Make the reply match who its characters turned out to be: speaker blocks with a temporary or made-up id get the
 * real id, and a character the user matched to someone else is renamed in the text (unless the story named them before).
 */
function rewriteReply(text, list, ids, choices, lookups, scene) {
    const idMap = {};
    const renames = [];
    const sc = toScene(scene);
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const id = ids[i];
        if (!e || typeof e !== 'object' || !id) continue;
        const written = cleanId(e.id);
        if (written && written !== id) idMap[written] = id;
        // A speaker block may use a slug of the name instead of the id it was given.
        const slug = e.name ? slugify(e.name) : '';
        if (slug && slug !== id && (isTempId(written) || !sc.instances[slug])) idMap[slug] = id;
        const lk = lookups.find(x => x.index === i);
        const target = sc.instances[id];
        if (choices[i]?.link && lk && !lk.specified && e.name && target?.name && normalize(e.name) !== normalize(target.name)) renames.push([e.name, target.name]);
    }
    // One new character this reply: a bare placeholder in a speaker tag can only mean them.
    const fresh = list.map((e, i) => (e && typeof e === 'object' && (isTempId(cleanId(e.id)) || (!e.id && e.new)) ? ids[i] : null)).filter(Boolean);
    if (fresh.length === 1) for (const k of ['to_be_allocated', 'generated']) if (!idMap[k]) idMap[k] = fresh[0];
    let out = remapSpeakerIds(text, idMap);
    for (const [from, to] of renames) out = renameInText(out, from, to);
    return out;
}

/** True when no user message comes before chat[idx] (i.e. it is a greeting / intro message). */
function isGreetingIdx(idx) {
    const chat = ctx().chat || [];
    return idx >= 0 && chat.slice(0, idx).every(x => !x.is_user);
}

/**
 * Starting scene for regenerating a greeting: the given scene, plus the cast read from the greeting's
 * "characters" block (any swipe, using the instances made there), plus the main character when
 * "Track the main character" is on (its instance in this chat, else a new one from its template).
 */
function greetingCast(idx, base) {
    const s = settings();
    const c = ctx();
    const msg = (c.chat || [])[idx];
    const scene = cloneScene(base);
    const snaps = [snapOf(msg), ...(Array.isArray(msg?.swipe_info) ? msg.swipe_info.map(si => si?.extra?.[MODULE]) : [])].filter(Boolean);
    const greet = snaps.find(x => x.greeting && toScene(x.post).active.length);
    if (greet) {
        const g = toScene(greet.post);
        for (const id of g.active) {
            if (!scene.instances[id] && g.instances[id]) scene.instances[id] = clone(g.instances[id]);
            if (scene.instances[id] && !scene.active.includes(id)) scene.active.push(id);
        }
    }
    const assistantMode = c.characterId === undefined && !c.groupId;
    if (s.trackChar && !assistantMode && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, scene.instances) ?? resolveRef(c.name2, allTemplates());
        if (id) attachInstance(scene, id, allTemplates(), instanceOpts());
    }
    return scene;
}

export function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) { updateAutoInjection(); return; }
    const chat = ctx().chat || [];
    if (type === 'quiet' || type === 'impersonate') { updateAutoInjection(); return; }
    const lastIdx = chat.length - 1;
    const last = chat[lastIdx];
    const replay = (type === 'swipe' || type === 'regenerate') && last && !last.is_user;
    if (replay || (type === 'continue' && last && !last.is_user)) {
        // Swipe / regenerate replays the last reply from the end of the message before it. Nothing from the reply being
        // replaced carries over: not its NPC changes (arrivals, departures, feelings) and not manual edits made after it.
        // ("regenerate" fires while the old reply is still in the chat, so it must be treated like a swipe.)
        // Continue extends the same reply, so it starts from that reply's own starting scene.
        let pre = replay ? sceneBefore(lastIdx) : toScene(snapOf(last)?.pre ?? sceneBefore(lastIdx));
        // Regenerating a greeting: the scene "before" it is empty, so seed it with the greeting's cast + the main character card.
        if (isGreetingIdx(lastIdx)) pre = greetingCast(lastIdx, pre);
        const preUser = replay ? userBefore(lastIdx) : (snapOf(last)?.preUser ?? userBefore(lastIdx));
        runtime.genCtx = { type, pre: clone(pre), preUser: clone(adaptUser(preUser)), targetIdx: lastIdx };
    } else {
        runtime.genCtx = { type, pre: clone(currentScene()), preUser: clone(currentUser()), targetIdx: null };
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
    // Speaker tags may only hold an id; data a model put in them is cut out (and kept as tracker entries below).
    const san = sanitizeSpeakerTags(msg.mes);
    const tagsFixed = san.text !== msg.mes;
    const exPeek = extractTracker(san.text);
    if (!exPeek.found && !tagsFixed && existing && existing.sig === sig(msg.mes)) return; // already processed
    processing = true;
    let processed = null;
    try {
        if (tagsFixed) {
            msg.mes = san.text;
            if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = san.text;
            console.warn('[NPC Book] removed character data from <npc> speaker tags', san.entries);
        }
        let ex = exPeek;
        // Characters described only in a speaker tag (not in the <npcs> block) are still tracked.
        const has = (e) => (ex.json || []).some(x => x && typeof x === 'object' && ((e.id && cleanId(x.id) === cleanId(e.id)) || (e.name && normalize(x.name) === normalize(e.name))));
        const extra = san.entries.filter(e => !has(e));
        if (extra.length) ex = ex.found ? { ...ex, json: [...(ex.json || []), ...extra] } : { found: true, json: extra, raw: '', cleaned: msg.mes, removed: '', error: null, truncated: false };
        const pre = toScene(g.pre ?? sceneBefore(idx));
        const preUser = adaptUser(g.preUser ?? userBefore(idx));
        let post = (g.type === 'continue' && existing?.post) ? toScene(existing.post) : pre;
        let postUser = (g.type === 'continue' && existing?.postUser) ? adaptUser(existing.postUser) : preUser;
        let trackLog = [];
        if (ex.found) {
            msg.mes = ex.cleaned;
            if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = ex.cleaned;
            if (ex.json) {
                const excludeNames = excludedNames();
                const isUserEntry = (e) => e && typeof e === 'object' && (String(e.id ?? '').toLowerCase() === 'user' || (c.name1 && normalize(e.name) === normalize(c.name1)));
                // Sister extensions may rewrite or drop entries first (transformEntry); without any, this is ex.json itself.
                const entries = transformEntries(ex.json, { source: 'tracker', messageIndex: idx });
                const userEntry = entries.find(isUserEntry);
                if (userEntry && s.trackUser) {
                    const p = personaData();
                    const u = clone(postUser);
                    u.posture = closestEnum(userEntry.posture, s.postures, u.posture);
                    if (s.trackOutfits) {
                        const cat = outfitCatalog({ source: 'tracker', kind: 'user', id: 'user', subject: p, ext: { ...(p.ext || {}), ...(u.ext || {}) } });
                        const oc = applyOutfitChange(resolveOutfit(u.outfit, p.wardrobe || []), normOutfitChange(userEntry), { conditions: s.conditions, catalog: cat.items, strict: cat.strict });
                        u.outfit = oc.outfit;
                        if (userEntry.outfit || userEntry.wear) u.dressed = true;
                    }
                    postUser = u;
                }
                // Sister extensions read the user's entry into this chat's copy of their persona data (rolls back with swipes).
                if (userEntry) {
                    const u = clone(postUser);
                    let touched = false;
                    runEntryHooks({ kind: 'user', source: 'tracker', id: 'user', name: c.name1, entry: userEntry, isNew: false, user: u },
                        (x) => u.ext?.[x] ?? personaData().ext?.[x],
                        (x, d) => { u.ext = u.ext || {}; u.ext[x] = d; touched = true; });
                    if (touched) postUser = u;
                }
                // Characters the LLM brought in whose name is close to someone known: the user decides who they are.
                const npcEntries = entries.filter(e => !isUserEntry(e));
                // The reply is shown without its <npcs> block while the user decides.
                const earlier = chat.slice(0, idx).map(m => m?.mes);
                const { choices, lookups } = await askMatches(npcEntries, post, excludeNames, () => c.updateMessageBlock(idx, msg), earlier);
                if ((ctx().chat || [])[idx] !== msg) return; // the chat changed while the popup was open
                // The block lists changes, so apply it to the scene as it stood before this text was written.
                // New characters an extension library claims (e.g. enemies for a Bestiary) are stored there, not in the NPC Library.
                const claimedBy = new Map();
                const r = applyTracker(npcEntries, post, {
                    choices,
                    // Every card NPC Book knows: its own library and the extension libraries. Ids are unique across all of them.
                    library: allTemplates(),
                    threshold: s.threshold / 100,
                    numericTolerance: s.numericTolerance,
                    postures: s.postures,
                    states: s.states,
                    conditions: s.conditions,
                    autoCreate: s.autoCreate,
                    maxNew: Number(s.maxNewPerReply) || 0,
                    traitKeys: s.traitKeys,
                    excludeNames,
                    // A new NPC's template is finished here, before its instance is copied from it.
                    prepareNew: (t, entry) => {
                        t.color = t.color || pickColor();
                        const owner = entry ? claimingLibrary(entry, t) : null;
                        if (owner) claimedBy.set(t.id, owner);
                        else { t.folder = newNpcFolder(); registerFolder(t.folder); }
                        for (const ext of extensions.values()) {
                            if (typeof ext.fromTracker !== 'function' || !entry) continue;
                            try { const d = ext.fromTracker(entry, t); if (d) { t.ext = t.ext || {}; t.ext[ext.id] = d; } } catch (e) { console.warn(`[NPC Book] ${ext.id} fromTracker failed`, e); }
                        }
                    },
                    // Sister extensions read every entry into their data on this chat's instance (rolls back with swipes).
                    onEntry: (inst, entry, { isNew }, scene) => runEntryHooks(
                        { kind: 'char', source: 'tracker', id: inst.id, name: inst.name, entry, isNew, instance: inst, scene },
                        (x) => inst.ext?.[x],
                        (x, d) => { inst.ext = inst.ext || {}; inst.ext[x] = d; }),
                    // Known clothing (e.g. a sister extension's wardrobe); without one, any clothing can be worn.
                    catalogFor: (inst) => (s.trackOutfits ? outfitCatalog({ source: 'tracker', kind: 'char', id: inst.id, subject: inst, ext: inst.ext || {} }) : { items: [], strict: false }),
                    onCreate: instanceOpts().onCreate,
                });
                const createdNpcs = [], createdExt = [];
                r.created.forEach((t, i) => {
                    const owner = claimedBy.get(t.id);
                    if (owner && addToLibrary(owner, t, r.createdEntries?.[i])) createdExt.push({ t, owner });
                    else { lib()[t.id] = t; createdNpcs.push(t); }
                });
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
                if (createdNpcs.length) {
                    save();
                    toastr.info(`New NPC${createdNpcs.length > 1 ? 's' : ''}: ${createdNpcs.map(t => `${t.name} (${t.id})`).join(', ')}`, 'NPC Book');
                    renderLibraryList();
                }
                for (const owner of new Set(createdExt.map(x => x.owner))) {
                    const list = createdExt.filter(x => x.owner === owner).map(x => `${x.t.name} (${x.t.id})`);
                    const where = owner.templateLibrary.label || owner.label || owner.id;
                    toastr.info(`New in ${where}: ${list.join(', ')}`, 'NPC Book');
                }

                post = r.scene;
                // Real ids in the speaker blocks, and the chosen NPC's name where the LLM made up another one.
                const rewritten = rewriteReply(msg.mes, npcEntries, r.ids || [], choices, lookups, post);
                if (rewritten !== msg.mes) {
                    msg.mes = rewritten;
                    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = rewritten;
                }
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
