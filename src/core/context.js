// SillyTavern context access: the live context, chat metadata, chat presence and excluded names.

import { MODULE } from '../constants.js';
import { settings } from './settings.js';

export const ctx = () => SillyTavern.getContext();

export function meta() {
    const m = ctx().chatMetadata;
    if (!m) return null;
    if (!m[MODULE] || typeof m[MODULE] !== 'object') m[MODULE] = { base: { instances: {}, active: [] }, pre: null };
    return m[MODULE];
}

export function hasChat() {
    const c = ctx();
    // Works for saved chats, group chats AND Assistant / temporary chats (which have no chat id).
    return Array.isArray(c.chat) && (!!c.getCurrentChatId?.() || c.characterId !== undefined || !!c.groupId || c.chat.length > 0);
}

/** Names the LLM must not list. The main character is tracked unless disabled (or in Assistant mode). */
export function excludedNames() {
    const c = ctx();
    const assistantMode = c.characterId === undefined && !c.groupId;
    const out = [c.name1];
    if (!settings().trackChar || assistantMode) out.push(c.name2);
    return out.filter(Boolean);
}
