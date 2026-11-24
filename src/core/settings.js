// Extension settings: load with defaults and migrations, save, and the NPC library stored in them.

import { DEFAULTS, DEFAULT_INSTRUCTIONS, DEFAULT_INSTRUCTIONS_V1, DEFAULT_PORTRAIT_LLM_PROMPT, DEFAULT_PORTRAIT_LLM_PROMPT_V1, MODULE } from '../constants.js';
import { ctx } from './context.js';

export function settings() {
    const es = ctx().extensionSettings;
    if (!es[MODULE]) es[MODULE] = structuredClone(DEFAULTS);
    const s = es[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    if (typeof s.instructions === 'string' && s.instructions.includes('except [[USER]] and [[CHAR]]')) {
        s.instructions = s.instructions.replace('except [[USER]] and [[CHAR]]', 'except [[EXCLUDE]]');
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[OUTFIT_RULES]]') && s.instructions.includes('\nFormat:\n')) {
        s.instructions = s.instructions.replace('\nFormat:\n', '[[OUTFIT_RULES]]\n\nFormat:\n');
    }
    if (s.sceneHeader === '[NPCs present in the scene]') s.sceneHeader = '';
    if (typeof s.outfitRules === 'string' && !s.outfitRules.includes('exposure') && s.outfitRules.includes('- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).')) {
        s.outfitRules = s.outfitRules.replace('- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).', '- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).\n- <wearing> is what each character has on RIGHT NOW. Its "exposure" (e.g. completely naked, topless, barefoot) is literal: describe and react to it accordingly.');
    }
    if (JSON.stringify(s.traitKeys) === JSON.stringify(['age', 'gender', 'role'])) s.traitKeys = ['race', 'age', 'gender', 'role'];
    if (!s.portraitTemplateV2 && s.portraitLlmPrompt === DEFAULT_PORTRAIT_LLM_PROMPT_V1) s.portraitLlmPrompt = DEFAULT_PORTRAIT_LLM_PROMPT;
    s.portraitTemplateV2 = true;
    // Unedited copies of the previous default tracking prompt follow the new default; edited ones are left alone.
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V1.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    // New clothing used to be ignored by default. Now that it only ever goes into a chat's own NPC instance, it is on;
    // switched on once for existing installs, after which the checkbox is respected.
    if (!s.wardrobeGrowthV2) { s.allowWardrobeGrowth = true; s.wardrobeGrowthV2 = true; }
    if (typeof s.instructions === 'string' && !s.instructions.includes('"sexual_experience"')) {
        s.instructions = s.instructions.replace(
            'plus "description" (one line) and "details" (full profile: appearance, personality, background, manner of speech).',
            'plus "description" (one line), "details" (full profile: appearance, personality, background, manner of speech), "height", "pronouns" and "sexual_experience".',
        );
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[USER_EXAMPLE]]')) {
        s.instructions = s.instructions.replace('"feelings": "..."}\n]', '"feelings": "...", "outfit": {"wear": ["item_id"], "remove": ["item_id"]}}[[USER_EXAMPLE]]\n]');
    }
    return s;
}
export const save = () => ctx().saveSettingsDebounced();
export const lib = () => settings().library;
