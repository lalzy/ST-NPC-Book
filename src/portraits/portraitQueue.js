// Portrait generation queue through the Image Generation extension.
// Two targets: 'instance' (an NPC of the open chat: the image goes to that chat's instance only) and
// 'template' (a Library card: the image goes to the template only). Neither ever writes to the other.

import { ctx, hasChat } from '../core/context.js';
import { lib, save, settings } from '../core/settings.js';
import { currentScene, patchInstanceEverywhere } from '../scene/roster.js';
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

const chatKey = () => String(ctx().getCurrentChatId?.() ?? '');

/** The card a portrait job is for: the open chat's instance, or the library template. */
function portraitSubject(id, target) {
    if (target === 'instance') return hasChat() ? currentScene().instances[id] ?? null : null;
    return lib()[id] ?? null;
}

/** Queue an image-generation run for an NPC without a portrait (only if the Image Generation extension is active). */
export function ensurePortrait(id, { force = false, target = 'template' } = {}) {
    const s = settings();
    const t = portraitSubject(id, target);
    if (!t || (t.portrait && !force)) return;
    const chat = target === 'instance' ? chatKey() : '';
    const key = `${target}:${chat}:${id}`;
    if (!force && (!s.autoPortraits || portraitTried.has(key))) return;
    if (!imageGenAvailable()) { if (force) toastr.warning('Image Generation extension is not active.', 'NPC Book'); return; }
    portraitTried.add(key);
    if (!portraitQueue.some(q => q.id === id && q.target === target && q.chat === chat)) portraitQueue.push({ id, force, target, chat });
    runPortraitQueue();
}

/** Store a finished portrait on its target (and only there), then refresh what shows it. */
function storePortrait(job, url) {
    const { id, target, chat } = job;
    if (target === 'instance') {
        if (chat !== chatKey()) return; // the chat was switched meanwhile: that chat's instance is not reachable now
        patchInstanceEverywhere(id, { portrait: url });
        renderRoster();
        decorateAll();
        return;
    }
    if (!lib()[id]) return;
    lib()[id].portrait = url;
    save();
    renderLibraryList();
    if (libState.selected === id && !libState.isNew) $('#npcb_library .npcb-ed-portrait').html(avatarHtml(lib()[id], lib()[id].name, 'npcb-ava-lg'));
}

async function runPortraitQueue() {
    if (portraitBusy) return;
    portraitBusy = true;
    try {
        while (portraitQueue.length) {
            const job = portraitQueue.shift();
            const { id, force, target, chat } = job;
            if (target === 'instance' && chat !== chatKey()) continue;
            const t = portraitSubject(id, target);
            if (!t || (t.portrait && !force)) continue;
            try {
                const prompt = await portraitPromptFor(t);
                if (!prompt) { toastr.warning(`Could not build a portrait prompt for ${t.name}.`, 'NPC Book'); continue; }
                const neg = cleanForImagine(settings().portraitFraming ? settings().portraitNegative : '');
                const negArg = neg ? ` negative="${neg}"` : '';
                const res = await ctx().executeSlashCommandsWithOptions(`/imagine quiet=true gallery=false extend=false edit=false${negArg} "${prompt}"`, { handleParserErrors: false, handleExecutionErrors: false });
                const url = String(res?.pipe ?? '').trim();
                if (url) storePortrait(job, url.startsWith('/') || url.startsWith('data:') || url.startsWith('http') ? url : `/${url}`);
            } catch (e) {
                console.warn('[NPC Book] portrait generation failed', e);
                if (force) toastr.error(`Portrait generation failed: ${e?.message || e}`, 'NPC Book');
            }
        }
    } finally {
        portraitBusy = false;
    }
}
