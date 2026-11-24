// Portrait source menu and server image browser.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx } from '../../core/context.js';
import { esc } from '../../core/utils.js';
import { normalize } from '../../logic/text.js';
import { closePopovers, placePopover } from '../popover.js';

export function openPortraitMenu(anchor, actions) {
    closePopovers();
    const items = [
        ['local', 'fa-upload', 'From this device'],
        ['server', 'fa-server', 'From the server (ST images)'],
        ['crop', 'fa-crop-simple', 'Crop current'],
        ['generate', 'fa-wand-magic-sparkles', 'Generate'],
        ['remove', 'fa-trash-can', 'Remove'],
    ].filter(([k]) => actions[k]);
    const pop = $(`<div class="npcb-popover npcb-menu">${items.map(([k, icon, label]) => `<div class="npcb-menu-item" data-act="${k}"><i class="fa-solid ${icon}"></i> ${label}</div>`).join('')}</div>`);
    pop.on('click', e => e.stopPropagation());
    pop.on('click', '.npcb-menu-item', (e) => { const k = $(e.currentTarget).data('act'); closePopovers(); actions[k]?.(); });
    placePopover(pop, anchor);
}

/** Browse images stored on the SillyTavern server: gallery folders, character avatars, persona avatars. */
export async function openServerImagePicker() {
    const c = ctx();
    const headers = c.getRequestHeaders();
    let folders = [];
    try { folders = await (await fetch('/api/images/folders', { method: 'POST', headers, body: '{}' })).json(); } catch { folders = []; }
    const sources = [
        { key: '__chars', label: 'Character avatars' },
        { key: '__personas', label: 'Persona avatars' },
        ...folders.sort((a, b) => a.localeCompare(b)).map(f => ({ key: f, label: `Gallery: ${f}` })),
    ];
    const box = $(`<div class="npcb-srv">
        <div class="npcb-row"><select class="text_pole npcb-srv-src">${sources.map(x => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}</select>
        <input type="search" class="text_pole npcb-srv-filter" placeholder="Filter…"></div>
        <div class="npcb-srv-grid"></div></div>`);
    let chosen = null;
    let items = [];
    const popup = new c.Popup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: false, cancelButton: 'Cancel' });
    const drawGrid = () => {
        const q = normalize(box.find('.npcb-srv-filter').val());
        const list = items.filter(x => !q || normalize(x.label).includes(q)).slice(0, 400);
        box.find('.npcb-srv-grid').html(list.length ? list.map(x => `<div class="npcb-srv-item" data-url="${esc(x.url)}" title="${esc(x.label)}"><img loading="lazy" src="${esc(x.thumb || x.url)}"><span>${esc(x.label)}</span></div>`).join('') : '<div class="npcb-empty">No images here.</div>');
    };
    const load = async (key) => {
        box.find('.npcb-srv-grid').html('<div class="npcb-empty">Loading…</div>');
        if (key === '__chars') {
            items = (c.characters || []).filter(ch => ch?.avatar).map(ch => ({ label: ch.name, url: `/characters/${encodeURIComponent(ch.avatar)}`, thumb: c.getThumbnailUrl('avatar', ch.avatar) }));
        } else if (key === '__personas') {
            const ps = c.powerUserSettings?.personas || {};
            items = Object.entries(ps).map(([file, name]) => ({ label: String(name || file), url: getUserAvatar(file), thumb: c.getThumbnailUrl('persona', file) }));
        } else {
            let files = [];
            try { files = await (await fetch('/api/images/list', { method: 'POST', headers, body: JSON.stringify({ folder: key, sortField: 'date', sortOrder: 'desc' }) })).json(); } catch { files = []; }
            items = (Array.isArray(files) ? files : []).map(f => ({ label: f, url: `/user/images/${encodeURIComponent(key)}/${encodeURIComponent(f)}` }));
        }
        drawGrid();
    };
    box.on('change', '.npcb-srv-src', (e) => load(String(e.target.value)));
    box.on('input', '.npcb-srv-filter', drawGrid);
    box.on('click', '.npcb-srv-item', (e) => { chosen = $(e.currentTarget).data('url'); popup.complete(c.POPUP_RESULT.AFFIRMATIVE); });
    load(sources[0].key);
    await popup.show();
    return chosen;
}
