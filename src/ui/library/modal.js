// NPC Library window: top-bar button, modal shell and its event wiring.

import { registerFolder } from '../../core/folders.js';
import { lib, save, settings } from '../../core/settings.js';
import { bindAssist } from '../assist/assistPanel.js';
import { selectTemplate } from './editor.js';
import { askFolderName, moveNpcToFolder, openFolderMenu } from './folderMenu.js';
import { exportLibrary, importLibrary } from './importExport.js';
import { renderLibraryList } from './libraryList.js';
import { libState } from './state.js';

export function ensureTopButton() {
    if ($('#npcb_topbar').length) return;
    const btn = $(`<div id="npcb_topbar" class="drawer"><div class="drawer-toggle drawer-header">
        <div class="drawer-icon fa-solid fa-users-viewfinder fa-fw closedIcon" title="NPC Book"></div></div></div>`);
    const anchor = $('#rightNavHolder');
    if (anchor.length) anchor.before(btn); else $('#top-settings-holder').append(btn);
    btn.on('click', (e) => { e.stopPropagation(); openLibrary(); });
}

export function ensureLibraryModal() {
    if ($('#npcb_library').length) return;
    const modal = $(`
    <div id="npcb_library" class="npcb-modal" style="display:none">
      <div class="npcb-modal-panel">
        <div class="npcb-modal-head">
          <b><i class="fa-solid fa-users-viewfinder"></i> NPC Book</b>
          <span class="npcb-spacer"></span>
          <div class="menu_button npcb-lib-import" title="Import JSON"><i class="fa-solid fa-file-import"></i></div>
          <div class="menu_button npcb-lib-export" title="Export all NPCs as JSON"><i class="fa-solid fa-file-export"></i></div>
          <div class="menu_button npcb-lib-close" title="Close"><i class="fa-solid fa-xmark"></i></div>
          <input type="file" class="npcb-lib-import-file" accept=".json,application/json" hidden>
        </div>
        <div class="npcb-modal-body">
          <div class="npcb-lib-side">
            <div class="npcb-row">
              <input type="search" class="text_pole npcb-lib-search" placeholder="Search…">
              <div class="menu_button npcb-lib-newfolder" title="New folder"><i class="fa-solid fa-folder-plus"></i></div>
              <div class="menu_button npcb-lib-new" title="New NPC"><i class="fa-solid fa-plus"></i></div>
            </div>
            <div class="npcb-lib-list"></div>
          </div>
          <div class="npcb-lib-editor"></div>
          <div class="npcb-assist" style="display:none"></div>
        </div>
      </div>
    </div>`);
    $('body').append(modal);
    modal.on('click', (e) => { if (e.target === modal[0]) closeLibrary(); });
    modal.on('click', '.npcb-lib-close', closeLibrary);
    modal.on('click', '.npcb-lib-new', () => { libState.newFolder = (libState.selected && lib()[libState.selected]?.folder) || ''; selectTemplate(null, true); });
    modal.on('click', '.npcb-lib-newfolder', async () => {
        const name = await askFolderName('New folder (use / for subfolders, e.g. <i>Eldoria/Village</i>):');
        if (!name) return;
        registerFolder(name);
        save(); renderLibraryList();
    });
    modal.on('click', '.npcb-lib-folder', (e) => {
        const path = String($(e.currentTarget).data('path'));
        if ($(e.target).is('.npcb-lib-fmenu')) { e.stopPropagation(); openFolderMenu(e.target, path); return; }
        const s = settings();
        s.folderCollapsed = s.folderCollapsed.includes(path) ? s.folderCollapsed.filter(f => f !== path) : [...s.folderCollapsed, path];
        save(); renderLibraryList();
    });
    // drag an NPC onto a folder (or onto empty list space for the top level)
    modal.on('dragstart', '.npcb-lib-item', (e) => { e.originalEvent.dataTransfer.setData('text/x-npcb-id', String($(e.currentTarget).data('id'))); e.originalEvent.dataTransfer.effectAllowed = 'move'; });
    modal.on('dragover', '.npcb-lib-folder, .npcb-lib-list', (e) => {
        if (![...(e.originalEvent.dataTransfer?.types || [])].includes('text/x-npcb-id')) return;
        e.preventDefault();
        e.stopPropagation();
        modal.find('.npcb-drop').removeClass('npcb-drop');
        $(e.currentTarget).addClass('npcb-drop');
    });
    modal.on('dragleave drop', '.npcb-lib-folder, .npcb-lib-list', (e) => { $(e.currentTarget).removeClass('npcb-drop'); });
    modal.on('drop', '.npcb-lib-folder, .npcb-lib-list', (e) => {
        const id = e.originalEvent.dataTransfer?.getData('text/x-npcb-id');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        modal.find('.npcb-drop').removeClass('npcb-drop');
        moveNpcToFolder(id, $(e.currentTarget).is('.npcb-lib-folder') ? String($(e.currentTarget).data('path')) : '');
    });
    modal.on('input', '.npcb-lib-search', renderLibraryList);
    modal.on('click', '.npcb-lib-item', (e) => selectTemplate($(e.currentTarget).data('id')));
    modal.on('click', '.npcb-lib-export', exportLibrary);
    modal.on('click', '.npcb-lib-import', () => modal.find('.npcb-lib-import-file').trigger('click'));
    modal.on('change', '.npcb-lib-import-file', importLibrary);
    bindAssist(modal);
}

export function openLibrary(id = null, isNew = false, tab = 'card') {
    ensureLibraryModal();
    $('#npcb_library').css('display', 'flex');
    renderLibraryList();
    const first = id ?? libState.selected ?? Object.keys(lib()).sort()[0] ?? null;
    selectTemplate(isNew ? null : first, isNew || !first, tab);
}

export function closeLibrary() { $('#npcb_library').hide(); }
