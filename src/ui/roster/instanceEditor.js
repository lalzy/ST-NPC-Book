// Popover editor for one NPC instance of the chat: live state and outfit, plus buttons for sister-extension sheets.

import { outfitCatalog, sheetSaved } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { lib, settings } from '../../core/settings.js';
import { libraryOf, openInLibrary } from '../../core/libraries.js';
import { clone, esc } from '../../core/utils.js';
import { cloneScene } from '../../logic/instances.js';
import { resolveOutfit } from '../../logic/outfit.js';
import { currentScene, removeFromScene, writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openInstancePortraitMenuFor } from '../instancePortrait.js';
import { openLibrary } from '../library/modal.js';
import { closePopovers, placePopover } from '../popover.js';
import { bindTabs } from '../tabs.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';
import { openInstanceExtSheet } from './instanceExtSheet.js';

export function openInstanceEditor(id, anchor) {
    closePopovers();
    const inst = currentScene().instances[id];
    if (!inst) return;
    const t = inst;
    const s = settings();
    const name = t?.name ?? inst.name ?? id;
    const tplId = inst.instanceOf ?? id;
    const template = (lib()[tplId] || libraryOf(tplId)?.templateLibrary?.open) ? tplId : null; // only for the "Card" shortcut to its library
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    // Sister extensions with a chatTab get a tab here (their data is a draft, saved with Save); the others get a sheet button.
    const extTabs = [...extensions.values()].filter(x => x.cardTab && x.chatTab);
    const chatTabOf = (x) => (x.chatTab === true ? {} : x.chatTab);
    const draftExt = {};
    for (const x of extTabs) draftExt[x.id] = clone(inst.ext?.[x.id] ?? (typeof x.defaultData === 'function' ? x.defaultData() : {}));
    const pop = $(`<div class="npcb-popover npcb-inst" data-npcb-inst="${esc(id)}">
        <div class="npcb-inst-head">${avatarHtml(t, name, 'npcb-ava-md')}
            <div><b>${esc(name)}</b><br><small class="npcb-dim">${esc(id)}</small></div>
        </div>
        <div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div><div class="npcb-tab" data-tab="outfit">Outfit</div>${extTabs.map(x => `<div class="npcb-tab" data-tab="ext:${esc(x.id)}">${esc(chatTabOf(x).label || x.cardTab.label || x.id)}</div>`).join('')}</div>
        <div class="npcb-tabpane" data-pane="state">
        <label>Current posture<select class="text_pole npcb-i-posture">${opts(s.postures, inst.posture)}</select></label>
        <label>Current state<select class="text_pole npcb-i-state">${opts(s.states, inst.state)}</select></label>
        <label>Current feelings (inner thoughts)<textarea class="text_pole npcb-i-feelings" rows="3">${esc(inst.feelings)}</textarea></label>
        </div>
        <div class="npcb-tabpane" data-pane="outfit" style="display:none"><div class="npcb-doll-host"></div></div>
        ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" style="display:none"><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
        <div class="npcb-row">
            <div class="menu_button npcb-i-save"><i class="fa-solid fa-check"></i> Save</div>
            <div class="menu_button npcb-i-card" ${template ? '' : 'style="display:none"'}><i class="fa-solid fa-id-card"></i> Card</div>
            <div class="menu_button npcb-i-remove redWarningBG"><i class="fa-solid fa-user-minus"></i> Remove</div>
        </div>
        <div class="npcb-row">${[...extensions.values()].filter(x => x.cardTab && !x.chatTab).map(x => `<div class="menu_button npcb-i-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet?.icon || x.cardTab.icon || 'fa-table-list')}"></i> ${esc(x.sheetLabel || `${x.cardTab.label || x.id} sheet`)}</div>`).join('')}</div>
    </div>`);
    pop.on('click', e => e.stopPropagation());
    // Click the portrait: view / replace / crop / regenerate / remove this instance's portrait.
    pop.find('.npcb-inst-head .npcb-ava').attr('title', 'Click to change portrait').addClass('npcb-ava-click');
    pop.on('click', '.npcb-inst-head .npcb-ava', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openInstancePortraitMenuFor(id, e.currentTarget); // the menu opens beside it; this popover stays open
    });
    const outfit0 = resolveOutfit(inst.outfit, inst.wardrobe || []);
    let draftOutfit = clone(outfit0);
    // Known clothing from sister extensions (e.g. a wardrobe). Its "Edit" action opens their sheet, so close this first.
    const catalog = () => {
        const cat = outfitCatalog({ source: 'editor', kind: 'char', id, subject: inst, ext: { ...(inst.ext || {}), ...draftExt } });
        const run = (a) => {
            if (a.run) { closePopovers(); a.run({ kind: 'char', id, scope: 'instance' }); return; }
            if (draftExt[a.extId] !== undefined) { pop.find(`.npcb-tab[data-tab="ext:${a.extId}"]`).trigger('click'); return; } // its tab is right here
            closePopovers(); openInstanceExtSheet(id, a.extId);
        };
        return { ...cat, actions: cat.actions.map(a => ({ ...a, run: () => run(a) })) };
    };
    bindTabs(pop);
    const doll = mountPaperdoll(pop.find('.npcb-doll-host'), () => draftOutfit, (o) => { draftOutfit = o; }, catalog);
    for (const x of extTabs) {
        const host = pop.find(`.npcb-ext-host[data-ext="${x.id}"]`);
        const render = chatTabOf(x).render || x.cardTab.render;
        try { render(host, { data: draftExt[x.id], template: inst, instance: inst, isNew: false, kind: 'char', id, scope: 'instance' }); } catch (e) { console.error(`[NPC Book] ${x.id} chat tab failed`, e); host.text(`Error: ${e.message}`); }
    }
    pop.on('click', '.npcb-tab', (e) => {
        const tab = String($(e.currentTarget).data('tab'));
        if (tab === 'outfit') doll.refresh(); // shows wardrobe edits made on another tab
        // Extension tabs may ask for room (chatTab.wide): widen the popover while they are open.
        const x = tab.startsWith('ext:') ? extensions.get(tab.slice(4)) : null;
        const wide = !!(x && chatTabOf(x).wide);
        pop.toggleClass('npcb-inst-wide', wide).css('width', wide ? 'min(760px, 96vw)' : '');
        placePopover(pop, anchor);
    });
    pop.on('click', '.npcb-i-save', () => {
        const scene = cloneScene(currentScene());
        const target = scene.instances[id];
        if (target) {
            delete target.defaultWorn; // instances have no starting outfit (older instances may still carry one)
            if (JSON.stringify(draftOutfit) !== JSON.stringify(outfit0)) target.dressed = true;
            target.outfit = draftOutfit;
            target.posture = String(pop.find('.npcb-i-posture').val() ?? '');
            target.state = String(pop.find('.npcb-i-state').val() ?? '');
            target.feelings = String(pop.find('.npcb-i-feelings').val() ?? '').trim();
            if (extTabs.length) target.ext = { ...(target.ext || {}), ...clone(draftExt) };
            writeCurrentScene(scene);
            for (const x of extTabs) sheetSaved(x, 'cardTab', { id, scope: 'instance', data: draftExt[x.id] });
        }
        closePopovers();
    });
    pop.on('click', '.npcb-i-remove', () => { removeFromScene(id); closePopovers(); });
    pop.on('click', '.npcb-i-card', () => { closePopovers(); if (!openInLibrary(template)) openLibrary(template); });
    pop.on('click', '.npcb-i-ext', (e) => { const x = $(e.currentTarget).data('ext'); closePopovers(); openInstanceExtSheet(id, x); });
    placePopover(pop, anchor);
}
