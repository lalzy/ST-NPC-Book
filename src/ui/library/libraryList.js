// NPC Library list (folder tree / search results).

import { hasChat } from '../../core/context.js';
import { allFolders, folderParent, inFolder, normFolder } from '../../core/folders.js';
import { lib, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { normalize } from '../../logic/text.js';
import { currentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { libState } from './state.js';

function libItemHtml(t, present, depth, showPath) {
    return `<div class="npcb-lib-item ${t.id === libState.selected && !libState.isNew ? 'active' : ''}" data-id="${esc(t.id)}" draggable="true" style="padding-left:${6 + depth * 14}px">
          ${avatarHtml(t, t.name, 'npcb-ava-sm')}
          <div class="npcb-lib-item-text"><div>${esc(t.name)} ${present.has(t.id) ? '<i class="fa-solid fa-circle npcb-present-dot" title="In this scene"></i>' : ''}${t.auto ? ' <small class="npcb-badge">auto</small>' : ''}</div>
          <small class="npcb-dim">${esc(showPath && t.folder ? `${t.folder} · ${t.id}` : t.id)}</small></div>
        </div>`;
}

export function renderLibraryList() {
    const modal = $('#npcb_library');
    if (!modal.length) return;
    const s = settings();
    const q = normalize(modal.find('.npcb-lib-search').val());
    const present = new Set(hasChat() ? currentRoster().map(i => i.id) : []);
    const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const all = Object.values(lib());
    const list = modal.find('.npcb-lib-list');
    if (q) {
        const hits = all.filter(t => normalize(`${t.name} ${t.id} ${t.description} ${t.folder || ''}`).includes(q)).sort(byName);
        list.html(hits.length ? hits.map(t => libItemHtml(t, present, 0, true)).join('') : '<div class="npcb-empty">No matching NPCs.</div>');
        return;
    }
    if (!all.length && !s.folders.length) { list.html('<div class="npcb-empty">No NPCs yet.</div>'); return; }
    const folders = allFolders();
    const collapsed = new Set(s.folderCollapsed);
    const npcsIn = (path) => all.filter(t => normFolder(t.folder) === path).sort(byName);
    const countIn = (path) => all.filter(t => inFolder(normFolder(t.folder), path)).length;
    const draw = (parent, depth) => {
        let html = '';
        for (const f of folders.filter(x => folderParent(x) === parent)) {
            const open = !collapsed.has(f);
            html += `<div class="npcb-lib-folder" data-path="${esc(f)}" style="padding-left:${4 + depth * 14}px">
                <i class="fa-solid fa-chevron-${open ? 'down' : 'right'} npcb-lib-fchev"></i><i class="fa-solid fa-folder${open ? '-open' : ''}"></i>
                <span class="npcb-lib-fname">${esc(f.split('/').pop())}</span><small class="npcb-dim">${countIn(f)}</small>
                <i class="fa-solid fa-ellipsis npcb-lib-fmenu" title="Folder actions"></i></div>`;
            if (open) html += draw(f, depth + 1);
        }
        return html + npcsIn(parent).map(t => libItemHtml(t, present, depth, false)).join('');
    };
    list.html(draw('', 0));
}
