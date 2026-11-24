// Picker popover for adding a library NPC to the scene.

import { hasChat } from '../../core/context.js';
import { allFolders, folderParent, inFolder, normFolder } from '../../core/folders.js';
import { traitSummary } from '../../core/npcs.js';
import { lib, save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { normalize } from '../../logic/text.js';
import { addToScene, currentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { renderLibraryList } from '../library/libraryList.js';
import { openLibrary } from '../library/modal.js';
import { closePopovers, placePopover } from '../popover.js';

export function openAddPicker(anchor) {
    closePopovers();
    if (!hasChat()) return;
    const present = new Set(currentRoster().map(i => i.id));
    const pop = $(`<div class="npcb-popover npcb-picker">
        <input type="search" class="text_pole npcb-picker-search" placeholder="Search NPCs…">
        <div class="npcb-picker-list"></div>
        <div class="menu_button npcb-picker-new"><i class="fa-solid fa-plus"></i> New NPC…</div>
    </div>`);
    const itemHtml = (t, depth, showPath) => `
            <div class="npcb-picker-item" data-id="${esc(t.id)}" style="padding-left:${4 + depth * 14}px">${avatarHtml(t, t.name, 'npcb-ava-sm')}
                <div><div>${esc(t.name)} <small class="npcb-dim">${esc(showPath && t.folder ? `${t.folder} · ${t.id}` : t.id)}</small></div><small class="npcb-dim">${esc(traitSummary(t) || t.description || '')}</small></div>
            </div>`;
    const draw = () => {
        const nq = normalize(pop.find('.npcb-picker-search').val());
        const byName = (a, b) => a.name.localeCompare(b.name);
        const avail = Object.values(lib()).filter(t => !present.has(t.id));
        const list = pop.find('.npcb-picker-list');
        if (nq) {
            const hits = avail.filter(t => normalize(`${t.name} ${t.id} ${t.description} ${t.folder || ''}`).includes(nq)).sort(byName);
            list.html(hits.length ? hits.map(t => itemHtml(t, 0, true)).join('') : '<div class="npcb-empty">No matching NPCs.</div>');
            return;
        }
        if (!avail.length) { list.html('<div class="npcb-empty">Everyone is already in the scene.</div>'); return; }
        // Same folders (and the same open / closed state) as the NPC Library; folders with nobody left to add are hidden.
        const collapsed = new Set(settings().folderCollapsed);
        const countIn = (path) => avail.filter(t => inFolder(normFolder(t.folder), path)).length;
        const folders = allFolders().filter(f => countIn(f) > 0);
        const tree = (parent, depth) => {
            let html = '';
            for (const f of folders.filter(x => folderParent(x) === parent)) {
                const open = !collapsed.has(f);
                html += `<div class="npcb-lib-folder npcb-picker-folder" data-path="${esc(f)}" style="padding-left:${4 + depth * 14}px">
                    <i class="fa-solid fa-chevron-${open ? 'down' : 'right'} npcb-lib-fchev"></i><i class="fa-solid fa-folder${open ? '-open' : ''}"></i>
                    <span class="npcb-lib-fname">${esc(f.split('/').pop())}</span><small class="npcb-dim">${countIn(f)}</small></div>`;
                if (open) html += tree(f, depth + 1);
            }
            return html + avail.filter(t => normFolder(t.folder) === parent).sort(byName).map(t => itemHtml(t, depth, false)).join('');
        };
        list.html(tree('', 0));
    };
    draw();
    pop.on('input', '.npcb-picker-search', draw);
    pop.on('click', '.npcb-picker-folder', (e) => {
        const s = settings();
        const path = String($(e.currentTarget).data('path'));
        s.folderCollapsed = s.folderCollapsed.includes(path) ? s.folderCollapsed.filter(f => f !== path) : [...s.folderCollapsed, path];
        save();
        draw();
        renderLibraryList();
    });
    pop.on('click', '.npcb-picker-item', (e) => { addToScene($(e.currentTarget).data('id')); closePopovers(); });
    pop.on('click', '.npcb-picker-new', () => { closePopovers(); openLibrary(null, true); });
    pop.on('click', e => e.stopPropagation());
    placePopover(pop, anchor);
    pop.find('input').trigger('focus');
}
