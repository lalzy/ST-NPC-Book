// Portrait generation queue through the Image Generation extension.

import { ctx } from '../core/context.js';
import { lib, save, settings } from '../core/settings.js';
import { decorateAll } from '../speakers/decorate.js';
import { avatarHtml } from '../ui/avatar.js';
import { renderLibraryList } from '../ui/library/libraryList.js';
import { libState } from '../ui/library/state.js';
import { renderRoster } from '../ui/roster/rosterBar.js';
import { cleanForImagine, portraitPromptFor } from './portraitPrompt.js';

const portraitTried = new Set();
let portraitBusy = false;
const portraitQueue = [];

function imageGenAvailable() {
    const c = ctx();
    const disabled = c.extensionSettings?.disabledExtensions || [];
    if (disabled.includes('stable-diffusion')) return false;
    return !!c.SlashCommandParser?.commands?.imagine;
}

/** Queue an image-generation run for an NPC without a portrait (only if the Image Generation extension is active). */
export function ensurePortrait(id, { force = false } = {}) {
    const s = settings();
    const t = lib()[id];
    if (!t || (t.portrait && !force)) return;
    if (!force && (!s.autoPortraits || portraitTried.has(id))) return;
    if (!imageGenAvailable()) { if (force) toastr.warning('Image Generation extension is not active.', 'NPC Book'); return; }
    portraitTried.add(id);
    if (!portraitQueue.some(q => q.id === id)) portraitQueue.push({ id, force });
    runPortraitQueue();
}

async function runPortraitQueue() {
    if (portraitBusy) return;
    portraitBusy = true;
    try {
        while (portraitQueue.length) {
            const { id, force } = portraitQueue.shift();
            const t = lib()[id];
            if (!t || (t.portrait && !force)) continue;
            try {
                const prompt = await portraitPromptFor(t);
                if (!prompt) { toastr.warning(`Could not build a portrait prompt for ${t.name}.`, 'NPC Book'); continue; }
                const neg = cleanForImagine(settings().portraitFraming ? settings().portraitNegative : '');
                const negArg = neg ? ` negative="${neg}"` : '';
                const res = await ctx().executeSlashCommandsWithOptions(`/imagine quiet=true gallery=false extend=false edit=false${negArg} "${prompt}"`, { handleParserErrors: false, handleExecutionErrors: false });
                const url = String(res?.pipe ?? '').trim();
                if (url && lib()[id]) {
                    lib()[id].portrait = url.startsWith('/') || url.startsWith('data:') || url.startsWith('http') ? url : `/${url}`;
                    save();
                    renderRoster();
                    renderLibraryList();
                    decorateAll();
                    if (libState.selected === id && !libState.isNew) $('#npcb_library .npcb-ed-portrait').html(avatarHtml(lib()[id], lib()[id].name, 'npcb-ava-lg'));
                }
            } catch (e) {
                console.warn('[NPC Book] portrait generation failed', e);
                if (force) toastr.error(`Portrait generation failed: ${e?.message || e}`, 'NPC Book');
            }
        }
    } finally {
        portraitBusy = false;
    }
}
