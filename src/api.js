// Public API for sister extensions (window.NPCBook) and the npcbook:ready event.

import { ctx, hasChat } from './core/context.js';
import { extensions } from './core/runtime.js';
import { lib, save } from './core/settings.js';
import { esc, indent, xa, xt } from './core/utils.js';
import { resolveRef } from './logic/matching.js';
import { normalize, slugify } from './logic/text.js';
import { updateAutoInjection } from './prompt/injection.js';
import { personaData } from './scene/persona.js';
import { currentRoster, findInstance, rosterAtMessage } from './scene/roster.js';
import { selectTemplate } from './ui/library/editor.js';
import { libState } from './ui/library/state.js';
import { openPersonaCharacter } from './ui/persona/personaCharacter.js';
import { renderRoster } from './ui/roster/rosterBar.js';

export function exposePublicApi() {
    window.NPCBook = {
        version: 5,
        /**
         * Register a sister extension.
         * def = { id, label?, defaultData?(), cardTab?: { label, render(host, {data, template, isNew, kind}) },
         *         personaSheet?: { label, icon?, render(host, {data, kind, name}) },
         *         sceneXml?({kind, name, id, template, instance, data}) -> string,
         *         instructions?({autoCreate}) -> string, fromTracker?(entry, template) -> data,
         *         sceneButton?: { icon() -> 'fa-…', title() -> string, active?() -> bool, onClick(anchorEl) } }
         * sceneButton adds an icon to the scene bar head (next to Add NPC / Folder); active() === false dims it.
         * Call refreshScene() after changing what it shows.
         * Card/persona `data` objects are mutable drafts; NPC Book saves them when the user presses Save.
         */
        registerExtension(def) {
            if (!def?.id) throw new Error('registerExtension: id required');
            extensions.set(def.id, def);
            if ($('#npcb_library').is(':visible') && (libState.selected || libState.isNew)) selectTemplate(libState.selected, libState.isNew);
            renderRoster();
            updateAutoInjection();
        },
        /** Redraw the scene bar (and its sister-extension buttons) and refresh injected prompts. */
        refreshScene: () => renderRoster(),
        getLibrary: () => lib(),
        getTemplate: (id) => lib()[id] || null,
        getPersonaData: (extId) => personaData().ext?.[extId] ?? null,
        /**
         * Who is in the current scene: [{ id, name, instance, template }] plus your persona's name.
         * `instance` is the chat's own copy (card fields, wardrobe, ext data, live state). `template` is the same object,
         * kept for extensions written before instancing: inside a chat, an NPC's data always comes from its instance.
         */
        getScene: () => ({
            roster: hasChat() ? currentRoster().map(i => ({ id: i.id, name: i.name ?? i.id, instance: i, template: i })) : [],
            userName: ctx().name1,
        }),
        /** Who was in the scene at a chat message (for the last message: before + after it): [{ id, name, instance, template }]. */
        getRosterAt: (idx) => (hasChat() ? rosterAtMessage(Number(idx)) : []).map(i => ({ id: i.id, name: i.name ?? i.id, instance: i, template: i })),
        /** The open chat's instance of an NPC (active or not), or null. */
        getInstance: (ref) => (hasChat() ? findInstance(ref) : null),
        /** Resolve an id or name (as written by the LLM in <npc id="…">): this chat's instance first, then the library. */
        resolveNpc: (ref) => (hasChat() ? findInstance(ref)?.id : null) ?? resolveRef(ref, lib()),
        openPersonaCharacter,
        saveSettings: save,
        util: { esc, xa, xt, normalize, slugify, indent },
    };
    document.dispatchEvent(new CustomEvent('npcbook:ready', { detail: window.NPCBook }));
}
