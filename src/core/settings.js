// Extension settings: load with defaults and migrations, save, and the NPC library stored in them.

import { DEFAULTS, DEFAULT_INSTRUCTIONS, DEFAULT_INSTRUCTIONS_V1, DEFAULT_INSTRUCTIONS_V2, DEFAULT_INSTRUCTIONS_V3, DEFAULT_INSTRUCTIONS_V4, DEFAULT_INSTRUCTIONS_V5, DEFAULT_SPEAKER_RULE, DEFAULT_SPEAKER_RULE_V1, DEFAULT_SPEAKER_REMINDER, DEFAULT_SPEAKER_REMINDER_V1, DEFAULT_OUTFIT_RULES, DEFAULT_OUTFIT_RULES_V2, DEFAULT_PORTRAIT_LLM_PROMPT, DEFAULT_PORTRAIT_LLM_PROMPT_V1, MODULE } from '../constants.js';
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
    // Relationship and wardrobe settings now belong to their sister extensions, which read (and migrate) them from here.
    // Unedited copies of the previous default tracking prompt follow the new default; edited ones are left alone.
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V1.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    if (typeof s.instructions === 'string' && !s.instructions.includes('"sexual_experience"')) {
        s.instructions = s.instructions.replace(
            'plus "description" (one line) and "details" (full profile: appearance, personality, background, manner of speech).',
            'plus "description" (one line), "details" (full profile: appearance, personality, background, manner of speech), "height", "pronouns" and "sexual_experience".',
        );
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[USER_EXAMPLE]]')) {
        s.instructions = s.instructions.replace('"feelings": "..."}\n]', '"feelings": "...", "outfit": {"wear": ["item_id"], "remove": ["item_id"]}}[[USER_EXAMPLE]]\n]');
    }
    // Wardrobes moved to a sister extension: unedited copies of the wardrobe-era prompts follow the new defaults.
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V2.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    if (typeof s.outfitRules === 'string' && s.outfitRules.trim() === DEFAULT_OUTFIT_RULES_V2.trim()) s.outfitRules = DEFAULT_OUTFIT_RULES;
    // Library NPCs are no longer sent to the LLM; Known NPCs lists only this chat's NPCs, by id and name.
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V3.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V4.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    if (typeof s.instructions === 'string' && s.instructions.trim() === DEFAULT_INSTRUCTIONS_V5.trim()) s.instructions = DEFAULT_INSTRUCTIONS;
    if (typeof s.speakerRule === 'string' && s.speakerRule.trim() === DEFAULT_SPEAKER_RULE_V1.trim()) s.speakerRule = DEFAULT_SPEAKER_RULE;
    if (typeof s.speakerReminder === 'string' && s.speakerReminder.trim() === DEFAULT_SPEAKER_REMINDER_V1.trim()) s.speakerReminder = DEFAULT_SPEAKER_REMINDER;
    if (typeof s.instructions === 'string') s.instructions = s.instructions.replace('Known NPCs (id: name — identity):', 'Known NPCs, people this story has already met (id: name; their details appear in the scene when they are present):');
    delete s.includeLibrary;
    return s;
}
export const save = () => ctx().saveSettingsDebounced();
export const lib = () => settings().library;
