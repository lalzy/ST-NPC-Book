// Persona character window (starting outfit + sister-extension sheets) and its Persona Management button.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx, hasChat } from '../../core/context.js';
import { outfitCatalog, sheetSaved } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { save, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { resolveOutfit, startingOutfit } from '../../logic/outfit.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { currentUser, personaData, personaKey } from '../../scene/persona.js';
import { writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { bindTabs } from '../tabs.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';

/** Persona character editor: starting outfit and every sister-extension sheet (e.g. a stat sheet), in one window. */
export async function openPersonaCharacter(tab = 'outfit') {
    const c = ctx();
    const p = personaData();
    p.ext = p.ext || {};
    const draft = clone({ outfit: startingOutfit(p, settings().conditions), ext: p.ext });
    const extTabs = [...extensions.values()].filter(x => x.personaSheet);
    for (const x of extTabs) if (!draft.ext[x.id]) draft.ext[x.id] = typeof x.defaultData === 'function' ? x.defaultData() : {};
    if (tab === 'wardrobe' && extensions.get('wardrobe')?.personaSheet) tab = 'ext:wardrobe'; // the wardrobe moved to a sister extension
    if (!tab.startsWith('ext:') || !extTabs.some(x => `ext:${x.id}` === tab)) tab = 'outfit';
    const ava = personaKey() ? `<img class="npcb-ava npcb-ava-md" src="${esc(getUserAvatar(personaKey()))}">` : avatarHtml(null, c.name1, 'npcb-ava-md');
    const box = $(`<div class="npcb-persona-char">
        <div class="npcb-inst-head">${ava}<div><b>${esc(c.name1)}</b><br><small class="npcb-dim">persona character · description, name and avatar come from Persona Management</small></div></div>
        <div class="npcb-tabs">
            <div class="npcb-tab ${tab === 'outfit' ? 'active' : ''}" data-tab="outfit">Starting outfit</div>
            ${extTabs.map(x => `<div class="npcb-tab ${tab === `ext:${x.id}` ? 'active' : ''}" data-tab="ext:${esc(x.id)}">${esc(x.personaSheet.label || x.id)}</div>`).join('')}
        </div>
        <div class="npcb-tabpane" data-pane="outfit" ${tab === 'outfit' ? '' : 'style="display:none"'}>
            <small class="npcb-dim">What you wear when a new chat starts (and when you switch to this persona). Click a slot to dress it.</small>
            <div class="npcb-doll-host"></div>
        </div>
        ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" ${tab === `ext:${x.id}` ? '' : 'style="display:none"'}><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
    </div>`);
    bindTabs(box);
    const doll = mountPaperdoll(box.find('.npcb-doll-host'), () => draft.outfit, (o) => { draft.outfit = o; }, () => {
        const cat = outfitCatalog({ source: 'editor', kind: 'user', id: 'user', subject: p, ext: draft.ext });
        return { ...cat, actions: cat.actions.map(a => ({ ...a, run: () => (a.run ? a.run({ kind: 'user', id: 'user', scope: 'persona' }) : box.find(`.npcb-tab[data-tab="ext:${a.extId}"]`).trigger('click')) })) };
    });
    box.on('click', '.npcb-tab[data-tab="outfit"]', () => doll.refresh());
    for (const x of extTabs) {
        try { x.personaSheet.render(box.find(`.npcb-ext-host[data-ext="${x.id}"]`), { data: draft.ext[x.id], kind: 'user', name: c.name1, id: 'user', scope: 'persona', subject: p }); } catch (e) { console.error(e); }
    }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    p.outfit = draft.outfit;
    delete p.defaultWorn; // older data: the starting outfit was starred wardrobe items
    p.ext = draft.ext;
    save();
    for (const x of extTabs) sheetSaved(x, 'personaSheet', { id: 'user', scope: 'persona', data: p.ext[x.id] });
    if (hasChat()) {
        // Someone wearing nothing (never dressed in this chat) puts on the new starting outfit.
        const u = currentUser();
        const worn = resolveOutfit(u.outfit, p.wardrobe || []);
        if (!worn.length && !u.dressed && p.outfit.length) writeCurrentScene(null, { ...u, outfit: clone(p.outfit), dressed: true });
    }
    updateAutoInjection();
    toastr.success(`Saved ${c.name1}'s character.`, 'NPC Book');
}

export function ensurePersonaButton() {
    const holder = $('#persona_connections_buttons');
    if (!holder.length || $('#npcb_persona_char').length) return;
    const btn = $(`<div id="npcb_persona_char" class="menu_button menu_button_icon" title="NPC Book: starting outfit and sister-extension sheets for the selected persona">
        <i class="icon fa-solid fa-users-viewfinder fa-fw"></i><div>NPC Book</div></div>`);
    holder.append(btn);
    btn.on('click', () => openPersonaCharacter());
}
