// Message formatter hooks that turn <npc id> speaker blocks into speaker cards.

import { ctx } from '../core/context.js';
import { xa } from '../core/utils.js';

/*
 * Speaker blocks: the LLM wraps each character's part of a reply in <npc id="ID">...</npc>.
 * Through SillyTavern's message formatter each block becomes a card around the rendered Markdown:
 *   <div data-npcb-turn="ID"><div data-npcb-ava></div><div data-npcb-body>…</div></div> The tags are swapped for plain-text markers before Markdown runs (so the content inside is
 * formatted normally), and the markers are turned into the divs afterwards. The stored message keeps the tags.
 */
const TURN_OPEN_RE = /<npc\s+id\s*=\s*["']?([^"'>\s]+)["']?\s*>/gi;
const TURN_CLOSE_RE = /<\/npc\s*>/gi;
const TURN_PARTIAL_RE = /<\/?n(?:p(?:c(?:\s[^>]*)?)?)?$/i; // half-streamed tag at the very end
const toHex = (str) => Array.from(new TextEncoder().encode(str), b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new TextDecoder().decode(new Uint8Array(hex.match(/../g).map(x => parseInt(x, 16))));
const turnDiv = (hex) => `<div data-npcb-turn="${xa(fromHex(hex))}"><div data-npcb-ava></div><div data-npcb-body>`;
const TURN_END = '</div></div>';

export function registerTurnFormatter() {
    const mf = ctx().messageFormatter;
    if (!mf?.addHook) {
        console.warn('[NPC Book] this SillyTavern version has no message formatter; <npc> speaker blocks are not rendered.');
        return;
    }
    mf.addHook((mes, info) => {
        if (info.isUser || info.isReasoning) return mes;
        return mes
            .replace(TURN_PARTIAL_RE, '')
            .replace(TURN_OPEN_RE, (_, id) => `\n\nXNPCBO${toHex(id)}X\n\n`)
            .replace(TURN_CLOSE_RE, '\n\nXNPCBCX\n\n');
    }, { stage: mf.stage.BEFORE_REGEX, order: mf.order.EARLY });
    mf.addHook((html) => {
        if (!html.includes('XNPCB')) return html;
        return html
            .replace(/<p>\s*XNPCBO([0-9a-f]+)X\s*<\/p>/g, (_, h) => turnDiv(h))
            .replace(/<p>\s*XNPCBCX\s*<\/p>/g, TURN_END)
            .replace(/XNPCBO([0-9a-f]+)X/g, (_, h) => turnDiv(h))
            .replace(/XNPCBCX/g, TURN_END);
    }, { stage: mf.stage.AFTER_MARKDOWN, order: mf.order.LATE });
}
