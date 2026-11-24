// Scene roster state per chat message: read, write, add and remove NPCs.

import { MODULE } from '../constants.js';
import { ctx, hasChat, meta } from '../core/context.js';
import { runtime } from '../core/runtime.js';
import { lib, settings } from '../core/settings.js';
import { clone } from '../core/utils.js';
import { outfitFromDefault } from '../logic/outfit.js';
import { renderRoster } from '../ui/roster/rosterBar.js';
import { currentUser } from './persona.js';

export function snapOf(msg) { return msg?.extra?.[MODULE] ?? null; }

/** Roster as of the end of the chat (latest message snapshot, else chat base). */
export function currentRoster() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (s && Array.isArray(s.post)) return s.post;
    }
    return meta()?.base ?? [];
}

export function rosterBefore(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length) - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (s && Array.isArray(s.post)) return s.post;
    }
    return meta()?.base ?? [];
}

/** Roster the prompt should use for the generation in progress. */
export function promptRoster() {
    if (runtime.genCtx?.pre && runtime.genCtx.idx === undefined) return runtime.genCtx.pre;
    return currentRoster();
}

/** Write a roster into the snapshot of the last message (all swipes), so manual edits survive swiping. */
export function writeCurrentRoster(roster, user) {
    if (roster === null) roster = currentRoster();
    if (user === undefined) user = currentUser();
    const c = ctx();
    const chat = c.chat || [];
    const m = meta();
    if (!m) return;
    if (!chat.length) {
        m.base = clone(roster);
        m.baseUser = clone(user);
    } else {
        const idx = chat.length - 1;
        const msg = chat[idx];
        const apply = (extra) => {
            const s = extra[MODULE] ?? (extra[MODULE] = {});
            s.post = clone(roster);
            s.postUser = clone(user);
            if (!msg.is_user) { s.pre = clone(roster); s.preUser = clone(user); }
        };
        msg.extra = msg.extra || {};
        apply(msg.extra);
        if (Array.isArray(msg.swipe_info)) for (const si of msg.swipe_info) { if (si) { si.extra = si.extra || {}; apply(si.extra); } }
        if (!msg.is_user) m.pre = { idx, roster: clone(roster), user: clone(user) };
    }
    c.saveMetadataDebounced?.();
    c.saveChat?.();
    renderRoster();
}

export function newInstance(id) {
    const s = settings();
    const t = lib()[id];
    return { id, name: t.name, posture: s.postures[0] ?? '', state: s.states[0] ?? '', feelings: '', outfit: outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions) };
}

export function rosterAtMessage(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length - 1); i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn && Array.isArray(sn.post)) return i === idx && sn.pre ? [...new Set([...sn.pre, ...sn.post].map(x => x.id))] : sn.post.map(x => x.id);
    }
    return [];
}

export function addToScene(id) {
    const t = lib()[id];
    if (!t || !hasChat()) return;
    const roster = clone(currentRoster());
    if (roster.some(i => i.id === id)) return;
    const s = settings();
    roster.push({ id, name: t.name, posture: s.postures[0] ?? '', state: s.states[0] ?? '', feelings: '', outfit: outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions) });
    writeCurrentRoster(roster);
}

export function removeFromScene(id) {
    writeCurrentRoster(currentRoster().filter(i => i.id !== id));
}
