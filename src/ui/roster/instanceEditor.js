// Popover editor for one NPC's live state and outfit in the scene.

import { templateFor } from '../../core/npcs.js';
import { extensions } from '../../core/runtime.js';
import { settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { outfitFromDefault } from '../../logic/outfit.js';
import { currentRoster, removeFromScene, writeCurrentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openTemplateExtSheet } from '../library/extSheet.js';
import { openLibrary } from '../library/modal.js';
import { closePopovers, placePopover } from '../popover.js';
import { bindTabs } from '../tabs.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';

export function openInstanceEditor(id, anchor) {
    closePopovers();
    const inst = currentRoster().find(i => i.id === id);
    if (!inst) return;
    const t = templateFor(inst);
    const s = settings();
    const name = t?.name ?? inst.name ?? id;
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head">${avatarHtml(t, name, 'npcb-ava-md')}
            <div><b>${esc(name)}</b><br><small class="npcb-dim">${esc(id)}${t ? '' : ' · card deleted'}</small></div>
        </div>
        <div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div><div class="npcb-tab" data-tab="outfit">Outfit</div></div>
        <div class="npcb-tabpane" data-pane="state">
        <label>Current posture<select class="text_pole npcb-i-posture">${opts(s.postures, inst.posture)}</select></label>
        <label>Current state<select class="text_pole npcb-i-state">${opts(s.states, inst.state)}</select></label>
        <label>Current feelings (inner thoughts)<textarea class="text_pole npcb-i-feelings" rows="3">${esc(inst.feelings)}</textarea></label>
        </div>
        <div class="npcb-tabpane" data-pane="outfit" style="display:none"><div class="npcb-doll-host"></div></div>
        <div class="npcb-row">
            <div class="menu_button npcb-i-save"><i class="fa-solid fa-check"></i> Save</div>
            <div class="menu_button npcb-i-card" ${t ? '' : 'style="display:none"'}><i class="fa-solid fa-id-card"></i> Card</div>
            <div class="menu_button npcb-i-remove redWarningBG"><i class="fa-solid fa-user-minus"></i> Remove</div>
        </div>
        ${t ? `<div class="npcb-row">${[...extensions.values()].filter(x => x.cardTab).map(x => `<div class="menu_button npcb-i-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet?.icon || x.cardTab.icon || 'fa-table-list')}"></i> ${esc(x.sheetLabel || `${x.cardTab.label || x.id} sheet`)}</div>`).join('')}</div>` : ''}
    </div>`);
    pop.on('click', e => e.stopPropagation());
    let draftOutfit = clone(inst.outfit ?? outfitFromDefault(t?.defaultWorn, t?.wardrobe || [], s.conditions));
    bindTabs(pop);
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draftOutfit, (o) => { draftOutfit = o; }, () => t?.wardrobe || [], t ? () => { closePopovers(); openLibrary(id, false, 'wardrobe'); } : null);
    pop.on('click', '.npcb-i-save', () => {
        const roster = clone(currentRoster());
        const target = roster.find(i => i.id === id);
        if (target) {
            target.outfit = draftOutfit;
            target.posture = String(pop.find('.npcb-i-posture').val() ?? '');
            target.state = String(pop.find('.npcb-i-state').val() ?? '');
            target.feelings = String(pop.find('.npcb-i-feelings').val() ?? '').trim();
            writeCurrentRoster(roster);
        }
        closePopovers();
    });
    pop.on('click', '.npcb-i-remove', () => { removeFromScene(id); closePopovers(); });
    pop.on('click', '.npcb-i-card', () => { closePopovers(); openLibrary(id); });
    pop.on('click', '.npcb-i-ext', (e) => { const x = $(e.currentTarget).data('ext'); closePopovers(); openTemplateExtSheet(id, x); });
    placePopover(pop, anchor);
}
