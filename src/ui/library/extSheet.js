// Popup for a sister-extension sheet (e.g. a stat sheet) of an NPC card.

import { ctx } from '../../core/context.js';
import { sheetSaved } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { lib, save } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { avatarHtml } from '../avatar.js';
import { selectTemplate } from './editor.js';
import { libState } from './state.js';

/** Open a sister-extension sheet (e.g. a stat sheet) of an NPC card in a popup; Save writes it to the card. */
export async function openTemplateExtSheet(id, extId) {
    const c = ctx();
    const t = lib()[id];
    const x = extensions.get(extId);
    if (!t || !x?.cardTab) return;
    const data = clone(t.ext?.[extId] ?? (typeof x.defaultData === 'function' ? x.defaultData() : {}));
    const box = $(`<div class="npcb-ext-popup"><div class="npcb-inst-head">${avatarHtml(t, t.name, 'npcb-ava-md')}<div><b>${esc(t.name)}</b><br><small class="npcb-dim">${esc(t.id)} · ${esc(x.cardTab.label || x.id)}</small></div></div><div class="npcb-ext-host"></div></div>`);
    try { x.cardTab.render(box.find('.npcb-ext-host'), { data, template: t, isNew: false, kind: 'char', id, scope: 'template' }); } catch (e) { console.error(e); }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    const fresh = lib()[id];
    if (!fresh) return;
    fresh.ext = fresh.ext || {};
    fresh.ext[extId] = data;
    save();
    sheetSaved(x, 'cardTab', { id, scope: 'template', data });
    updateAutoInjection();
    if ($('#npcb_library').is(':visible') && libState.selected === id) selectTemplate(id, false, `ext:${extId}`);
    toastr.success(`Saved ${t.name}'s ${x.sheetLabel || `${x.cardTab.label || x.id} sheet`}.`, 'NPC Book');
}
