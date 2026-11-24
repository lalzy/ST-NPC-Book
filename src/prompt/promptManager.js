// Chat Completion Prompt Manager entries: status, install, status display.

import { promptManager } from '../../../../../openai.js';
import { PM_INSTR_ID, PM_SCENE_ID } from '../constants.js';

function pmReady() {
    return !!(promptManager && promptManager.serviceSettings && promptManager.activeCharacter);
}

function pmStatus() {
    if (!pmReady()) return null;
    const res = {};
    for (const id of [PM_SCENE_ID, PM_INSTR_ID]) {
        const exists = !!promptManager.getPromptById(id);
        const entry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, id);
        res[id] = { exists, placed: !!entry, enabled: !!entry?.enabled };
    }
    return res;
}

export async function installPmEntries() {
    if (!pmReady()) {
        toastr.warning('Prompt Manager is not active. Switch to a Chat Completion API and open the AI Response Configuration panel once, then try again.', 'NPC Book');
        return;
    }
    const st0 = pmStatus();
    const pmStatusBefore = st0 && (st0[PM_INSTR_ID].placed || st0[PM_SCENE_ID].placed);
    const defs = [
        { id: PM_INSTR_ID, name: 'NPC Book — Instructions', content: '{{npcInstructions}}', injection_position: 0, injection_depth: 4 },
        { id: PM_SCENE_ID, name: 'NPC Book — Present NPCs', content: '{{npcScene}}', injection_position: 0, injection_depth: 4 },
    ];
    for (const d of defs) {
        if (!promptManager.getPromptById(d.id)) {
            promptManager.addPrompt({
                name: d.name, role: 'system', content: d.content, system_prompt: false, marker: false,
                injection_position: d.injection_position, injection_depth: d.injection_depth, injection_order: 100, forbid_overrides: false,
            }, d.id);
        }
        const prompt = promptManager.getPromptById(d.id);
        promptManager.appendPrompt(prompt, promptManager.activeCharacter);
        const entry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, d.id);
        if (entry) entry.enabled = true;
    }
    // Default placement: just before Chat History (user can drag them anywhere afterwards).
    const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
    const ours = order.filter(e => e.identifier === PM_INSTR_ID || e.identifier === PM_SCENE_ID);
    if (ours.length && !pmStatusBefore) {
        for (const e of ours) order.splice(order.indexOf(e), 1);
        const at = order.findIndex(e => e.identifier === 'chatHistory');
        ours.sort((a, b) => (a.identifier === PM_INSTR_ID ? -1 : 1) - (b.identifier === PM_INSTR_ID ? -1 : 1));
        order.splice(at >= 0 ? at : order.length, 0, ...ours);
    }
    promptManager.render?.();
    await promptManager.saveServiceSettings?.();
    toastr.success('Added "NPC Book — Instructions" and "NPC Book — Present NPCs" to the Prompt Manager. Drag them where you want; edit each to set role, position (relative / in-chat) and depth.', 'NPC Book', { timeOut: 8000 });
    renderPmStatus();
}

export function renderPmStatus() {
    const el = $('#npcb_pm_status');
    if (!el.length) return;
    const st = pmStatus();
    if (!st) { el.html('<span class="npcb-warn">Prompt Manager not active (Chat Completion only). With Text Completion, put <code>{{npcInstructions}}</code> and <code>{{npcScene}}</code> in your Story String, or use Auto inject.</span>'); return; }
    const row = (label, x) => `${label}: ${x.exists ? (x.placed ? (x.enabled ? '<b class="npcb-ok">placed &amp; enabled</b>' : '<b class="npcb-warn">placed but disabled</b>') : '<b class="npcb-warn">not in prompt order</b>') : '<b class="npcb-warn">missing</b>'}`;
    el.html(`${row('Instructions', st[PM_INSTR_ID])}<br>${row('Present NPCs', st[PM_SCENE_ID])}`);
}
