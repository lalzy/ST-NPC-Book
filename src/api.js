// Public API for sister extensions (window.NPCBook) and the npcbook:ready event.

import { ctx, hasChat } from './core/context.js';
import { templateFor } from './core/npcs.js';
import { extensions } from './core/runtime.js';
import { lib, save } from './core/settings.js';
import { esc, indent, xa, xt } from './core/utils.js';
import { resolveRef } from './logic/matching.js';
import { normalize, slugify } from './logic/text.js';
import { updateAutoInjection } from './prompt/injection.js';
import { personaData } from './scene/persona.js';
import { currentRoster, rosterAtMessage } from './scene/roster.js';
import { selectTemplate } from './ui/library/editor.js';
import { libState } from './ui/library/state.js';
import { openPersonaCharacter } from './ui/persona/personaCharacter.js';

export function exposePublicApi() {
    window.NPCBook = {
        version: 3,
        /**
         * Register a sister extension.
         * def = { id, label?, defaultData?(), cardTab?: { label, render(host, {data, template, isNew, kind}) },
         *         personaSheet?: { label, icon?, render(host, {data, kind, name}) },
         *         sceneXml?({kind, name, id, template, instance, data}) -> string,
         *         instructions?({autoCreate}) -> string, fromTracker?(entry, template) -> data }
         * Card/persona `data` objects are mutable drafts; NPC Book saves them when the user presses Save.
         */
        registerExtension(def) {
            if (!def?.id) throw new Error('registerExtension: id required');
            extensions.set(def.id, def);
            if ($('#npcb_library').is(':visible') && (libState.selected || libState.isNew)) selectTemplate(libState.selected, libState.isNew);
            updateAutoInjection();
        },
        getLibrary: () => lib(),
        getTemplate: (id) => lib()[id] || null,
        getPersonaData: (extId) => personaData().ext?.[extId] ?? null,
        /** Who is in the current scene: [{ id, name, template }] plus your persona's name. */
        getScene: () => ({
            roster: hasChat() ? currentRoster().map(i => ({ id: i.id, name: templateFor(i)?.name ?? i.name ?? i.id, template: templateFor(i) })) : [],
            userName: ctx().name1,
        }),
        /** Who was in the scene at a chat message (for the last message: before + after it): [{ id, name, template }]. */
        getRosterAt: (idx) => (hasChat() ? rosterAtMessage(Number(idx)) : []).map(id => ({ id, name: lib()[id]?.name ?? id, template: lib()[id] || null })),
        /** Resolve an id or name (as written by the LLM in <npc id="…">) to a library id, or null. */
        resolveNpc: (ref) => resolveRef(ref, lib()),
        openPersonaCharacter,
        saveSettings: save,
        util: { esc, xa, xt, normalize, slugify, indent },
    };
    document.dispatchEvent(new CustomEvent('npcbook:ready', { detail: window.NPCBook }));
}
