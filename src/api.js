// Public API for sister extensions (window.NPCBook) and the npcbook:ready event.

import { getUserAvatar } from '../../../../personas.js';
import { SLOT_LABEL } from './constants.js';
import { ctx, hasChat } from './core/context.js';
import { extensions } from './core/runtime.js';
import { lib, save, settings } from './core/settings.js';
import { customFields, customSections, fieldKey, fieldValue, sourceValue } from './core/fields.js';
import { allTemplates, anyTemplate, idTaken, libraryOf } from './core/libraries.js';
import { clone, esc, indent, initials, xa, xt } from './core/utils.js';
import { cloneScene } from './logic/instances.js';
import { parseLenientJson } from './logic/json.js';
import { resolveRef } from './logic/matching.js';
import { applyClothing, exposureSummary, findItem, findItemLoose, makeItem, outfitBySlot, resolveOutfit, wearItem } from './logic/outfit.js';
import { SLOTS, STACKING_SLOTS, inferSlots, normalizeSlot, normalizeSlots } from './logic/slots.js';
import { cleanId, normalize, pickEnum, slugify, uniqueId } from './logic/text.js';
import { closestEnum } from './logic/enumMatch.js';
import { updateAutoInjection } from './prompt/injection.js';
import { currentUser, personaData, personaKey } from './scene/persona.js';
import { addToScene, currentScene, currentRoster, findInstance, markDead, promptScene, removeFromScene, rosterAtMessage, writeCurrentScene } from './scene/roster.js';
import { avatarHtml } from './ui/avatar.js';
import { injectStyle } from './ui/injectStyle.js';
import { selectTemplate } from './ui/library/editor.js';
import { openTemplateExtSheet } from './ui/library/extSheet.js';
import { closeLibrary, openLibrary, renderModalButtons } from './ui/library/modal.js';
import { libState } from './ui/library/state.js';
import { openPersonaCharacter } from './ui/persona/personaCharacter.js';
import { closePopovers, placePopover } from './ui/popover.js';
import { openInstanceEditor } from './ui/roster/instanceEditor.js';
import { openInstanceExtSheet } from './ui/roster/instanceExtSheet.js';
import { isEnemy, renderRoster } from './ui/roster/rosterBar.js';
import { bindTabs } from './ui/tabs.js';

/** API version. 6 added: onTrackerEntry, transformEntry, entryKeys, placeholders, transformInstructions, transformScene,
 *  unregisterExtension, getExtData, setExtData, getUser, refreshPrompts. 7 added: outfitCatalog, onInstanceCreate,
 *  cardTab/personaSheet onSave, render ctx id/scope, sceneXml scene/sceneIds, onTrackerEntry scene, clothing, ui,
 *  getChatScene, getPromptScene, getSettings, openSheet. 8 added chatTab. 9 added modalButton, templateLibrary,
 *  isIdTaken, uniqueTemplateId, getAnyTemplate, getAllTemplates, getCardTabs, libraryOf, addToScene, removeFromScene, closeLibrary, refreshModalButtons.
 *  10 added sceneSide (scene bar split: friendly left, enemies right) and isEnemy.
 *  11 added markDead, and "dead": true in tracker entries (a dead character leaves the scene for good; its instance is kept, marked dead).
 *  12 added fields: values on every NPC card, placed in the card's root / Identity / Profile section, sent to and read from the LLM; getFields.
 *  13 added sections (new card sections next to Identity / Profile), derived fields (dependsOn + derive), getSections, getFieldValue.
 *  Full contract: EXTENDING.md. */
export const API_VERSION = 13;

/** Open an extension's sheet for one character in a popup. scope: 'instance' (this chat), 'template' (card), 'persona'. */
function openSheet(ref, extId, { scope = 'instance' } = {}) {
    if (scope === 'persona' || scope === 'user') return openPersonaCharacter(`ext:${extId}`);
    if (scope === 'template') { const id = resolveRef(ref, lib()); return id ? openTemplateExtSheet(id, extId) : undefined; }
    const inst = hasChat() ? findInstance(ref) : null;
    return inst ? openInstanceExtSheet(inst.id, extId) : undefined;
}

/** Open an NPC card in the Library window (on a tab: 'card', 'outfit' or 'ext:<id>'). */
function openCard(id, tab = 'card') {
    if ($('#npcb_library').is(':visible')) selectTemplate(id, false, tab);
    else openLibrary(id, false, tab);
}

function refreshOpenEditor() {
    if ($('#npcb_library').is(':visible') && (libState.selected || libState.isNew)) selectTemplate(libState.selected, libState.isNew);
}

/** Read one extension's data for a character. scope: 'instance' (this chat's NPC), 'template' (library card), 'persona', 'user'. */
function getExtData(ref, extId, { scope = 'instance' } = {}) {
    if (scope === 'persona') return clone(personaData().ext?.[extId] ?? null);
    if (scope === 'user') return hasChat() ? clone(currentUser().ext?.[extId] ?? personaData().ext?.[extId] ?? null) : null;
    if (scope === 'template') { const id = resolveRef(ref, lib()); return clone(id ? lib()[id]?.ext?.[extId] ?? null : null); }
    if (!hasChat()) return null;
    return clone(findInstance(ref)?.ext?.[extId] ?? null);
}

/** Write (and save) one extension's data for a character. Same scopes as getExtData. Returns true when written. */
function setExtData(ref, extId, data, { scope = 'instance' } = {}) {
    if (!extId) throw new Error('setExtData: extId required');
    const value = clone(data);
    if (scope === 'persona') {
        const p = personaData();
        p.ext = { ...(p.ext || {}), [extId]: value };
        save();
        renderRoster();
        return true;
    }
    if (scope === 'user') {
        if (!hasChat()) return false;
        const u = clone(currentUser());
        u.ext = { ...(u.ext || {}), [extId]: value };
        writeCurrentScene(null, u);
        return true;
    }
    if (scope === 'template') {
        const id = resolveRef(ref, lib());
        const t = id ? lib()[id] : null;
        if (!t) return false;
        t.ext = { ...(t.ext || {}), [extId]: value };
        save();
        updateAutoInjection();
        return true;
    }
    if (!hasChat()) return false;
    const scene = cloneScene(currentScene());
    const inst = findInstance(ref, scene);
    if (!inst) return false;
    inst.ext = { ...(inst.ext || {}), [extId]: value };
    writeCurrentScene(scene);
    return true;
}

export function exposePublicApi() {
    window.NPCBook = {
        version: API_VERSION,
        apiVersion: API_VERSION,
        /**
         * Register a sister extension. Every member except id is optional. See EXTENDING.md for the full contract.
         * def = { id, label?, defaultData?(),
         *         cardTab?: { label, icon?, render(host, {data, template, isNew, kind}) },
         *         personaSheet?: { label, icon?, render(host, {data, kind, name}) }, sheetLabel?,
         *         sceneXml?({kind, name, id, template, instance, data}) -> string,
         *         instructions?({autoCreate}) -> string, placeholders?: { KEY: () -> string },
         *         fromTracker?(entry, template) -> data,
         *         onTrackerEntry?({kind, source, id, name, entry, data, isNew, instance?}) -> data | undefined,
         *         transformEntry?(entry, {source, messageIndex}) -> entry | null | undefined, entryKeys?: [string],
         *         transformInstructions?(text, info) -> text, transformScene?(text, info) -> text,
         *         sceneButton?: { icon() -> 'fa-…', title() -> string, active?() -> bool, onClick(anchorEl) },
         *         fields?: [{ name, place?: 'root'|'identity'|'profile'|<section id>, before?, after?, type?: 'string'|'number'|'boolean', prompt?, key?, placeholder?, instruction?, dependsOn?, derive? }],
         *         sections?: [{ id, label, hint?, before?, after?, prompt? }] }
         * sceneButton adds an icon to the scene bar head (next to Add NPC / Folder); active() === false dims it.
         * Call refreshScene() after changing what it shows.
         * Card/persona `data` objects are mutable drafts; NPC Book saves them when the user presses Save.
         * Registering the same id again replaces the earlier definition.
         */
        registerExtension(def) {
            if (!def?.id) throw new Error('registerExtension: id required');
            extensions.set(def.id, def);
            renderModalButtons();
            refreshOpenEditor();
            renderRoster();
            updateAutoInjection();
        },
        /** Remove a registered extension. Its stored data is kept. Returns true when it was registered. */
        unregisterExtension(id) {
            const had = extensions.delete(id);
            if (had) { renderModalButtons(); refreshOpenEditor(); renderRoster(); updateAutoInjection(); }
            return had;
        },
        /** Redraw the scene bar (and its sister-extension buttons) and refresh injected prompts. */
        refreshScene: () => renderRoster(),
        getLibrary: () => lib(),
        getTemplate: (id) => lib()[id] || null,
        /** A card from NPC Book's library or any extension library (templateLibrary), or null. */
        getAnyTemplate: (id) => anyTemplate(id),
        /** Every card: NPC Book's library plus extension libraries ({ [id]: template }, live objects). */
        getAllTemplates: () => allTemplates(),
        /** True when an id is used by NPC Book's library or any extension library. Ids are unique across all of them. */
        isIdTaken: (id) => idTaken(id),
        /** A free id made from a name or id (slugified; "_2", "_3"… added while taken in any library or this chat). */
        uniqueTemplateId: (base) => uniqueId(base, x => idTaken(x) || (hasChat() && !!currentScene().instances[x])),
        /** The extension id whose templateLibrary holds this card, 'npcbook' for NPC Book's own library, or null. */
        libraryOf: (id) => (lib()[String(id ?? '')] ? 'npcbook' : libraryOf(id)?.id ?? null),
        /** Put a card (any library) or this chat's instance into the scene. */
        addToScene: (id) => addToScene(id),
        /** Take an NPC out of the scene (its instance stays in the chat). */
        removeFromScene: (id) => removeFromScene(id),
        /** A character died: take it out of this chat's scene and mark its instance dead (card and instance kept). API 11. */
        markDead: (id) => (hasChat() ? markDead(id) : false),
        /** Whether a scene character (id, name or instance) is shown on the enemy side of the scene bar. */
        isEnemy: (ref) => { const inst = ref && typeof ref === 'object' ? ref : (hasChat() ? findInstance(ref) : null); return !!inst && isEnemy(inst); },
        /** Close the NPC Book window. */
        closeLibrary: () => closeLibrary(),
        /**
         * Registered sister extensions' card tabs, so an extension library (e.g. a Bestiary) can show the same tabs as an NPC card:
         * [{ id, label, icon, render(host, ctx), onSave?(info), defaultData() }]. `host` must be a jQuery element.
         */
        getCardTabs: () => [...extensions.values()].filter(x => x?.cardTab && typeof x.cardTab.render === 'function').map(x => ({
            id: x.id, label: x.cardTab.label || x.label || x.id, icon: x.cardTab.icon || 'fa-table-list',
            render: x.cardTab.render, onSave: x.cardTab.onSave,
            defaultData: () => (typeof x.defaultData === 'function' ? x.defaultData() : {}),
        })),
        /** Redraw sister extensions' buttons in the NPC Book window header (after their icon / title / active state changed). */
        refreshModalButtons: () => renderModalButtons(),
        getPersonaData: (extId) => personaData().ext?.[extId] ?? null,
        /** Every registered field (API 12), normalized: [{ extId, name, place, before, after, type, prompt, key, placeholder, instruction }]. */
        getFields: () => customFields().map(f => ({ ...f })),
        /** Every registered section (API 13): [{ extId, id, label, hint, before, after, prompt }]. */
        getSections: () => customSections().map(s => ({ ...s })),
        /**
         * One field's value for a character (API 13), derived fields worked out: by prompt name or label of an extension
         * field, or an Identity key / profile field / name / id. scope: 'instance' (this chat, default) or 'template'.
         */
        getFieldValue(ref, name, { scope = 'instance' } = {}) {
            const card = scope === 'template' ? (lib()[resolveRef(ref, lib())] ?? null) : (hasChat() ? findInstance(ref) : null);
            if (!card) return undefined;
            const f = customFields().find(x => fieldKey(x.prompt) === fieldKey(name) || fieldKey(x.name) === fieldKey(name));
            return clone(f ? fieldValue(card, f) : sourceValue(card, name));
        },
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
        resolveNpc: (ref) => (hasChat() ? findInstance(ref)?.id : null) ?? resolveRef(ref, allTemplates()),
        /** This chat's user state (posture, outfit, and `ext` once an extension wrote per-chat user data), or null. */
        getUser: () => (hasChat() ? clone(currentUser()) : null),
        getExtData,
        setExtData,
        /** Rebuild the injected prompts (after your sceneXml / instructions / placeholders would give different text). */
        refreshPrompts: () => updateAutoInjection(),
        /** The open chat's scene as stored now: { instances: {id: instance}, active: [id] } (read only), or null. */
        getChatScene: () => (hasChat() ? currentScene() : null),
        /** The scene the next prompt describes (during a swipe: the one before the reply being replaced). Read only. */
        getPromptScene: () => (hasChat() ? promptScene() : null),
        /** NPC Book's own settings (read only): postures, states, conditions, traitKeys, … */
        getSettings: () => settings(),
        openSheet,
        openPersonaCharacter,
        saveSettings: save,
        util: { esc, xa, xt, normalize, slugify, indent, clone, uniqueId, pickEnum, closestEnum, cleanId, initials, parseJson: parseLenientJson },
        /** Clothing model shared by the paperdoll, the tracker and sister extensions (items: {id, name, slots, condition?, note?}). */
        clothing: { SLOTS, SLOT_LABEL, STACKING_SLOTS, inferSlots, normalizeSlot, normalizeSlots, findItem, findItemLoose, makeItem, wearItem, outfitBySlot, resolveOutfit, applyClothing, exposureSummary },
        /** NPC Book's UI building blocks, so sister extensions look the same without copying them. */
        ui: {
            avatarHtml, injectStyle, bindTabs, closePopovers, placePopover, openCard, openInstanceEditor,
            /** Your persona's avatar URL ('' when none). */
            personaAvatar: () => (personaKey() ? getUserAvatar(personaKey()) : ''),
        },
    };
    document.dispatchEvent(new CustomEvent('npcbook:ready', { detail: window.NPCBook }));
}
