// Paperdoll widget: shows and edits what is worn per slot.
// Any clothing can be put on: type it into a slot. A sister extension may offer known items (e.g. a wardrobe) through
// its outfitCatalog hook; those are listed per slot, and a strict catalog allows only them.

import { SLOT_LABEL } from '../../constants.js';
import { settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { makeItem, outfitBySlot, wearItem } from '../../logic/outfit.js';
import { SLOTS } from '../../logic/slots.js';
import { normalize } from '../../logic/text.js';

function condOptions(cur) {
    const list = [...settings().conditions];
    if (cur && !list.includes(cur)) list.unshift(cur);
    return list.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
}

const NO_CATALOG = () => ({ items: [], strict: false, actions: [] });

/**
 * Paperdoll: shows what is worn per slot; click a slot to change it.
 * getOutfit() / setOutfit(list) read and write the (draft) outfit of self-contained items.
 * getCatalog() → { items, strict, actions: [{label, icon, run}] } (see extHooks.outfitCatalog).
 */
export function mountPaperdoll(host, getOutfit, setOutfit, getCatalog = NO_CATALOG) {
    const s = settings();
    const keyOf = (it) => it.id || normalize(it.name);
    const draw = (openSlot = null) => {
        const cat = getCatalog() || NO_CATALOG();
        const outfit = getOutfit();
        const bySlot = outfitBySlot(outfit);
        const cell = (key) => {
            const label = SLOT_LABEL[key];
            const worn = bySlot[key];
            const txt = worn.length ? worn.map(w => `${esc(w.item.name)}${w.condition && w.condition !== s.conditions[0] ? ` <i class="npcb-cond">${esc(w.condition)}</i>` : ''}`).join(', ') : '<span class="npcb-dim">—</span>';
            return `<div class="npcb-slot ${openSlot === key ? 'open' : ''} ${worn.length ? 'filled' : ''}" data-slot="${key}" style="grid-area:${key}"><div class="npcb-slot-label">${esc(label)}</div><div class="npcb-slot-items">${txt}</div></div>`;
        };
        let editor = '';
        if (openSlot) {
            const wornHere = bySlot[openSlot].map(w => w.item);
            const known = (cat.items || []).filter(i => (i.slots || []).includes(openSlot) && !wornHere.some(w => keyOf(w) === keyOf(i) || normalize(w.name) === normalize(i.name)));
            const opts = [...wornHere.map(i => ({ i, on: true })), ...known.map(i => ({ i, on: false }))];
            editor = `<div class="npcb-slot-editor">
                <b>${esc(SLOT_LABEL[openSlot])}</b>
                ${opts.length > 8 ? '<input type="search" class="text_pole npcb-slot-search" placeholder="Search…">' : ''}
                ${opts.length ? opts.map(({ i, on }) => {
                    const w = on ? outfit.find(x => keyOf(x) === keyOf(i)) : null;
                    return `<div class="npcb-row npcb-slot-opt" data-item="${esc(keyOf(i))}" data-known="${on ? '0' : '1'}">
                        <label class="checkbox_label"><input type="checkbox" class="npcb-wear" ${on ? 'checked' : ''}> ${esc(i.name)}${(i.slots || []).length > 1 ? ` <small class="npcb-dim">(${i.slots.map(k => SLOT_LABEL[k]).join(' + ')})</small>` : ''}</label>
                        <select class="text_pole npcb-cond-sel" ${w ? '' : 'disabled'}>${condOptions(w?.condition)}</select>
                    </div>`;
                }).join('') : '<div class="npcb-empty">Nothing here.</div>'}
                ${cat.strict ? '' : '<div class="npcb-slot-add"><i class="fa-solid fa-plus"></i><input class="text_pole npcb-slot-new" placeholder="Put on something… (Enter)"></div>'}
            </div>`;
        }
        host.html(`<div class="npcb-doll">${SLOTS.map(x => cell(x.key)).join('')}</div>${editor}
            ${(cat.actions || []).map((a, n) => `<div class="menu_button npcb-doll-action" data-action="${n}"><i class="fa-solid ${esc(a.icon || 'fa-shirt')}"></i> ${esc(a.label)}</div>`).join('')}`);
        host.data('openSlot', openSlot);
        host.data('catalog', cat);
        const pop = host.closest('.npcb-popover');
        if (pop.length) {
            const r = pop[0].getBoundingClientRect();
            if (r.bottom > window.innerHeight - 8) pop.css('top', Math.max(8, window.innerHeight - 8 - r.height));
        }
    };
    const itemFor = (key) => getOutfit().find(w => keyOf(w) === key) || (host.data('catalog')?.items || []).find(i => keyOf(i) === key) || null;
    host.off('.doll');
    host.on('click.doll', '.npcb-slot', (e) => { const k = $(e.currentTarget).data('slot'); draw(host.data('openSlot') === k ? null : k); });
    host.on('change.doll', '.npcb-wear', (e) => {
        const key = String($(e.target).closest('.npcb-slot-opt').data('item'));
        const it = itemFor(key);
        if (e.target.checked && it) setOutfit(wearItem(getOutfit(), it, s.conditions[0]).outfit);
        else setOutfit(getOutfit().filter(w => keyOf(w) !== key));
        draw(host.data('openSlot'));
    });
    host.on('change.doll', '.npcb-cond-sel', (e) => {
        const key = String($(e.target).closest('.npcb-slot-opt').data('item'));
        setOutfit(getOutfit().map(w => keyOf(w) === key ? { ...w, condition: String($(e.target).val()) } : w));
        draw(host.data('openSlot'));
    });
    host.on('keydown.doll', '.npcb-slot-new', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = String($(e.target).val() ?? '').trim();
        const slot = host.data('openSlot');
        if (!name || !slot) return;
        const outfit = getOutfit();
        const known = (host.data('catalog')?.items || []).find(i => normalize(i.name) === normalize(name));
        const item = known || makeItem(name, [slot], (id) => outfit.some(w => w.id === id));
        setOutfit(wearItem(outfit, item, s.conditions[0]).outfit);
        draw(slot);
        host.find('.npcb-slot-new').trigger('focus');
    });
    host.on('click.doll', '.npcb-doll-action', (e) => {
        const a = (host.data('catalog')?.actions || [])[Number($(e.currentTarget).data('action'))];
        try { a?.run?.(); } catch (err) { console.warn('[NPC Book] outfit action failed', err); }
    });
    host.on('input.doll', '.npcb-slot-search', (e) => {
        const q = normalize(e.target.value);
        host.find('.npcb-slot-opt').each((_, el) => { $(el).toggle(!q || normalize($(el).text()).includes(q)); });
    });
    draw();
    return { refresh: () => draw(host.data('openSlot')) };
}
