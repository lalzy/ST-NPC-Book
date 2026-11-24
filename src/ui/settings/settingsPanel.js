// Extension settings panel (settings.html) bindings.

import { DEFAULT_ASSIST_CARD_PROMPT, DEFAULT_ASSIST_WARDROBE_PROMPT, DEFAULT_INSTRUCTIONS, DEFAULT_OUTFIT_RULES, DEFAULT_PORTRAIT_LLM_PROMPT, DEFAULT_SPEAKER_REMINDER, DEFAULT_SPEAKER_RULE, EXT_FOLDER } from '../../constants.js';
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
    bind('#npcb_mode', 'injectMode');
    bind('#npcb_scene_pos', 'scenePosition', 'number');
    bind('#npcb_scene_depth', 'sceneDepth', 'number');
    bind('#npcb_scene_role', 'sceneRole', 'number');
    bind('#npcb_instr_pos', 'instrPosition', 'number');
    bind('#npcb_instr_depth', 'instrDepth', 'number');
    bind('#npcb_instr_role', 'instrRole', 'number');
    bind('#npcb_instructions', 'instructions');
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
    bind('#npcb_portraitllm', 'portraitLlmPrompt');
    root.find('#npcb_reset_portraitllm').on('click', () => { s.portraitLlmPrompt = DEFAULT_PORTRAIT_LLM_PROMPT; root.find('#npcb_portraitllm').val(s.portraitLlmPrompt); save(); });
    root.find('#npcb_speakerportraits, #npcb_speakersize, #npcb_enabled').on('input change', () => { applyCardStyle(); decorateAll(); });
    bind('#npcb_speakerrule', 'speakerRule');
    bind('#npcb_speakerreminder', 'speakerReminder');
    root.find('#npcb_reset_speakerreminder').on('click', () => { s.speakerReminder = DEFAULT_SPEAKER_REMINDER; root.find('#npcb_speakerreminder').val(s.speakerReminder); save(); updateAutoInjection(); });
    root.find('#npcb_reset_speaker').on('click', () => { s.speakerRule = DEFAULT_SPEAKER_RULE; root.find('#npcb_speakerrule').val(s.speakerRule); save(); });
    bind('#npcb_trackoutfits', 'trackOutfits', 'checkbox');
    bind('#npcb_exposure', 'describeExposure', 'checkbox');
    bind('#npcb_incwardrobe', 'includeWardrobe', 'checkbox');
    bind('#npcb_wdgrowth', 'allowWardrobeGrowth', 'checkbox');
    bind('#npcb_outfitrules', 'outfitRules');
    bind('#npcb_assistcard', 'assistCardPrompt');
    bind('#npcb_assistwardrobe', 'assistWardrobePrompt');
    root.find('#npcb_reset_assistcard').on('click', () => { s.assistCardPrompt = DEFAULT_ASSIST_CARD_PROMPT; root.find('#npcb_assistcard').val(s.assistCardPrompt); save(); });
    root.find('#npcb_reset_assistwardrobe').on('click', () => { s.assistWardrobePrompt = DEFAULT_ASSIST_WARDROBE_PROMPT; root.find('#npcb_assistwardrobe').val(s.assistWardrobePrompt); save(); });
    bind('#npcb_conditions', 'conditions', 'list');
    root.find('#npcb_reset_outfit').on('click', () => { s.outfitRules = DEFAULT_OUTFIT_RULES; root.find('#npcb_outfitrules').val(s.outfitRules); save(); });
    bind('#npcb_threshold', 'threshold', 'number');
    bind('#npcb_tolerance', 'numericTolerance', 'number');
    bind('#npcb_traitkeys', 'traitKeys', 'list');
    bind('#npcb_postures', 'postures', 'list');
    bind('#npcb_states', 'states', 'list');
    root.find('#npcb_threshold').on('input', () => root.find('#npcb_threshold_val').text(`${s.threshold}%`));
    root.find('#npcb_threshold_val').text(`${s.threshold}%`);
    root.find('#npcb_install_pm').on('click', installPmEntries);
    root.find('#npcb_reset_instr').on('click', () => { s.instructions = DEFAULT_INSTRUCTIONS; root.find('#npcb_instructions').val(s.instructions); save(); });
    root.find('#npcb_open_lib').on('click', () => openLibrary());
    root.find('#npcb_preview').on('click', async () => {
        const c = ctx();
        const text = `<h4>{{npcInstructions}}</h4><pre class="npcb-pre">${esc(buildInstructionText() || '(empty)')}</pre><h4>{{npcScene}}</h4><pre class="npcb-pre">${esc(buildSceneText() || '(empty — nobody in scene)')}</pre>`;
        await c.callGenericPopup(text, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
    });
    syncModeUi();
    renderPmStatus();
}

function syncModeUi() {
    const s = settings();
    $('#npcb_auto_opts').toggle(s.injectMode === 'auto');
    $('#npcb_pm_opts').toggle(s.injectMode === 'pm');
    renderPmStatus();
}
