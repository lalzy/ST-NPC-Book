// NPC Library JSON import / export.

import { normFolder, registerFolder } from '../../core/folders.js';
import { lib, save } from '../../core/settings.js';
import { clone } from '../../core/utils.js';
import { downscaleUrl, uploadPortrait } from '../../images/imageTools.js';
import { ID_PATTERN, slugify, uniqueId } from '../../logic/text.js';
import { renderRoster } from '../roster/rosterBar.js';
import { renderLibraryList } from './libraryList.js';

/** A card ready to share: no local bookkeeping, portrait embedded so it works on another SillyTavern. */
async function portableNpc(t) {
    const out = clone(t);
    delete out.auto;
    delete out.created;
    delete out.updated;
    if (out.portrait && !String(out.portrait).startsWith('data:')) {
        try { out.portrait = await downscaleUrl(out.portrait, 512); } catch (e) { console.warn(`[NPC Book] could not embed portrait of ${t.id}`, e); }
    }
    return out;
}

export async function exportNpcs(list, filename) {
    if (!list.length) return;
    const npcs = [];
    for (const t of list) npcs.push(await portableNpc(t));
    const blob = new Blob([JSON.stringify({ npcbook: 1, npcs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportLibrary() {
    return exportNpcs(Object.values(lib()), `npc-book-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importLibrary(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        const list = Array.isArray(data) ? data : (data.npcs || []);
        let added = 0, renamed = 0;
        for (const raw of list) {
            if (!raw?.name) continue;
            let id = String(raw.id || '').toLowerCase();
            if (!ID_PATTERN.test(id)) id = slugify(raw.name);
            if (lib()[id]) { id = uniqueId(id, x => !!lib()[x]); renamed++; }
            const npc = { portrait: '', description: '', details: '', traits: {}, height: '', pronouns: '', sexuality: '', sexualExperience: '', dialogue: [], ...raw, id, created: Date.now() };
            if (String(npc.portrait).startsWith('data:')) {
                try { npc.portrait = await uploadPortrait(npc.portrait, id); } catch (err) { console.warn('[NPC Book] portrait upload failed, keeping it inline', err); }
            }
            npc.folder = normFolder(npc.folder);
            registerFolder(npc.folder);
            lib()[id] = npc;
            added++;
        }
        save();
        renderLibraryList();
        renderRoster();
        toastr.success(`Imported ${added} NPC(s)${renamed ? `, ${renamed} got a new ID because theirs was taken` : ''}.`, 'NPC Book');
    } catch (err) {
        toastr.error('Invalid JSON file.', 'NPC Book');
    }
}
