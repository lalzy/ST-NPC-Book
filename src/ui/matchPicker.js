// Popup shown when the LLM brings in a character whose name is close to someone already known:
// lists the best matches (this chat's NPCs, else NPC Library cards) and a "Create new" option.

import { ctx } from '../core/context.js';
import { traitSummary } from '../core/npcs.js';
import { esc } from '../core/utils.js';
import { avatarHtml } from './avatar.js';

/** Unique, non-empty text values, case-insensitive ("wizard" once, even when both role and traits say it). */
function uniq(values) {
    const seen = new Set();
    return values.map(v => String(v ?? '').trim()).filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

function entryTraits(entry) {
    const tr = entry?.traits && typeof entry.traits === 'object' ? Object.values(entry.traits).filter(v => typeof v !== 'object') : [];
    return uniq([...tr, typeof entry?.role === 'string' ? entry.role : '', typeof entry?.gender === 'string' ? entry.gender : '']).join(', ');
}

function cardHtml({ ava, title, idText, traits, desc, side, attrs, cls = '' }) {
    // Inline layout so SillyTavern's popup and theme styles cannot shrink the cards.
    const style = 'display:flex;flex-direction:row;align-items:center;gap:12px;width:100%;max-width:none;box-sizing:border-box;align-self:stretch;text-align:left;';
    return `<div class="npcb-match-card ${cls}" ${attrs} tabindex="0" style="${style}">
        ${ava}
        <div class="npcb-match-text" style="flex:1 1 auto;min-width:0;">
            <div class="npcb-match-title"><b>${esc(title)}</b>${idText ? ` <small>(${esc(idText)})</small>` : ''}</div>
            ${traits ? `<div class="npcb-match-traits">${esc(traits)}</div>` : ''}
            ${desc ? `<div class="npcb-match-desc">${esc(desc)}</div>` : ''}
        </div>
        ${side ? `<div class="npcb-match-side">${side}</div>` : ''}
    </div>`;
}

/**
 * Ask which known character the LLM meant. `lookup`: { entry, source, candidates: [{ id, score, name, role }] }, `pool`: the
 * cards the candidates come from. The LLM's own character comes first, as "Create new"; the best matches follow.
 * Resolves to { link: id } or { create: true }. Closing the popup counts as "Create new".
 */
export async function pickMatch(lookup, pool, { step = 1, steps = 1 } = {}) {
    const c = ctx();
    const { entry, source, candidates } = lookup;
    const name = String(entry?.name ?? '').trim();
    const where = source === 'instance' ? 'Already in this chat' : 'From your NPC Library';
    const newCard = cardHtml({
        ava: avatarHtml({}, name),
        title: name,
        traits: entryTraits(entry),
        desc: String(entry?.description ?? entry?.details ?? '').trim(),
        side: '<span class="npcb-match-tag npcb-match-tag-new"><i class="fa-solid fa-user-plus"></i> Create new</span>',
        attrs: 'data-new="1"',
        cls: 'npcb-match-new',
    });
    const rows = candidates.map(({ id, score, name: n, role: r }) => {
        const t = pool[id] || { id, name: id };
        const why = uniq([n >= 0.7 ? 'name' : '', r >= 0.8 ? 'role' : '']).join(' + ');
        return cardHtml({
            ava: avatarHtml(t, t.name),
            title: t.name,
            idText: id,
            traits: traitSummary(t),
            desc: String(t.description ?? '').trim() || String(t.details ?? '').trim(),
            side: `<span class="npcb-match-tag">${Math.round(score * 100)}%</span>${why ? `<small>${esc(why)}</small>` : ''}`,
            attrs: `data-id="${esc(id)}"`,
        });
    }).join('');
    const box = $(`<div class="npcb-match" style="display:flex;flex-direction:column;align-items:stretch;gap:8px;width:100%;min-width:min(640px, 80vw);box-sizing:border-box;text-align:left;">
        <div class="npcb-match-head">${steps > 1 ? `<small>${step} of ${steps}</small> ` : ''}The story brought in <b>${esc(name)}</b>. Use the new character, or someone you already have?</div>
        <div class="npcb-match-label">New from the story</div>
        ${newCard}
        <div class="npcb-match-label">Best matches · ${where}</div>
        <div class="npcb-match-list" style="display:flex;flex-direction:column;align-items:stretch;gap:6px;width:100%;">${rows}</div>
        ${lookup.specified ? '' : `<div class="npcb-match-label" style="text-transform:none;letter-spacing:0;">Picking a match renames ${esc(name)} in this reply.</div>`}
    </div>`);
    let result = { create: true };
    const popup = new c.Popup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: false, cancelButton: false });
    const choose = (el) => {
        result = $(el).data('new') ? { create: true } : { link: String($(el).data('id')) };
        popup.complete(c.POPUP_RESULT.AFFIRMATIVE);
    };
    box.on('click', '.npcb-match-card', (e) => choose(e.currentTarget));
    box.on('keydown', '.npcb-match-card', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(e.currentTarget); } });
    await popup.show();
    return result;
}
