// Paperdoll widget: shows and edits what is worn per slot.

import { SLOT_LABEL } from '../../constants.js';
import { settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { outfitBySlot, wearItem } from '../../logic/outfit.js';
import { SLOTS } from '../../logic/slots.js';
import { normalize } from '../../logic/text.js';

function condOptions(cur) {
    const list = [...settings().conditions];
    if (cur && !list.includes(cur)) list.unshift(cur);
    return list.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
}

/** Paperdoll: shows what is worn per slot; click a slot to change it. */
export function mountPaperdoll(host, getOutfit, setOutfit, getWardrobe, onEditWardrobe) {
    const s = settings();
    const draw = (openSlot = null) => {
        const wardrobe = getWardrobe();
        const outfit = getOutfit();
        const bySlot = outfitBySlot(outfit, wardrobe);
        const cell = (key) => {
            const label = SLOT_LABEL[key];
            const worn = bySlot[key];
            const txt = worn.length ? worn.map(w => `${esc(w.item.name)}${w.condition && w.condition !== s.conditions[0] ? ` <i class="npcb-cond">${esc(w.condition)}</i>` : ''}`).join(', ') : '<span class="npcb-dim">—</span>';
            return `<div class="npcb-slot ${openSlot === key ? 'open' : ''} ${worn.length ? 'filled' : ''}" data-slot="${key}" style="grid-area:${key}"><div class="npcb-slot-label">${esc(label)}</div><div class="npcb-slot-items">${txt}</div></div>`;
        };
        let editor = '';
        if (openSlot) {
            const fits = wardrobe.filter(i => i.slots.includes(openSlot));
            const wornHere = bySlot[openSlot].map(w => w.item.id);
            editor = `<div class="npcb-slot-editor">
                <b>${esc(SLOT_LABEL[openSlot])}</b>
                ${fits.length > 8 ? '<input type="search" class="text_pole npcb-slot-search" placeholder="Search…">' : ''}
                ${fits.length ? fits.map(i => {
                    const w = outfit.find(x => x.id === i.id);
                    return `<div class="npcb-row npcb-slot-opt" data-item="${esc(i.id)}">
                        <label class="checkbox_label"><input type="checkbox" class="npcb-wear" ${wornHere.includes(i.id) ? 'checked' : ''}> ${esc(i.name)}${i.slots.length > 1 ? ` <small class="npcb-dim">(${i.slots.map(k => SLOT_LABEL[k]).join(' + ')})</small>` : ''}</label>
                        <select class="text_pole npcb-cond-sel" ${w ? '' : 'disabled'}>${condOptions(w?.condition)}</select>
                    </div>`;
                }).join('') : '<div class="npcb-empty">No wardrobe items for this slot.</div>'}
            </div>`;
        }
        host.html(`<div class="npcb-doll">${SLOTS.map(x => cell(x.key)).join('')}</div>${editor}
            ${onEditWardrobe ? '<div class="menu_button npcb-edit-wardrobe"><i class="fa-solid fa-shirt"></i> Edit wardrobe</div>' : ''}`);
        host.data('openSlot', openSlot);
        const pop = host.closest('.npcb-popover');
        if (pop.length) {
            const r = pop[0].getBoundingClientRect();
            if (r.bottom > window.innerHeight - 8) pop.css('top', Math.max(8, window.innerHeight - 8 - r.height));
        }
    };
    host.off('.doll');
    host.on('click.doll', '.npcb-slot', (e) => { const k = $(e.currentTarget).data('slot'); draw(host.data('openSlot') === k ? null : k); });
    host.on('change.doll', '.npcb-wear', (e) => {
        const id = $(e.target).closest('.npcb-slot-opt').data('item');
        const wardrobe = getWardrobe();
        if (e.target.checked) setOutfit(wearItem(getOutfit(), wardrobe, id, s.conditions[0]).outfit);
        else setOutfit(getOutfit().filter(w => w.id !== id));
        draw(host.data('openSlot'));
    });
    host.on('change.doll', '.npcb-cond-sel', (e) => {
        const id = $(e.target).closest('.npcb-slot-opt').data('item');
        setOutfit(getOutfit().map(w => w.id === id ? { ...w, condition: String($(e.target).val()) } : w));
        draw(host.data('openSlot'));
    });
    host.on('click.doll', '.npcb-edit-wardrobe', () => onEditWardrobe?.());
    host.on('input.doll', '.npcb-slot-search', (e) => {
        const q = normalize(e.target.value);
        host.find('.npcb-slot-opt').each((_, el) => { $(el).toggle(!q || normalize($(el).text()).includes(q)); });
    });
    draw();
}
