// NPC library folder model: path normalisation, listing, rename and dissolve.

import { lib, settings } from './settings.js';

/** "  Eldoria / Village/ " → "Eldoria/Village" ('' = no folder). */
export function normFolder(path) {
    return String(path ?? '').split('/').map(x => x.trim()).filter(Boolean).join('/');
}
export const folderParent = (path) => path.split('/').slice(0, -1).join('/');
export const inFolder = (folder, path) => folder === path || folder.startsWith(`${path}/`);

/** Every folder that exists: saved ones, ones NPCs are in, and all their parents. */
export function allFolders() {
    const out = new Set();
    const add = (p) => { p = normFolder(p); while (p) { out.add(p); p = folderParent(p); } };
    for (const f of settings().folders) add(f);
    for (const t of Object.values(lib())) add(t.folder);
    return [...out].sort((a, b) => a.localeCompare(b));
}

export function registerFolder(path) {
    const s = settings();
    path = normFolder(path);
    if (path && !s.folders.includes(path)) s.folders.push(path);
}

/** Rename / move a folder (and everything under it). */
export function renameFolder(from, to) {
    const s = settings();
    const re = (p) => (p === from ? to : p.startsWith(`${from}/`) ? normFolder(`${to}/${p.slice(from.length + 1)}`) : p);
    for (const t of Object.values(lib())) if (t.folder) t.folder = re(t.folder);
    s.folders = [...new Set(s.folders.map(re).filter(Boolean))];
    s.folderCollapsed = [...new Set(s.folderCollapsed.map(re).filter(Boolean))];
}

/** Remove a folder level: its NPCs and subfolders move up to the parent. Nothing is deleted. */
export function dissolveFolder(path) {
    const s = settings();
    const parent = folderParent(path);
    const re = (p) => (p === path ? parent : p.startsWith(`${path}/`) ? normFolder(`${parent}/${p.slice(path.length + 1)}`) : p);
    for (const t of Object.values(lib())) if (t.folder) t.folder = re(t.folder);
    s.folders = [...new Set(s.folders.filter(f => f !== path).map(re).filter(Boolean))];
    s.folderCollapsed = s.folderCollapsed.filter(f => !inFolder(f, path));
}
