// Avatar markup (portrait image or initials).

import { portraitUrl } from '../core/npcs.js';
import { esc, initials } from '../core/utils.js';

export function avatarHtml(t, name, cls = '') {
    const url = portraitUrl(t);
    return url
        ? `<img class="npcb-ava ${cls}" src="${esc(url)}" alt="${esc(name)}" draggable="false">`
        : `<div class="npcb-ava npcb-ava-fallback ${cls}">${esc(initials(name))}</div>`;
}
