// "In scene" bar above the input box.

import { getUserAvatar } from '../../../../../../personas.js';
import { HEX_RE } from '../../constants.js';
import { ctx, hasChat } from '../../core/context.js';
import { chatNewNpcFolder, newNpcFolder } from '../../core/folders.js';
import { save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { ensurePortrait } from '../../portraits/portraitQueue.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { currentUser, personaKey } from '../../scene/persona.js';
import { currentRoster } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { showTrackerBlock } from '../trackerBlock.js';
import { openAddPicker } from './addPicker.js';
import { openInstanceEditor } from './instanceEditor.js';
import { openNewNpcFolderMenu } from './newNpcFolderMenu.js';
import { openUserEditor } from './userEditor.js';

export function ensureRosterBar() {
    if ($('#npcb_roster').length) return;
    const bar = $(`
        <div id="npcb_roster" class="npcb-roster">
            <div class="npcb-roster-head">
                <span class="npcb-roster-toggle fa-solid fa-chevron-down" title="Collapse / expand"></span>
                <span class="npcb-roster-title">In scene</span>
                <span class="npcb-roster-count"></span>
                <span class="npcb-roster-add fa-solid fa-user-plus" title="Add NPC to scene"></span>
                <span class="npcb-roster-folder fa-solid fa-folder" title="Folder for new NPCs"></span>
                <span class="npcb-roster-block fa-solid fa-code" title="Show the last NPC block the AI wrote"></span>
            </div>
            <div class="npcb-roster-body"><div class="npcb-user-slot"></div><div class="npcb-roster-cards"></div></div>
        </div>`);
    $('#send_form').before(bar);
    bar.on('click', '.npcb-roster-toggle', () => { settings().rosterCollapsed = !settings().rosterCollapsed; save(); renderRoster(); });
    bar.on('click', '.npcb-roster-add', (e) => { e.stopPropagation(); openAddPicker(e.currentTarget); });
    bar.on('click', '.npcb-roster-folder', (e) => { e.stopPropagation(); openNewNpcFolderMenu(e.currentTarget); });
    bar.on('click', '.npcb-roster-block', (e) => { e.stopPropagation(); showTrackerBlock(); });
    bar.on('click', '.npcb-roster-cards .npcb-card', (e) => { e.stopPropagation(); openInstanceEditor($(e.currentTarget).data('id'), e.currentTarget); });
    bar.on('click', '.npcb-user-card', (e) => { e.stopPropagation(); openUserEditor(e.currentTarget); });
}

export function renderRoster() {
    ensureRosterBar();
    const s = settings();
    const bar = $('#npcb_roster');
    if (!s.enabled || !hasChat()) { bar.hide(); updateAutoInjection(); return; }
    // Collapsed = one thin line: "In scene (n)" and the add button. Everything else (persona card included) hides.
    const collapsed = !!s.rosterCollapsed;
    bar.show().toggleClass('npcb-collapsed', collapsed);
    bar.find('.npcb-roster-body').toggle(!collapsed);
    bar.find('.npcb-roster-toggle').toggleClass('fa-chevron-down', !collapsed).toggleClass('fa-chevron-right', collapsed).attr('title', collapsed ? 'Expand' : 'Collapse');
    bar.find('.npcb-roster-folder').toggle(!collapsed);
    bar.find('.npcb-roster-block').toggle(!!s.debug && !collapsed); // debug tool: last <npcs> block
    const chatFolder = chatNewNpcFolder();
    const where = newNpcFolder() || 'top level';
    bar.find('.npcb-roster-folder')
        .toggleClass('fa-folder', chatFolder === undefined).toggleClass('fa-folder-open', chatFolder !== undefined)
        .attr('title', `New NPCs go to: ${where}${chatFolder !== undefined ? ' (this chat)' : ' (default from Settings)'}. Click to change.`);
    const roster = currentRoster();
    bar.find('.npcb-roster-count').text(roster.length ? `(${roster.length})` : '');
    const cards = roster.map(inst => {
        const t = inst; // the chat's instance carries its own card fields
        if (!t.portrait) ensurePortrait(t.id, { target: 'instance' });
        const name = t?.name ?? inst.name ?? inst.id;
        const sub = [inst.posture, inst.state].filter(Boolean).join(' · ');
        return `<div class="npcb-card" data-id="${esc(inst.id)}" title="${esc(name)}${inst.feelings ? `\n💭 ${esc(inst.feelings)}` : ''}">
            ${avatarHtml(t, name)}
            <div class="npcb-card-name" ${HEX_RE.test(t?.color || '') ? `style="color:${t.color}"` : ''}>${esc(name)}</div>
            <div class="npcb-card-sub">${esc(sub)}</div>
        </div>`;
    });
    bar.find('.npcb-roster-cards').html(cards.length ? cards.join('') : '<div class="npcb-empty">Nobody here. Add an NPC, or the LLM will add them as they appear.</div>');
    const us = bar.find('.npcb-user-slot');
    if (s.trackUser) {
        const c = ctx();
        const u = currentUser();
        const ava = personaKey() ? `<img class="npcb-ava" src="${esc(getUserAvatar(personaKey()))}" draggable="false">` : avatarHtml(null, c.name1);
        us.show().html(`<div class="npcb-card npcb-user-card" title="${esc(c.name1)} (you)">${ava}<div class="npcb-card-name">${esc(c.name1)}</div><div class="npcb-card-sub">${esc(u.posture || '')}</div></div>`);
    } else us.hide().empty();
    updateAutoInjection();
}
