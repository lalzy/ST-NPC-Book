// SillyTavern event wiring: generation, chat, message and persona events, plus global popover / Escape handling.

import { ctx } from './core/context.js';
import { runtime } from './core/runtime.js';
import { updateAutoInjection } from './prompt/injection.js';
import { renderPmStatus } from './prompt/promptManager.js';
import { migrateChatScenes } from './scene/migrate.js';
import { decorateAll } from './speakers/decorate.js';
import { onGenerationStarted, processLastMessage } from './tracking/generation.js';
import { processGreetings } from './tracking/greetings.js';
import { renderLibraryList } from './ui/library/libraryList.js';
import { closeLibrary } from './ui/library/modal.js';
import { closePopovers } from './ui/popover.js';
import { renderRoster } from './ui/roster/rosterBar.js';

export function registerEventHandlers() {
    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, (id, type) => { if (type === 'first_message') processGreetings(); else processLastMessage(); });
    const finish = () => setTimeout(() => processLastMessage(), 0);
    eventSource.on(eventTypes.GENERATION_ENDED, finish);
    eventSource.on(eventTypes.GENERATION_STOPPED, finish);
    eventSource.on(eventTypes.CHAT_CHANGED, () => { runtime.genCtx = null; closePopovers(); migrateChatScenes(); renderRoster(); renderLibraryList(); updateAutoInjection(); processGreetings(); setTimeout(decorateAll, 300); });
    eventSource.on(eventTypes.MESSAGE_EDITED, (id) => { const m = ctx().chat?.[id]; if (m && !m.is_user && (ctx().chat.slice(0, id).every(x => !x.is_user))) processGreetings(); });
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => setTimeout(decorateAll, 100));
    for (const ev of [eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_DELETED, eventTypes.MESSAGE_EDITED]) {
        eventSource.on(ev, () => { renderRoster(); updateAutoInjection(); });
    }
    eventSource.on(eventTypes.SETTINGS_UPDATED, renderPmStatus);
    eventSource.on(eventTypes.PERSONA_CHANGED, () => { closePopovers(); renderRoster(); });
    $(document).on('click', (e) => { if (!$(e.target).closest('.npcb-popover').length) closePopovers(); });
    $(document).on('keydown', (e) => { if (e.key === 'Escape') { closePopovers(); closeLibrary(); } });
}
