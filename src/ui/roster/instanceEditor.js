// Popover editor for one NPC instance of the chat: live state, outfit and its own wardrobe.

import { extensions } from '../../core/runtime.js';
import { lib, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { cloneScene } from '../../logic/instances.js';
import { currentScene, removeFromScene, writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openLibrary } from '../library/modal.js';
import { closePopovers, placePopover } from '../popover.js';
import { bindTabs } from '../tabs.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';
import { mountWardrobe } from '../wardrobe/wardrobeEditor.js';
import { openInstanceExtSheet } from './instanceExtSheet.js';

export function openInstanceEditor(id, anchor) {
    closePopovers();
    const inst = currentScene().instances[id];
    if (!inst) return;
    const t = inst;
    const s = settings();
    const name = t?.name ?? inst.name ?? id;
    const template = lib()[inst.instanceOf ?? id] ? (inst.instanceOf ?? id) : null; // only for the "Card" shortcut to the Library
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head">${avatarHtml(t, name, 'npcb-ava-md')}
            <div><b>${esc(name)}</b><br><small class="npcb-dim">${esc(id)}</small></div>
        </div>
        <div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div><div class="npcb-tab" data-tab="outfit">Outfit</div><div class="npcb-tab" data-tab="wardrobe">Wardrobe (${(inst.wardrobe || []).length})</div></div>
        <div class="npcb-tabpane" data-pane="state">
        <label>Current posture<select class="text_pole npcb-i-posture">${opts(s.postures, inst.posture)}</select></label>
        <label>Current state<select class="text_pole npcb-i-state">${opts(s.states, inst.state)}</select></label>
        <label>Current feelings (inner thoughts)<textarea class="text_pole npcb-i-feelings" rows="3">${esc(inst.feelings)}</textarea></label>
        </div>
        <div class="npcb-tabpane" data-pane="outfit" style="display:none"><div class="npcb-doll-host"></div></div>
        <div class="npcb-tabpane" data-pane="wardrobe" style="display:none">
            <small class="npcb-dim">This chat's own wardrobe for ${esc(name)}. Changes stay in this chat; the Library card is not touched.</small>
            <div class="npcb-wd-host"></div>
        </div>
        <div class="npcb-row">
            <div class="menu_button npcb-i-save"><i class="fa-solid fa-check"></i> Save</div>
            <div class="menu_button npcb-i-card" ${template ? '' : 'style="display:none"'}><i class="fa-solid fa-id-card"></i> Card</div>
            <div class="menu_button npcb-i-remove redWarningBG"><i class="fa-solid fa-user-minus"></i> Remove</div>
        </div>
        <div class="npcb-row">${[...extensions.values()].filter(x => x.cardTab).map(x => `<div class="menu_button npcb-i-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet?.icon || x.cardTab.icon || 'fa-table-list')}"></i> ${esc(x.sheetLabel || `${x.cardTab.label || x.id} sheet`)}</div>`).join('')}</div>
    </div>`);
    pop.on('click', e => e.stopPropagation());
    let draftOutfit = clone(inst.outfit || []);
    const draftWardrobe = clone({ wardrobe: inst.wardrobe || [] });
    const showTab = (tab) => pop.find(`.npcb-tab[data-tab="${tab}"]`).trigger('click');
    const mountDoll = () => mountPaperdoll(pop.find('.npcb-doll-host'), () => draftOutfit, (o) => { draftOutfit = o; }, () => draftWardrobe.wardrobe, () => showTab('wardrobe'));
    bindTabs(pop);
    mountDoll();
    mountWardrobe(pop.find('.npcb-wd-host'), draftWardrobe, {
        key: `instance:${id}`,
        startingOutfit: false, // an instance only has what it wears now (Outfit tab)
        onChange: (d) => pop.find('.npcb-tab[data-tab="wardrobe"]').text(`Wardrobe (${d.wardrobe.length})`),
    });
    pop.on('click', '.npcb-tab', (e) => {
        const tab = $(e.currentTarget).data('tab');
        if (tab === 'outfit') { draftOutfit = draftOutfit.filter(w => draftWardrobe.wardrobe.some(i => i.id === w.id)); mountDoll(); }
        // The wardrobe editor needs room: widen the popover while that tab is open.
        pop.toggleClass('npcb-inst-wide', tab === 'wardrobe').css('width', tab === 'wardrobe' ? 'min(760px, 96vw)' : '');
        placePopover(pop, anchor);
    });
    pop.on('click', '.npcb-i-save', () => {
        const scene = cloneScene(currentScene());
        const target = scene.instances[id];
        if (target) {
            target.wardrobe = draftWardrobe.wardrobe.filter(i => i.name.trim());
            delete target.defaultWorn; // instances have no starting outfit (older instances may still carry one)
            target.outfit = draftOutfit.filter(w => target.wardrobe.some(i => i.id === w.id));
            target.posture = String(pop.find('.npcb-i-posture').val() ?? '');
            target.state = String(pop.find('.npcb-i-state').val() ?? '');
            target.feelings = String(pop.find('.npcb-i-feelings').val() ?? '').trim();
            writeCurrentScene(scene);
        }
        closePopovers();
    });
    pop.on('click', '.npcb-i-remove', () => { removeFromScene(id); closePopovers(); });
    pop.on('click', '.npcb-i-card', () => { closePopovers(); openLibrary(template); });
    pop.on('click', '.npcb-i-ext', (e) => { const x = $(e.currentTarget).data('ext'); closePopovers(); openInstanceExtSheet(id, x); });
    placePopover(pop, anchor);
}
