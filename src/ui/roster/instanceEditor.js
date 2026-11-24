// Popover editor for one NPC instance of the chat: live state, outfit and its own wardrobe.

import { extensions } from '../../core/runtime.js';
import { lib, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { cloneScene } from '../../logic/instances.js';
import { mirrorRelationship } from '../../logic/relationships.js';
import { currentScene, removeFromScene, writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openLibrary } from '../library/modal.js';
import { closePopovers, placePopover } from '../popover.js';
import { chatPeople, whoInChat } from '../relationships/people.js';
import { cleanRelationships, mountRelationships } from '../relationships/relationshipEditor.js';
import { openRelationshipView } from '../relationships/relationshipView.js';
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
        <div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div><div class="npcb-tab" data-tab="outfit">Outfit</div><div class="npcb-tab" data-tab="wardrobe">Wardrobe (${(inst.wardrobe || []).length})</div>${s.trackRelationships ? `<div class="npcb-tab" data-tab="relations">Relations (${(inst.relationships || []).length})</div>` : ''}</div>
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
        <div class="npcb-tabpane" data-pane="relations" style="display:none">
            <small class="npcb-dim">This chat's copy. The Library card is not touched.</small>
            <div class="npcb-rel-host"></div>
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
    const draftRelations = clone(inst.relationships || []);
    const scene0 = currentScene();
    mountRelationships(pop.find('.npcb-rel-host'), draftRelations, {
        self: id,
        chat: true,
        who: (to) => whoInChat(scene0, to),
        people: () => chatPeople(scene0, id),
        onWeb: (list) => openRelationshipView({ root: id, rootRels: cleanRelationships(list), mode: 'chat' }),
        onChange: (l) => pop.find('.npcb-tab[data-tab="relations"]').text(`Relations (${l.length})`),
    });
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
        const wide = tab === 'wardrobe' || tab === 'relations';
        pop.toggleClass('npcb-inst-wide', wide).css('width', wide ? 'min(760px, 96vw)' : '');
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
            target.relationships = cleanRelationships(draftRelations);
            // "Both directions": the other NPC's copy in this chat gets the relationship back (only if it has none yet).
            for (const r of draftRelations.filter(x => x.mirror && scene.instances[x.to])) {
                scene.instances[r.to].relationships = mirrorRelationship(scene.instances[r.to].relationships, id, r, s.relationshipTypes).list;
            }
            writeCurrentScene(scene);
        }
        closePopovers();
    });
    pop.on('click', '.npcb-i-remove', () => { removeFromScene(id); closePopovers(); });
    pop.on('click', '.npcb-i-card', () => { closePopovers(); openLibrary(template); });
    pop.on('click', '.npcb-i-ext', (e) => { const x = $(e.currentTarget).data('ext'); closePopovers(); openInstanceExtSheet(id, x); });
    placePopover(pop, anchor);
}
