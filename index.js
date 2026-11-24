// NPC Book — character-scoped NPC cards for SillyTavern.
// NPC details are injected ONLY while the NPC is present in the current chat's scene roster.
// Entry point: wires the modules together at startup. Logic lives in src/ (see src/ folder layout).

import { exposePublicApi } from './src/api.js';
import { settings } from './src/core/settings.js';
import { registerEventHandlers } from './src/events.js';
import { registerMacros, updateAutoInjection } from './src/prompt/injection.js';
import { applyCardStyle, decorateAll, observeChat } from './src/speakers/decorate.js';
import { registerTurnFormatter } from './src/speakers/turnFormatter.js';
import { ensureLibraryModal, ensureTopButton } from './src/ui/library/modal.js';
import { ensurePersonaButton } from './src/ui/persona/personaCharacter.js';
import { ensureRosterBar, renderRoster } from './src/ui/roster/rosterBar.js';
import { mountSettings } from './src/ui/settings/settingsPanel.js';

jQuery(async () => {
    settings();
    registerMacros();
    registerTurnFormatter();
    ensureTopButton();
    ensureLibraryModal();
    ensureRosterBar();
    await mountSettings();

    registerEventHandlers();

    renderRoster();
    updateAutoInjection();
    observeChat();
    applyCardStyle();
    decorateAll();
    ensurePersonaButton();
    exposePublicApi();
});
