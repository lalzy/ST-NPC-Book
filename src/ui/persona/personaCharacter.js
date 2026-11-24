// Persona character window (wardrobe + sister-extension sheets) and its Persona Management button.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx, hasChat } from '../../core/context.js';
import { extensions } from '../../core/runtime.js';
import { save, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { outfitFromDefault } from '../../logic/outfit.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { currentUser, personaData, personaKey } from '../../scene/persona.js';
import { writeCurrentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { bindTabs } from '../tabs.js';
import { mountWardrobe } from '../wardrobe/wardrobeEditor.js';

/** Persona character editor: wardrobe (with starting outfit) and every sister-extension sheet (e.g. GURPS), in one window. */
export async function openPersonaCharacter(tab = 'wardrobe') {
    const c = ctx();
    const p = personaData();
    p.ext = p.ext || {};
    const draft = clone({ wardrobe: p.wardrobe, defaultWorn: p.defaultWorn, ext: p.ext });
    const extTabs = [...extensions.values()].filter(x => x.personaSheet);
    for (const x of extTabs) if (!draft.ext[x.id]) draft.ext[x.id] = typeof x.defaultData === 'function' ? x.defaultData() : {};
    if (!tab.startsWith('ext:')) tab = 'wardrobe';
    const ava = personaKey() ? `<img class="npcb-ava npcb-ava-md" src="${esc(getUserAvatar(personaKey()))}">` : avatarHtml(null, c.name1, 'npcb-ava-md');
    const box = $(`<div class="npcb-persona-char">
        <div class="npcb-inst-head">${ava}<div><b>${esc(c.name1)}</b><br><small class="npcb-dim">persona character · description, name and avatar come from Persona Management</small></div></div>
        <div class="npcb-tabs">
            <div class="npcb-tab ${tab === 'wardrobe' ? 'active' : ''}" data-tab="wardrobe">Wardrobe</div>
            ${extTabs.map(x => `<div class="npcb-tab ${tab === `ext:${x.id}` ? 'active' : ''}" data-tab="ext:${esc(x.id)}">${esc(x.personaSheet.label || x.id)}</div>`).join('')}
        </div>
        <div class="npcb-tabpane" data-pane="wardrobe" ${tab === 'wardrobe' ? '' : 'style="display:none"'}>
            <small class="npcb-dim">★ items are what you wear when a new chat starts (and when you switch to this persona).</small>
            <div class="npcb-wd-host"></div>
        </div>
        ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" ${tab === `ext:${x.id}` ? '' : 'style="display:none"'}><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
    </div>`);
    bindTabs(box);
    mountWardrobe(box.find('.npcb-wd-host'), draft, { key: `persona:${personaKey()}` });
    for (const x of extTabs) {
        try { x.personaSheet.render(box.find(`.npcb-ext-host[data-ext="${x.id}"]`), { data: draft.ext[x.id], kind: 'user', name: c.name1 }); } catch (e) { console.error(e); }
    }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    p.wardrobe = draft.wardrobe.filter(i => i.name.trim());
    p.defaultWorn = draft.defaultWorn.filter(id => p.wardrobe.some(i => i.id === id));
    p.ext = draft.ext;
    save();
    if (hasChat()) {
        const u = currentUser();
        let outfit = (u.outfit || []).filter(w => p.wardrobe.some(i => i.id === w.id));
        if (!outfit.length) outfit = outfitFromDefault(p.defaultWorn, p.wardrobe, settings().conditions);
        writeCurrentRoster(null, { ...u, outfit, dressed: outfit.length > 0 });
    }
    updateAutoInjection();
    toastr.success(`Saved ${c.name1}'s character.`, 'NPC Book');
}

export function ensurePersonaButton() {
    const holder = $('#persona_connections_buttons');
    if (!holder.length || $('#npcb_persona_char').length) return;
    const btn = $(`<div id="npcb_persona_char" class="menu_button menu_button_icon" title="NPC Book: wardrobe, starting outfit and sheets (e.g. GURPS) for the selected persona">
        <i class="icon fa-solid fa-users-viewfinder fa-fw"></i><div>NPC Book</div></div>`);
    holder.append(btn);
    btn.on('click', () => openPersonaCharacter());
}
