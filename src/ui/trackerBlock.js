// Popup that shows the <npcs> block removed from a message.

import { ctx } from '../core/context.js';
import { esc } from '../core/utils.js';
import { snapOf } from '../scene/roster.js';

/** Show the <npcs> block that was removed from a message (default: the latest one that had a block). */
export async function showTrackerBlock(idx) {
    const c = ctx();
    const chat = c.chat || [];
    if (idx === undefined) {
        for (let i = chat.length - 1; i >= 0; i--) if (snapOf(chat[i])?.block) { idx = i; break; }
    }
    const b = idx === undefined ? null : snapOf(chat[idx])?.block;
    if (!b) { toastr.info('No NPC block in this chat yet (or it was written before this version).', 'NPC Book'); return; }
    const html = `<div class="npcb-blockview">
        <div><b>Message #${idx}</b> · ${esc(b.status === 'ok' ? `read ${b.entries} entr${b.entries === 1 ? 'y' : 'ies'}` : b.status === 'cut off' ? `cut off, used ${b.entries} complete entr${b.entries === 1 ? 'y' : 'ies'}` : 'could not be read')}</div>
        ${b.log?.length ? `<div class="npcb-small">${b.log.map(esc).join('<br>')}</div>` : ''}
        <pre class="npcb-pre">${esc(b.text || '(empty)')}</pre>
    </div>`;
    await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}
