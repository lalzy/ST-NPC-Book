// Chat scene state per chat message: the chat's NPC instances and which of them are active.
// Stored in each message snapshot (extra.npc_book.pre / .post), so swipes roll back and branches inherit the chat's instances.

import { MODULE } from '../constants.js';
import { ctx, hasChat, meta } from '../core/context.js';
import { instanceCreated } from '../core/extHooks.js';
import { allTemplates } from '../core/libraries.js';
import { runtime } from '../core/runtime.js';
import { lib, settings } from '../core/settings.js';
import { clone } from '../core/utils.js';
import { activeInstances, attachInstance, cloneScene, toScene } from '../logic/instances.js';
import { resolveRef } from '../logic/matching.js';
import { renderRoster } from '../ui/roster/rosterBar.js';
import { currentUser } from './persona.js';

export function snapOf(msg) { return msg?.extra?.[MODULE] ?? null; }

const hasScene = (s) => !!s && s.post !== undefined && s.post !== null;

/** Options for creating an instance from a template (starting posture / state / outfit condition, extension setup). */
export function instanceOpts() {
    const s = settings();
    return { postures: s.postures, states: s.states, conditions: s.conditions, onCreate: instanceCreated };
}

/** Scene as of the end of the chat (latest message snapshot, else chat base). */
export function currentScene() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (hasScene(s)) return toScene(s.post);
    }
    return toScene(meta()?.base);
}

export function sceneBefore(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length) - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (hasScene(s)) return toScene(s.post);
    }
    return toScene(meta()?.base);
}

/** Scene the prompt should use for the generation in progress. */
export function promptScene() {
    if (runtime.genCtx?.pre && runtime.genCtx.idx === undefined) return toScene(runtime.genCtx.pre);
    return currentScene();
}

/** Active instances at the end of the chat (who is in the scene now). */
export function currentRoster() { return activeInstances(currentScene()); }

/** Active instances the prompt should describe. */
export function promptRoster() { return activeInstances(promptScene()); }

/** The chat's instance for an id or name (active or not), or null. Never falls back to a template. */
export function findInstance(ref, scene = currentScene()) {
    const sc = toScene(scene);
    const id = resolveRef(ref, sc.instances);
    return id ? sc.instances[id] : null;
}

/**
 * Write a manual edit into the outcome (post) of the last message, all swipes. null = keep the current scene.
 * The message's starting scene (pre) is never touched: swiping replays from the end of the previous message.
 */
export function writeCurrentScene(scene, user) {
    if (scene === null) scene = currentScene();
    if (user === undefined) user = currentUser();
    const c = ctx();
    const chat = c.chat || [];
    const m = meta();
    if (!m) return;
    if (!chat.length) {
        m.base = clone(scene);
        m.baseUser = clone(user);
    } else {
        const msg = chat[chat.length - 1];
        const apply = (extra) => {
            const s = extra[MODULE] ?? (extra[MODULE] = {});
            s.post = clone(scene);
            s.postUser = clone(user);
        };
        msg.extra = msg.extra || {};
        apply(msg.extra);
        if (Array.isArray(msg.swipe_info)) for (const si of msg.swipe_info) { if (si) { si.extra = si.extra || {}; apply(si.extra); } }
    }
    c.saveMetadataDebounced?.();
    c.saveChat?.();
    renderRoster();
}

/** Who was in the scene at a chat message (for the last message: before + after it), as that message's instances. */
export function rosterAtMessage(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length - 1); i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (!hasScene(sn)) continue;
        const post = toScene(sn.post);
        if (i === idx && sn.pre) {
            const pre = toScene(sn.pre);
            return [...new Set([...pre.active, ...post.active])].map(id => post.instances[id] ?? pre.instances[id]).filter(Boolean);
        }
        return activeInstances(post);
    }
    return [];
}

/** Put an NPC in the scene: the chat's own instance first, else a new instance from the template. */
export function addToScene(id) {
    if (!hasChat()) return;
    const scene = cloneScene(currentScene());
    if (scene.active.includes(id)) return;
    if (!attachInstance(scene, id, allTemplates(), instanceOpts())) return;
    writeCurrentScene(scene);
}

/** Take an NPC out of the scene. Its instance stays in the chat. */
export function removeFromScene(id) {
    const scene = cloneScene(currentScene());
    scene.active = scene.active.filter(x => x !== id);
    writeCurrentScene(scene);
}

/** Change one instance in every stored scene of this chat (e.g. a generated portrait). Returns true when something changed. */
export function patchInstanceEverywhere(id, patch) {
    const c = ctx();
    const m = meta();
    let changed = false;
    const fix = (holder, key) => {
        if (!holder || holder[key] === undefined || holder[key] === null) return;
        const sc = toScene(holder[key]);
        if (!sc.instances[id]) return;
        Object.assign(sc.instances[id], patch);
        holder[key] = sc;
        changed = true;
    };
    if (m) fix(m, 'base');
    for (const msg of c.chat || []) {
        for (const extra of [msg?.extra, ...(Array.isArray(msg?.swipe_info) ? msg.swipe_info.map(si => si?.extra) : [])]) {
            const sn = extra?.[MODULE];
            if (sn) { fix(sn, 'pre'); fix(sn, 'post'); }
        }
    }
    if (runtime.genCtx?.pre) fix(runtime.genCtx, 'pre');
    if (changed) { c.saveMetadataDebounced?.(); c.saveChat?.(); }
    return changed;
}
