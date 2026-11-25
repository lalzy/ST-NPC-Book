// Popup for a sister-extension sheet (e.g. a stat sheet) of an NPC instance in the open chat. Save writes to the instance only.

import { ctx } from '../../core/context.js';
import { sheetSaved } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { clone, esc } from '../../core/utils.js';
import { cloneScene } from '../../logic/instances.js';
import { currentScene, writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';

export async function openInstanceExtSheet(id, extId) {
    const c = ctx();
    const inst = currentScene().instances[id];
    const x = extensions.get(extId);
    if (!inst || !x?.cardTab) return;
    const data = clone(inst.ext?.[extId] ?? (typeof x.defaultData === 'function' ? x.defaultData() : {}));
    const box = $(`<div class="npcb-ext-popup"><div class="npcb-inst-head">${avatarHtml(inst, inst.name, 'npcb-ava-md')}<div><b>${esc(inst.name)}</b><br><small class="npcb-dim">${esc(inst.id)} · ${esc(x.cardTab.label || x.id)} · this chat</small></div></div><div class="npcb-ext-host"></div></div>`);
    try { x.cardTab.render(box.find('.npcb-ext-host'), { data, template: inst, instance: inst, isNew: false, kind: 'char', id, scope: 'instance' }); } catch (e) { console.error(e); }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    const scene = cloneScene(currentScene());
    const target = scene.instances[id];
    if (!target) return;
    target.ext = target.ext || {};
    target.ext[extId] = data;
    writeCurrentScene(scene);
    sheetSaved(x, 'cardTab', { id, scope: 'instance', data });
    toastr.success(`Saved ${inst.name}'s ${x.cardTab.label || x.id} sheet for this chat.`, 'NPC Book');
}
