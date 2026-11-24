// Extension settings panel (settings.html) bindings.

import { DEFAULT_RELATIONSHIP_RULE, DEFAULT_ASSIST_CARD_PROMPT, DEFAULT_ASSIST_WARDROBE_PROMPT, DEFAULT_INSTRUCTIONS, DEFAULT_OUTFIT_RULES, DEFAULT_PORTRAIT_LLM_PROMPT, DEFAULT_SPEAKER_REMINDER, DEFAULT_SPEAKER_RULE, EXT_FOLDER } from '../../constants.js';
import { ctx } from '../../core/context.js';
import { save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { buildInstructionText } from '../../prompt/instructions.js';
import { installPmEntries, renderPmStatus } from '../../prompt/promptManager.js';
import { buildSceneText } from '../../prompt/sceneText.js';
import { applyCardStyle, decorateAll } from '../../speakers/decorate.js';
import { openLibrary } from '../library/modal.js';
import { renderRoster } from '../roster/rosterBar.js';

export async function mountSettings() {
    const html = await $.get(`${EXT_FOLDER}settings.html`);
    $('#extensions_settings2').append(html);
    const s = settings();
    const root = $('#npcb_settings');
    const bind = (sel, key, type = 'text') => {
        const el = root.find(sel);
        if (type === 'checkbox') el.prop('checked', !!s[key]);
        else if (type === 'list') el.val(s[key].join('\n'));
        else el.val(s[key]);
        el.on(type === 'checkbox' ? 'change' : 'input', () => {
            if (type === 'checkbox') s[key] = el.prop('checked');
            else if (type === 'number') s[key] = Number(el.val());
            else if (type === 'list') s[key] = String(el.val()).split(/\n|,/).map(x => x.trim()).filter(Boolean);
            else s[key] = String(el.val());
            save();
            syncModeUi();
            updateAutoInjection();
            renderRoster();
        });
    };
    bind('#npcb_enabled', 'enabled', 'checkbox');
    bind('#npcb_debug', 'debug', 'checkbox');
    bind('#npcb_mode', 'injectMode');
    bind('#npcb_scene_pos', 'scenePosition', 'number');
    bind('#npcb_scene_depth', 'sceneDepth', 'number');
    bind('#npcb_scene_role', 'sceneRole', 'number');
    bind('#npcb_instr_pos', 'instrPosition', 'number');
    bind('#npcb_instr_depth', 'instrDepth', 'number');
    bind('#npcb_instr_role', 'instrRole', 'number');
    bind('#npcb_header', 'sceneHeader');
    bind('#npcb_include_lib', 'includeLibrary', 'checkbox');
    bind('#npcb_autocreate', 'autoCreate', 'checkbox');
    bind('#npcb_autofolder', 'autoFolder');
    bind('#npcb_maxnew', 'maxNewPerReply', 'number');
    bind('#npcb_trackchar', 'trackChar', 'checkbox');
    bind('#npcb_trackuser', 'trackUser', 'checkbox');
    bind('#npcb_personainuser', 'personaInUser', 'checkbox');
    bind('#npcb_dialoguecolors', 'dialogueColors', 'checkbox');
    root.find('#npcb_dialoguecolors').on('change', applyCardStyle);
    bind('#npcb_speakerportraits', 'speakerPortraits', 'checkbox');
    bind('#npcb_speakersize', 'speakerPortraitSize', 'number');
    bind('#npcb_autoportraits', 'autoPortraits', 'checkbox');
    bind('#npcb_portraitprompt', 'portraitPrompt');
    bind('#npcb_portraitmode', 'portraitMode');
    bind('#npcb_portraitframing', 'portraitFraming', 'checkbox');
    bind('#npcb_portraitprefix', 'portraitPrefix');
    bind('#npcb_portraitnegative', 'portraitNegative');
    root.find('#npcb_speakerportraits, #npcb_speakersize, #npcb_enabled').on('input change', () => { applyCardStyle(); decorateAll(); });
    bind('#npcb_trackoutfits', 'trackOutfits', 'checkbox');
    bind('#npcb_exposure', 'describeExposure', 'checkbox');
    bind('#npcb_incwardrobe', 'includeWardrobe', 'checkbox');
    bind('#npcb_wdgrowth', 'allowWardrobeGrowth', 'checkbox');
    bind('#npcb_conditions', 'conditions', 'list');
    bind('#npcb_relationships', 'trackRelationships', 'checkbox');
    bind('#npcb_attitudes', 'attitudes', 'list');
    bind('#npcb_reltypes', 'relationshipTypes', 'list');
    bind('#npcb_threshold', 'threshold', 'number');
    bind('#npcb_tolerance', 'numericTolerance', 'number');
    bind('#npcb_traitkeys', 'traitKeys', 'list');
    bind('#npcb_postures', 'postures', 'list');
    bind('#npcb_states', 'states', 'list');
    root.find('#npcb_threshold').on('input', () => root.find('#npcb_threshold_val').text(`${s.threshold}%`));
    root.find('#npcb_threshold_val').text(`${s.threshold}%`);
    root.find('#npcb_install_pm').on('click', installPmEntries);
    root.find('#npcb_open_lib').on('click', () => openLibrary());
    root.find('#npcb_preview').on('click', async () => {
        const c = ctx();
        const text = `<h4>{{npcInstructions}}</h4><pre class="npcb-pre">${esc(buildInstructionText() || '(empty)')}</pre><h4>{{npcScene}}</h4><pre class="npcb-pre">${esc(buildSceneText() || '(empty — nobody in scene)')}</pre>`;
        await c.callGenericPopup(text, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
    });
    // Long prompts are edited in a popup; the buttons mark the ones that differ from the default.
    root.on('click', '.npcb-prompt-btn', (e) => openPromptEditor(String($(e.currentTarget).data('prompt'))));
    // ⓘ icons: hover shows the tip; click opens it (or its <template>) in a popup, so it also works on touch screens.
    root.on('click', '.npcb-help', async (e) => {
        e.preventDefault(); // inside a <label>, a click would toggle the checkbox
        e.stopPropagation();
        const c = ctx();
        const tpl = $(e.currentTarget).data('help');
        const html = tpl ? $(`#${tpl}`).html() : `<div style="text-align:left">${esc($(e.currentTarget).attr('title') || '')}</div>`;
        await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', { wide: !!tpl, allowVerticalScrolling: true });
    });
    syncModeUi();
    syncPromptButtons();
    renderPmStatus();
}

/** Prompt texts edited in a popup: settings key → title, default, placeholder hint, and what to refresh after saving. */
const PROMPT_EDITORS = {
    instructions: { title: 'Tracking prompt', def: DEFAULT_INSTRUCTIONS, hint: 'Placeholders: [[EXCLUDE]] [[MAX_NEW]] [[SPEAKER_RULE]] [[OUTFIT_RULES]] [[USER_EXAMPLE]] [[USER]] [[CHAR]] [[POSTURES]] [[STATES]] [[TRAIT_KEYS]] [[TRAIT_EXAMPLE]] [[LIBRARY]]. The LLM must answer with an <npcs>[...]</npcs> JSON block.' },
    outfitRules: { title: 'Clothing rules', def: DEFAULT_OUTFIT_RULES, hint: 'Inserted at [[OUTFIT_RULES]]. Placeholders: [[CONDITIONS]] [[SLOTS]].' },
    relationshipRule: { title: 'Relationship rule', def: DEFAULT_RELATIONSHIP_RULE, hint: 'Added to [[OUTFIT_RULES]] while relationships are tracked. Placeholders: [[REL_TYPES]] [[ATTITUDES]] [[USER]].' },
    speakerRule: { title: 'Speaker rule', def: DEFAULT_SPEAKER_RULE, hint: 'Inserted at [[SPEAKER_RULE]]. The LLM wraps each character\'s part in <npc id="ID">…</npc>.' },
    speakerReminder: { title: 'Speaker reminder', def: DEFAULT_SPEAKER_REMINDER, hint: 'Sent right before every reply (in chat, depth 0). [[IDS]] = ids of the characters in the scene. Empty = off.' },
    portraitLlmPrompt: { title: 'Portrait LLM instruction', def: DEFAULT_PORTRAIT_LLM_PROMPT, hint: 'Placeholders: {{name}}/{{char}} {{traits}} {{details}} {{outfit}} {{posture}} {{state}}. The NPC\'s data and the latest story messages are sent along with it.' },
    assistCardPrompt: { title: 'Card assist prompt', def: DEFAULT_ASSIST_CARD_PROMPT, hint: 'System prompt for ✨ Assist on the Card tab.' },
    assistWardrobePrompt: { title: 'Wardrobe assist prompt', def: DEFAULT_ASSIST_WARDROBE_PROMPT, hint: 'System prompt for ✨ Assist on the Wardrobe tab.' },
};

async function openPromptEditor(key) {
    const def = PROMPT_EDITORS[key];
    if (!def) return;
    const c = ctx();
    const s = settings();
    const box = $(`<div class="npcb-prompt-editor">
        <h3>${esc(def.title)}</h3>
        <div class="npcb-prompt-hint"><small>${esc(def.hint)}</small></div>
        <textarea class="text_pole"></textarea>
        <div class="npcb-row"><div class="menu_button npcb-prompt-reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</div></div>
    </div>`);
    const ta = box.find('textarea').val(String(s[key] ?? ''));
    box.on('click', '.npcb-prompt-reset', () => ta.val(def.def).trigger('focus'));
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    s[key] = String(ta.val());
    save();
    updateAutoInjection();
    syncPromptButtons();
}

/** Mark prompt buttons whose text differs from the default. */
function syncPromptButtons() {
    const s = settings();
    $('#npcb_settings .npcb-prompt-btn').each((_, el) => {
        const def = PROMPT_EDITORS[$(el).data('prompt')];
        $(el).find('.npcb-custom').remove();
        if (def && String(s[$(el).data('prompt')] ?? '').trim() !== def.def.trim()) $(el).append('<span class="npcb-custom" title="Changed from the default">custom</span>');
    });
}

function syncModeUi() {
    const s = settings();
    $('#npcb_preview').toggle(!!s.debug);
    $('#npcb_auto_opts').toggle(s.injectMode === 'auto');
    $('#npcb_pm_opts').toggle(s.injectMode === 'pm');
    renderPmStatus();
}
