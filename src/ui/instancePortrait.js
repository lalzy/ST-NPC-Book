// Instance portraits.
// - Roster instance popover: click the portrait to view, replace, crop, regenerate or remove it. Mirrors the
//   Library card's portrait options, but writes to this chat's instance only (never to the template).
//   The popover stays open while the menu is used, and its portrait updates in place.
// - In-chat speaker card: click the portrait to expand it, like SillyTavern's zoomed character avatar.

import { ctx, hasChat } from '../core/context.js';
import { esc } from '../core/utils.js';
import { cropImageUrl, readFileAsDataUrl, uploadPortrait } from '../images/imageTools.js';
import { ensurePortrait } from '../portraits/portraitQueue.js';
import { findInstance, patchInstanceEverywhere } from '../scene/roster.js';
import { decorateAll } from '../speakers/decorate.js';
import { avatarHtml } from './avatar.js';
import { openPortraitMenu, openServerImagePicker } from './library/portraitPicker.js';
import { renderRoster } from './roster/rosterBar.js';

/** Open the full portrait in a large popup. */
function viewPortrait(url, name) {
    const c = ctx();
    const box = $(`<div class="npcb-pview"><img class="npcb-pview-img" src="${esc(url)}" alt="${esc(name)}" draggable="false"></div>`);
    new c.Popup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Close' }).show();
}

/** Update the portrait in an open roster instance popover for this NPC (if any). */
export function refreshInstancePopoverHead(id, url) {
    $('.npcb-popover.npcb-inst').filter((_, el) => el.dataset.npcbInst === id).each((_, el) => {
        const inst = findInstance(id);
        const name = inst?.name || id;
        $(el).find('.npcb-inst-head .npcb-ava').replaceWith($(avatarHtml({ portrait: url }, name, 'npcb-ava-md')).attr('title', 'Click to change portrait').addClass('npcb-ava-click'));
    });
}

/** Store a new portrait on the instance (uploading data URLs to the server first), then refresh what shows it. */
async function setInstancePortrait(id, url) {
    let portrait = url || '';
    if (portrait.startsWith('data:')) {
        try { portrait = await uploadPortrait(portrait, `${id}_chat`); } catch (e) { console.warn('[NPC Book] upload failed, storing inline', e); }
    }
    patchInstanceEverywhere(id, { portrait });
    renderRoster();
    decorateAll();
    refreshInstancePopoverHead(id, portrait);
}

function pickLocalFile() {
    return new Promise((resolve) => {
        const input = $('<input type="file" accept="image/*" style="display:none">');
        $('body').append(input);
        input.on('click', e => e.stopPropagation());
        input.on('change', async (e) => {
            const file = e.target.files?.[0];
            input.remove();
            if (!file) { resolve(null); return; }
            try { resolve(await readFileAsDataUrl(file)); } catch { toastr.error('Could not read image.', 'NPC Book'); resolve(null); }
        });
        input[0].click();
    });
}

/** Portrait menu for one instance of the open chat (opened from the roster instance popover, which stays open). */
export function openInstancePortraitMenuFor(id, anchor) {
    if (!hasChat()) return;
    const inst = findInstance(id);
    if (!inst) return;
    const current = () => findInstance(id)?.portrait || '';
    const usePicked = async (url) => {
        if (!url) return;
        const cropped = await cropImageUrl(url, true);
        await setInstancePortrait(id, cropped || url);
    };
    openPortraitMenu(anchor, {
        view: current() ? () => viewPortrait(current(), inst.name) : null,
        local: async () => usePicked(await pickLocalFile()),
        server: async () => usePicked(await openServerImagePicker()),
        crop: async () => {
            const cur = current();
            if (!cur) { toastr.info('No portrait to crop yet.', 'NPC Book'); return; }
            const cropped = await cropImageUrl(cur, false);
            if (cropped) await setInstancePortrait(id, cropped);
        },
        generate: () => { toastr.info(`Generating a portrait for ${inst.name}…`, 'NPC Book'); ensurePortrait(id, { force: true, target: 'instance' }); },
        remove: () => setInstancePortrait(id, ''),
    }, { keepOpen: true });
}

/* ---------- In-chat card: expand the portrait (self-contained overlay, no SillyTavern internals) ---------- */

const imp = (el, css) => { for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v, 'important'); };

function closeZoom() { document.getElementById('npcb_zoom_overlay')?.remove(); }

function zoomPortrait(url, name) {
    closeZoom();
    const ov = document.createElement('div');
    ov.id = 'npcb_zoom_overlay';
    imp(ov, { position: 'fixed', inset: '0', 'z-index': '99999', display: 'flex', 'align-items': 'center', 'justify-content': 'center', background: 'rgba(0,0,0,.8)', cursor: 'zoom-out', margin: '0', padding: '0', opacity: '1', visibility: 'visible', 'pointer-events': 'auto' });
    const img = document.createElement('img');
    img.src = url;
    img.alt = name || '';
    img.draggable = false;
    imp(img, { display: 'block', 'max-width': '92vw', 'max-height': '92vh', width: 'auto', height: 'auto', 'object-fit': 'contain', 'border-radius': '10px', 'box-shadow': '0 8px 40px rgba(0,0,0,.6)', margin: '0', padding: '0', border: '0', opacity: '1', visibility: 'visible' });
    const x = document.createElement('div');
    x.className = 'fa-solid fa-xmark';
    x.title = 'Close';
    imp(x, { position: 'absolute', top: '14px', right: '18px', 'font-size': '28px', color: '#fff', cursor: 'pointer', display: 'block', opacity: '.85' });
    ov.append(img, x);
    // Any click closes it; clicks never reach SillyTavern's handlers underneath.
    ov.addEventListener('click', (e) => { e.stopPropagation(); closeZoom(); });
    document.body.appendChild(ov);
}

function onChatAvatarClick(anchor) {
    const turn = anchor.closest('div[data-npcb-turn]');
    const raw = turn?.getAttribute('data-npcb-turn') || '';
    const inst = hasChat() ? findInstance(raw) : null;
    // Same source as the card shows (decorate.js): the instance, else what the avatar box is painted with.
    const bg = (anchor.style.backgroundImage || '').match(/^url\((["']?)(.*)\1\)$/)?.[2] || '';
    const url = inst?.portrait || bg;
    if (!url) return; // no portrait: nothing to expand
    zoomPortrait(url, inst?.name || anchor.title || raw);
}

let bound = false;
export function bindInstancePortraitClicks() {
    if (bound) return;
    bound = true;
    // Capture phase on the document: runs before any SillyTavern handler can stop the click.
    document.addEventListener('click', (e) => {
        const ava = e.target?.closest?.('[data-npcb-ava]');
        if (!ava || !ava.closest('#chat') || !ava.parentElement?.matches('div[data-npcb-turn]')) return;
        if (document.getElementById('chat')?.classList.contains('npcb-cards-off')) return;
        e.preventDefault();
        e.stopPropagation();
        onChatAvatarClick(ava);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeZoom(); }, true);
}
