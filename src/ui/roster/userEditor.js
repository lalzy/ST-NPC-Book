// Popover editor for the persona's live posture and outfit.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx } from '../../core/context.js';
import { extensions } from '../../core/runtime.js';
import { settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { currentUser, personaData, personaKey } from '../../scene/persona.js';
import { writeCurrentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openPersonaCharacter } from '../persona/personaCharacter.js';
import { closePopovers, placePopover } from '../popover.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';

export function openUserEditor(anchor) {
    closePopovers();
    const c = ctx();
    const s = settings();
    const u = clone(currentUser());
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    const ava = personaKey() ? `<img class="npcb-ava npcb-ava-md" src="${esc(getUserAvatar(personaKey()))}">` : avatarHtml(null, c.name1, 'npcb-ava-md');
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head">${ava}<div><b>${esc(c.name1)}</b><br><small class="npcb-dim">you · persona</small></div></div>
        <label>Current posture<select class="text_pole npcb-u-posture">${opts(s.postures, u.posture)}</select></label>
        <div class="npcb-doll-host"></div>
        <div class="npcb-row"><div class="menu_button npcb-u-save"><i class="fa-solid fa-check"></i> Save</div>
        ${[...extensions.values()].filter(x => x.personaSheet).map(x => `<div class="menu_button npcb-u-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet.icon || 'fa-table-list')}"></i> ${esc(x.personaSheet.label || x.id)}</div>`).join('')}</div>
    </div>`);
    pop.on('click', '.npcb-u-ext', (e) => { const id = $(e.currentTarget).data('ext'); closePopovers(); openPersonaCharacter(`ext:${id}`); });
    pop.on('click', e => e.stopPropagation());
    let draft = u.outfit;
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draft, (o) => { draft = o; }, () => personaData().wardrobe, () => { closePopovers(); openPersonaCharacter('wardrobe'); });
    pop.on('click', '.npcb-u-save', () => {
        writeCurrentRoster(null, { ...u, posture: String(pop.find('.npcb-u-posture').val() ?? ''), outfit: draft, dressed: true });
        closePopovers();
    });
    placePopover(pop, anchor);
}
