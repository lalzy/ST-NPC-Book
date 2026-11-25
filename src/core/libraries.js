// Template libraries provided by sister extensions (def.templateLibrary), next to NPC Book's own NPC Library.
// A sister extension can keep its own cards (for example a Bestiary of enemies). NPC Book then:
//   - treats those ids as taken, so ids are unique across NPC Book and every extension library;
//   - looks ids and names up in all of them (<npc id="…"> speaker blocks, tracker matching, greetings);
//   - lets a library claim a NEW character the tracker creates, so it is stored there instead of the NPC Library.
// With no extension libraries registered, every helper behaves exactly like NPC Book's own library.

import { extensions } from './runtime.js';
import { lib } from './settings.js';

/** Registered extensions that provide a template library (templateLibrary.getAll). */
export function extLibraries() {
    return [...extensions.values()].filter(x => typeof x?.templateLibrary?.getAll === 'function');
}

/** One extension library's cards ({ [id]: template }), or {} when it fails. */
function cardsOf(ext) {
    try {
        const r = ext.templateLibrary.getAll();
        return r && typeof r === 'object' ? r : {};
    } catch (e) { console.warn(`[NPC Book] extension ${ext.id} templateLibrary.getAll failed`, e); return {}; }
}

/** Every known card: NPC Book's library plus every extension library. NPC Book's own card wins an id clash. */
export function allTemplates() {
    const own = lib();
    const libs = extLibraries();
    if (!libs.length) return own;
    const out = { ...own };
    for (const ext of libs) for (const [id, t] of Object.entries(cardsOf(ext))) if (t && !out[id]) out[id] = t;
    return out;
}

/** One card by id from any library, or null. */
export function anyTemplate(id) {
    const key = String(id ?? '');
    return lib()[key] ?? allTemplates()[key] ?? null;
}

/** True when an id is used by NPC Book's library or any extension library. */
export function idTaken(id) {
    const key = String(id ?? '');
    if (!key) return false;
    if (lib()[key]) return true;
    return extLibraries().some(ext => !!cardsOf(ext)[key]);
}

/** The extension whose library holds this id, or null (NPC Book's own library, or nowhere). */
export function libraryOf(id) {
    const key = String(id ?? '');
    if (lib()[key]) return null;
    return extLibraries().find(ext => !!cardsOf(ext)[key]) ?? null;
}

/** The first extension library that claims a NEW character from the tracker (templateLibrary.claim(entry, template)), or null. */
export function claimingLibrary(entry, template) {
    for (const ext of extLibraries()) {
        if (typeof ext.templateLibrary.claim !== 'function') continue;
        try { if (ext.templateLibrary.claim(entry, template)) return ext; } catch (e) { console.warn(`[NPC Book] extension ${ext.id} templateLibrary.claim failed`, e); }
    }
    return null;
}

/** Store a new card in an extension library (templateLibrary.add). Returns true when stored. */
export function addToLibrary(ext, template, entry) {
    if (typeof ext?.templateLibrary?.add !== 'function') return false;
    try { ext.templateLibrary.add(template, entry); return true; } catch (e) { console.warn(`[NPC Book] extension ${ext.id} templateLibrary.add failed`, e); return false; }
}

/** Open a card in its own library's window: the extension's templateLibrary.open(id). Returns true when an extension did. */
export function openInLibrary(id) {
    const ext = libraryOf(id);
    if (!ext || typeof ext.templateLibrary.open !== 'function') return false;
    try { ext.templateLibrary.open(id); return true; } catch (e) { console.warn(`[NPC Book] extension ${ext.id} templateLibrary.open failed`, e); return false; }
}
