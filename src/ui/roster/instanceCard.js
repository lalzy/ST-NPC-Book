// Popup with the card fields of one NPC instance of the open chat (its own copy of the template). Save writes to the instance only.

import { HEX_RE } from '../../constants.js';
import { ctx, hasChat } from '../../core/context.js';
import { settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { cloneScene, ensureSyncBaseline } from '../../logic/instances.js';
import { currentScene, writeCurrentScene } from '../../scene/roster.js';
import { decorateAll } from '../../speakers/decorate.js';
import { avatarHtml } from '../avatar.js';
import { mountDialogueExamples } from '../library/dialogueExamples.js';
import { templateOf } from './templateSync.js';

export async function openInstanceCard(id) {
    if (!hasChat()) return;
    const c = ctx();
    const inst = currentScene().instances[id];
    if (!inst) return;
    const s = settings();
    const traitKeys = [...new Set([...s.traitKeys, ...Object.keys(inst.traits || {})])];
    const dialogue = clone(inst.dialogue || []);
    const box = $(`<div class="npcb-ext-popup npcb-inst-card">
        <div class="npcb-inst-head">${avatarHtml(inst, inst.name, 'npcb-ava-md')}<div><b>${esc(inst.name)}</b><br><small class="npcb-dim">${esc(inst.id)} · card · this chat</small></div></div>
        <small class="npcb-dim">This chat's own copy of the card. Changes here never touch the template in the NPC Library.</small>
        <label>Name<input class="text_pole npcb-ic-name" value="${esc(inst.name ?? '')}"></label>
        <label>Dialogue color <small class="npcb-dim">(#RRGGBB, empty = none)</small><input class="text_pole npcb-ic-color" value="${esc(inst.color || '')}"></label>
        <label>Description <small class="npcb-dim">(only you see this — never sent to the LLM)</small>
            <textarea class="text_pole npcb-ic-desc" rows="3">${esc(inst.description ?? '')}</textarea></label>
        <label>Details <small class="npcb-dim">(sent to the LLM while this NPC is in the scene)</small>
            <textarea class="text_pole npcb-ic-details" rows="10">${esc(inst.details ?? '')}</textarea></label>
        <div class="npcb-dx-wrap">
            <div><b>Dialogue examples</b> <small class="npcb-dim">(sent to the LLM; mood examples only while this NPC is in that mood)</small></div>
            <div class="npcb-dx-host"></div>
        </div>
        <div class="npcb-ed-traits">
            <div><b>Identity</b></div>
            ${traitKeys.map(k => `<label>${esc(k)}<input class="text_pole npcb-ic-trait" data-key="${esc(k)}" value="${esc(inst.traits?.[k] ?? '')}"></label>`).join('')}
        </div>
        <div class="npcb-ed-traits npcb-ed-profile">
            <div><b>Profile</b></div>
            <label>Height<input class="text_pole npcb-ic-height" value="${esc(inst.height ?? '')}"></label>
            <label>Pronouns<input class="text_pole npcb-ic-pronouns" value="${esc(inst.pronouns ?? '')}"></label>
            <label>Sexuality<input class="text_pole npcb-ic-sexuality" value="${esc(inst.sexuality ?? '')}"></label>
            <label>Sexual experience<input class="text_pole npcb-ic-sexexp" value="${esc(inst.sexualExperience ?? '')}"></label>
        </div>
    </div>`);
    mountDialogueExamples(box.find('.npcb-dx-host'), dialogue);
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    let color = String(box.find('.npcb-ic-color').val() ?? '').trim();
    if (/^[0-9a-f]{6}$/i.test(color)) color = `#${color}`;
    if (color && !HEX_RE.test(color)) { toastr.warning('Dialogue color must look like #RRGGBB (or be empty). Not saved.', 'NPC Book'); return; }
    const scene = cloneScene(currentScene());
    const target = scene.instances[id];
    if (!target) return;
    ensureSyncBaseline(target, templateOf(target)); // older instances: so this edit is not shown as a template change
    const traits = {};
    box.find('.npcb-ic-trait').each((_, el) => { traits[$(el).data('key')] = String($(el).val() ?? '').trim(); });
    Object.assign(target, {
        name: String(box.find('.npcb-ic-name').val() ?? '').trim() || target.name,
        color: color.toLowerCase(),
        description: String(box.find('.npcb-ic-desc').val() ?? ''),
        details: String(box.find('.npcb-ic-details').val() ?? ''),
        dialogue: dialogue.filter(d => String(d.text ?? '').trim()).map(d => ({ kind: d.kind || 'always', value: String(d.value ?? '').trim(), text: String(d.text).trim() })),
        traits,
        height: String(box.find('.npcb-ic-height').val() ?? '').trim(),
        pronouns: String(box.find('.npcb-ic-pronouns').val() ?? '').trim(),
        sexuality: String(box.find('.npcb-ic-sexuality').val() ?? '').trim(),
        sexualExperience: String(box.find('.npcb-ic-sexexp').val() ?? '').trim(),
    });
    writeCurrentScene(scene);
    decorateAll();
    toastr.success(`Saved ${target.name}'s card for this chat.`, 'NPC Book');
}
