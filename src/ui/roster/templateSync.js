// Template changes for the chat's instances: which card fields changed on the template since the instance was
// made or last synced, and a dialog that pulls the fields the user picks into the instance (this chat only).

import { ctx, hasChat } from '../../core/context.js';
import { anyTemplate } from '../../core/libraries.js';
import { extensions } from '../../core/runtime.js';
import { esc } from '../../core/utils.js';
import { SYNC_GROUPS, cloneScene, syncFromTemplate, templateChanges } from '../../logic/instances.js';
import { currentScene, writeCurrentScene } from '../../scene/roster.js';
import { decorateAll } from '../../speakers/decorate.js';

/** The template an instance was copied from (NPC Library or an extension library), or null. */
export function templateOf(inst) {
    return inst ? anyTemplate(inst.instanceOf ?? inst.id) : null;
}

/** Sync group keys where the instance's template has changed, [] when none (or no template). */
export function pendingTemplateChanges(inst) {
    const t = templateOf(inst);
    return t ? templateChanges(inst, t) : [];
}

export function syncGroupLabel(key) {
    if (key.startsWith('ext:')) {
        const x = extensions.get(key.slice(4));
        return x?.cardTab?.label || x?.label || key.slice(4);
    }
    return SYNC_GROUPS.find(g => g.key === key)?.label || key;
}

// Card text fields are ticked by default; portrait and extension data (often this chat's own state) are not.
const TICKED = new Set(['name', 'color', 'description', 'details', 'dialogue', 'traits', 'profile']);

/** Dialog: pick which changed template fields to pull into this chat's instance. Resolves true when synced. */
export async function openTemplateSync(id) {
    if (!hasChat()) return false;
    const c = ctx();
    const inst = currentScene().instances[id];
    const t = templateOf(inst);
    if (!inst || !t) return false;
    const changes = templateChanges(inst, t);
    if (!changes.length) { toastr.info(`${inst.name || id}'s template has not changed.`, 'NPC Book'); return false; }
    const box = $(`<div class="npcb-sync">
        <div><b>${esc(inst.name || id)}</b> · <small class="npcb-dim">${esc(id)}</small></div>
        <small class="npcb-dim">The template card changed since this chat copied it. Tick what to copy from the template into this chat's ${esc(inst.name || id)}. Unticked fields keep this chat's version (and stop showing as changed until the template changes again). Live state (posture, state, feelings, current outfit) is never changed.</small>
        ${changes.map(k => `<label class="checkbox_label"><input type="checkbox" class="npcb-sync-key" data-key="${esc(k)}" ${TICKED.has(k) ? 'checked' : ''}> ${esc(syncGroupLabel(k))}</label>`).join('')}
    </div>`);
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { allowVerticalScrolling: true, okButton: 'Sync', cancelButton: 'Cancel' });
    if (!ok) return false;
    const keys = box.find('.npcb-sync-key:checked').map((_, el) => String($(el).data('key'))).get();
    const scene = cloneScene(currentScene());
    const target = scene.instances[id];
    const tpl = templateOf(target);
    if (!target || !tpl) return false;
    syncFromTemplate(target, tpl, keys, changes);
    writeCurrentScene(scene);
    decorateAll();
    if (keys.length) toastr.success(`Synced ${keys.map(syncGroupLabel).join(', ')} from the template for this chat.`, 'NPC Book');
    else toastr.info('Nothing copied. These template changes are marked as seen.', 'NPC Book');
    return true;
}
