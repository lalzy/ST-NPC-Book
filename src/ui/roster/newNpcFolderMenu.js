// Scene bar folder menu: pick where NPCs the LLM creates in this chat are filed in the NPC Library.

import { ctx, meta } from '../../core/context.js';
import { allFolders, chatNewNpcFolder, normFolder, registerFolder } from '../../core/folders.js';
import { save, settings } from '../../core/settings.js';
import { askFolderName } from '../library/folderMenu.js';
import { openMenu } from '../popover.js';
import { renderRoster } from './rosterBar.js';

function setChatFolder(path) {
    const m = meta();
    if (!m) return;
    if (path === undefined) delete m.newNpcFolder; else m.newNpcFolder = normFolder(path);
    ctx().saveMetadataDebounced?.();
    renderRoster();
}

export function openNewNpcFolderMenu(anchor) {
    const cur = chatNewNpcFolder();
    const def = normFolder(settings().autoFolder);
    const mark = (on) => (on ? 'fa-check' : 'fa-folder');
    const items = [
        { icon: mark(cur === undefined), label: `Default from Settings (${def || 'top level'})`, run: () => setChatFolder(undefined) },
        { icon: mark(cur === ''), label: 'Top level', run: () => setChatFolder('') },
        ...allFolders().map(f => ({ icon: mark(cur === f), label: `${'   '.repeat(f.split('/').length - 1)}${f.split('/').pop()}`, run: () => setChatFolder(f) })),
        { icon: 'fa-folder-plus', label: 'New folder…', run: async () => {
            const name = await askFolderName('New folder for this chat\'s new NPCs (use / for subfolders):');
            if (!name) return;
            registerFolder(name);
            save();
            setChatFolder(name);
        } },
    ];
    openMenu(anchor, items);
}
