// Dialogue example list editor for NPC cards.

import { settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { normalize } from '../../logic/text.js';

/** Dialogue example list editor. Mutates the array in place: [{ kind: 'always' | 'mood' | 'situation', value, text }]. */
export function mountDialogueExamples(host, list) {
    const states = () => settings().states;
    const draw = () => {
        host.html(`${list.map((d, i) => {
            const kind = d.kind || 'always';
            const moods = [...states()];
            if (kind === 'mood' && d.value && !moods.some(x => normalize(x) === normalize(d.value))) moods.unshift(d.value);
            return `<div class="npcb-dx" data-i="${i}">
                <div class="npcb-row">
                    <select class="text_pole npcb-dx-kind">
                        <option value="always" ${kind === 'always' ? 'selected' : ''}>Always</option>
                        <option value="mood" ${kind === 'mood' ? 'selected' : ''}>When mood is…</option>
                        <option value="situation" ${kind === 'situation' ? 'selected' : ''}>Situation…</option>
                    </select>
                    ${kind === 'mood' ? `<select class="text_pole npcb-dx-value">${moods.map(m => `<option value="${esc(m)}" ${normalize(m) === normalize(d.value) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
                    ${kind === 'situation' ? `<input class="text_pole npcb-dx-value" value="${esc(d.value || '')}" placeholder="e.g. talking to nobles, in combat">` : ''}
                    <span class="npcb-spacer"></span>
                    <div class="menu_button npcb-dx-del" title="Delete example"><i class="fa-solid fa-trash-can"></i></div>
                </div>
                <textarea class="text_pole npcb-dx-text" rows="2" placeholder='e.g. "You speak as though you have a choice." *He leans forward.*'>${esc(d.text || '')}</textarea>
            </div>`;
        }).join('')}
        <div class="menu_button npcb-dx-add"><i class="fa-solid fa-plus"></i> Add example</div>`);
    };
    const at = (el) => list[Number($(el).closest('.npcb-dx').data('i'))];
    host.off('.dx');
    host.on('click.dx', '.npcb-dx-add', () => { list.push({ kind: 'always', value: '', text: '' }); draw(); host.find('.npcb-dx-text').last().trigger('focus'); });
    host.on('click.dx', '.npcb-dx-del', (e) => { list.splice(Number($(e.target).closest('.npcb-dx').data('i')), 1); draw(); });
    host.on('change.dx', '.npcb-dx-kind', (e) => {
        const d = at(e.target);
        if (!d) return;
        d.kind = String(e.target.value);
        d.value = d.kind === 'mood' ? (states()[0] ?? '') : '';
        draw();
    });
    host.on('input.dx change.dx', '.npcb-dx-value', (e) => { const d = at(e.target); if (d) d.value = String(e.target.value); });
    host.on('input.dx', '.npcb-dx-text', (e) => { const d = at(e.target); if (d) d.text = String(e.target.value); });
    draw();
}
