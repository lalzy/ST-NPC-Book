// Puts the prompts into generation: auto extension prompts and the {{npcScene}} / {{npcInstructions}} macros.

import { INJECT_INSTR_KEY, INJECT_REMIND_KEY, INJECT_SCENE_KEY } from '../constants.js';
import { ctx } from '../core/context.js';
import { settings } from '../core/settings.js';
import { buildInstructionText, buildSpeakerReminder } from './instructions.js';
import { buildSceneText } from './sceneText.js';

export function updateAutoInjection() {
    const c = ctx();
    const s = settings();
    const auto = s.enabled && s.injectMode === 'auto';
    c.setExtensionPrompt(INJECT_SCENE_KEY, auto ? buildSceneText() : '', Number(s.scenePosition), Number(s.sceneDepth), false, Number(s.sceneRole));
    c.setExtensionPrompt(INJECT_INSTR_KEY, auto ? buildInstructionText() : '', Number(s.instrPosition), Number(s.instrDepth), false, Number(s.instrRole));
    // Short speaker-block reminder right before the reply (in chat, depth 0), in both injection modes.
    c.setExtensionPrompt(INJECT_REMIND_KEY, buildSpeakerReminder(), 1, 0, false, 0);
}

export function registerMacros() {
    const c = ctx();
    const defs = [
        ['npcScene', 'NPC Book: details + live state of NPCs present in this chat (empty if none).', buildSceneText],
        ['npcInstructions', 'NPC Book: tracking instructions for the LLM.', buildInstructionText],
    ];
    // Never let a macro fail silently: log the error and show one toast per macro per session.
    const warned = new Set();
    const safe = (name, fn) => () => {
        try { return fn(); } catch (e) {
            console.error(`[NPC Book] {{${name}}} failed`, e);
            if (!warned.has(name)) { warned.add(name); toastr.error(`{{${name}}} failed: ${e?.message || e}. See browser console.`, 'NPC Book'); }
            return '';
        }
    };
    for (const [name, description, fn] of defs) {
        const handler = safe(name, fn);
        try {
            if (c.macros?.register) c.macros.register(name, { category: 'NPC Book', description, handler });
            else c.registerMacro(name, handler, description);
        } catch (e) {
            try { c.registerMacro(name, handler, description); } catch (e2) { console.error('[NPC Book] macro registration failed', e2); }
        }
    }
}
