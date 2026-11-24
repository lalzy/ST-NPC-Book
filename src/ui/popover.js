// Popover and context-menu primitives.

import { esc } from '../core/utils.js';

export function closePopovers() { $('.npcb-popover').remove(); }

export function placePopover(pop, anchor) {
    $('body').append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.outerWidth();
    const h = pop.outerHeight();
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    pop.css({ left, top });
}

export function openMenu(anchor, items) {
    closePopovers();
    const pop = $(`<div class="npcb-popover npcb-menu">${items.map((x, i) => `<div class="npcb-menu-item ${x.danger ? 'npcb-menu-danger' : ''}" data-i="${i}"><i class="fa-solid ${x.icon}"></i> ${esc(x.label)}</div>`).join('')}</div>`);
    pop.on('click', e => e.stopPropagation());
    pop.on('click', '.npcb-menu-item', (e) => { const x = items[Number($(e.currentTarget).data('i'))]; closePopovers(); x?.run(); });
    placePopover(pop, anchor);
}
