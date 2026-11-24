// Folder actions in the NPC Library (menu, rename, move NPCs).

import { ctx } from '../../core/context.js';
import { dissolveFolder, folderParent, inFolder, normFolder, registerFolder, renameFolder } from '../../core/folders.js';
import { lib, save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { slugify } from '../../logic/text.js';
import { openMenu } from '../popover.js';
import { selectTemplate } from './editor.js';
import { exportNpcs } from './importExport.js';
import { renderLibraryList } from './libraryList.js';
import { libState } from './state.js';

export function moveNpcToFolder(id, path) {
    const t = lib()[id];
    if (!t) return;
    t.folder = normFolder(path);
    registerFolder(t.folder);
    save();
    renderLibraryList();
    if (libState.selected === id) $('#npcb_library .npcb-ed-folder').val(t.folder);
}

export async function askFolderName(title, value = '') {
    const c = ctx();
    const res = await c.callGenericPopup(title, c.POPUP_TYPE.INPUT, value, { okButton: 'OK', cancelButton: 'Cancel' });
    if (res === null || res === false || res === undefined) return null;
    return normFolder(res);
}

export function openFolderMenu(anchor, path) {
    const s = settings();
    const npcs = () => Object.values(lib()).filter(t => inFolder(normFolder(t.folder), path));
    openMenu(anchor, [
        { icon: 'fa-user-plus', label: 'New NPC here', run: () => { libState.newFolder = path; selectTemplate(null, true); } },
        { icon: 'fa-folder-plus', label: 'New subfolder…', run: async () => {
            const name = await askFolderName(`New folder inside <b>${esc(path)}</b>:`);
            if (!name) return;
            registerFolder(`${path}/${name}`);
            s.folderCollapsed = s.folderCollapsed.filter(f => f !== path);
            save(); renderLibraryList();
        } },
        { icon: 'fa-pen', label: 'Rename / move…', run: async () => {
            const to = await askFolderName('Folder path (use / for subfolders):', path);
            if (!to || to === path) return;
            if (inFolder(to, path)) { toastr.warning('A folder cannot be moved into itself.', 'NPC Book'); return; }
            renameFolder(path, to);
            save(); renderLibraryList();
            if (libState.selected && lib()[libState.selected]) $('#npcb_library .npcb-ed-folder').val(lib()[libState.selected].folder || '');
        } },
        { icon: 'fa-file-export', label: `Export folder (${npcs().length})`, run: () => exportNpcs(npcs(), `${slugify(path)}.npcbook.json`) },
        { icon: 'fa-folder-minus', label: 'Remove folder (keeps NPCs)', danger: true, run: async () => {
            const c = ctx();
            const parent = folderParent(path);
            const ok = await c.callGenericPopup(`Remove the folder <b>${esc(path)}</b>? Its ${npcs().length} NPC(s) and subfolders move to <b>${esc(parent || 'the top level')}</b>. No NPCs are deleted.`, c.POPUP_TYPE.CONFIRM);
            if (!ok) return;
            dissolveFolder(path);
            save(); renderLibraryList();
            if (libState.selected && lib()[libState.selected]) $('#npcb_library .npcb-ed-folder').val(lib()[libState.selected].folder || '');
        } },
    ]);
}
