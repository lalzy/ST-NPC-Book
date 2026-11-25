// Speaker card decoration in rendered messages (avatar, color) and the chat observer.

import { hasChat } from '../core/context.js';
import { allTemplates } from '../core/libraries.js';
import { lib, settings } from '../core/settings.js';
import { initials } from '../core/utils.js';
import { resolveRef } from '../logic/matching.js';
import { normColor } from '../logic/text.js';
import { ensurePortrait } from '../portraits/portraitQueue.js';
import { findInstance } from '../scene/roster.js';

/**
 * Fill the avatar box of a speaker card (portrait, or initials when there is none) and set its accent color.
 * The speaker is this chat's instance; a library template is only shown for someone the chat has no instance of.
 */
function decorateTurn(turn) {
    const ava = turn.querySelector(':scope > [data-npcb-ava]');
    if (!ava) return;
    const raw = turn.getAttribute('data-npcb-turn') || '';
    const inst = hasChat() ? findInstance(raw) : null;
    // Not in this chat yet: NPC Book's library or an extension library (e.g. a Bestiary), since ids are unique across them.
    const all = inst ? null : allTemplates();
    const id = inst?.id ?? resolveRef(raw, all);
    const t = inst ?? (id ? all[id] : null);
    if (inst && !inst.portrait) ensurePortrait(inst.id, { target: 'instance' });
    const key = `${id}|${t?.portrait || ''}|${t?.color || ''}|${t?.name || ''}`;
    if (ava.dataset.npcbKey === key) return;
    ava.dataset.npcbKey = key;
    ava.title = t?.name || raw;
    if (t?.portrait) {
        ava.style.backgroundImage = `url(${JSON.stringify(t.portrait)})`;
        ava.textContent = '';
    } else {
        ava.style.backgroundImage = '';
        ava.textContent = initials(t?.name || raw);
    }
    const color = normColor(t?.color);
    if (color) turn.style.setProperty('--npcb-c', color); else turn.style.removeProperty('--npcb-c');
    turn.classList.toggle('npcb-colored', !!color);
}

/** Card on/off and avatar size, applied through CSS so themes can't override them. */
export function applyCardStyle() {
    const s = settings();
    const size = Math.min(200, Math.max(16, Number(s.speakerPortraitSize) || 40));
    document.documentElement.style.setProperty('--npcb-ava-size', `${size}px`);
    $('#chat').toggleClass('npcb-cards-off', !(s.enabled && s.speakerPortraits))
        .toggleClass('npcb-colors-off', !(s.enabled && s.dialogueColors));
}

function decorateMessage(mesid) {
    const textEl = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text`);
    if (!textEl) return;
    for (const turn of textEl.querySelectorAll('div[data-npcb-turn]')) decorateTurn(turn);
}

export function decorateAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => decorateMessage(el.getAttribute('mesid')));
}

const pendingDecorate = new Set();
let decorateTimer = null;
function scheduleDecorate(mesid) {
    if (mesid === undefined || mesid === null) return;
    pendingDecorate.add(String(mesid));
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
        const ids = [...pendingDecorate];
        pendingDecorate.clear();
        ids.forEach(decorateMessage);
    }, 150);
}

export function observeChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl || chatEl.dataset.npcbObserved) return;
    chatEl.dataset.npcbObserved = '1';
    new MutationObserver((muts) => {
        for (const m of muts) {
            const nodes = [...m.addedNodes];
            const mes = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('.mes[mesid]');
            if (mes) scheduleDecorate(mes.getAttribute('mesid'));
            for (const n of nodes) if (n.nodeType === 1 && n.matches?.('.mes[mesid]')) scheduleDecorate(n.getAttribute('mesid'));
        }
    }).observe(chatEl, { childList: true, subtree: true });
}
