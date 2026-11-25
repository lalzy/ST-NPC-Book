// Persona (user) scene state: starting outfit, current posture and outfit.

import { user_avatar } from '../../../../../personas.js';
import { ctx, meta } from '../core/context.js';
import { runtime } from '../core/runtime.js';
import { settings } from '../core/settings.js';
import { startingOutfit } from '../logic/outfit.js';
import { snapOf } from './roster.js';

// ── persona ("user") state ──
export function personaKey() { return user_avatar || ''; }
export function personaData(key = personaKey()) {
    const s = settings();
    if (!s.personas[key]) s.personas[key] = { outfit: [] };
    const p = s.personas[key];
    // Older data: a starting outfit as starred wardrobe items (`wardrobe` + `defaultWorn`) becomes self-contained items.
    if (!Array.isArray(p.outfit)) p.outfit = startingOutfit(p, s.conditions);
    return p;
}
function freshUser(prev) {
    const s = settings();
    const p = personaData();
    const outfit = startingOutfit(p, s.conditions);
    return { persona: personaKey(), posture: prev?.posture ?? s.postures[0] ?? '', outfit, dressed: outfit.length > 0 };
}
/**
 * Make a stored user state usable for the current persona.
 * An empty outfit that was never deliberately set ("dressed" false/missing) falls back to the starting outfit,
 * so chats saved before the persona's wardrobe existed don't report "nothing".
 */
export function adaptUser(u) {
    if (!u || u.persona !== personaKey()) return freshUser(u);
    if (!u.dressed && !(u.outfit || []).length) {
        const f = freshUser(u);
        if (f.outfit.length) return { ...u, outfit: f.outfit, dressed: true };
    }
    return u;
}
export function currentUser() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn?.postUser) return adaptUser(sn.postUser);
    }
    return adaptUser(meta()?.baseUser);
}
export function userBefore(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length) - 1; i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn?.postUser) return adaptUser(sn.postUser);
    }
    return adaptUser(meta()?.baseUser);
}
export function promptUser() {
    if (runtime.genCtx?.preUser && runtime.genCtx.idx === undefined) return adaptUser(runtime.genCtx.preUser);
    return currentUser();
}

export function personaDescription() {
    const c = ctx();
    const raw = c.powerUserSettings?.persona_description || '';
    try { return c.substituteParams ? c.substituteParams(raw) : raw; } catch { return raw; }
}
