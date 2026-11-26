// ─────────────────────────────────────────────────────────────────────────────
// Example 6: key phrases ("if someone says X, do Y")
//
// Watches the chat. When you or the AI write a message that contains one of
// the phrases below, it runs that rule's action. Three rules, simplest first:
//   1. "ring the bell"        → just shows a popup        (no NPC Book change)
//   2. "everyone leaves"      → empties the scene
//   3. "<Name> has died"      → marks that character dead (reads the name
//                                from the message)
//
// Add your own rule by copying one of the blocks in RULES.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [
    {
        name: 'Ring the bell',
        // A regular expression. /i = ignore upper/lower case, \b = word edge.
        pattern: /\bring the bell\b/i,
        run: () => toastr.info('Ding ding!', 'Key phrase'),
    },
    {
        name: 'Everyone leaves',
        pattern: /\beveryone leaves\b/i,
        // `api` is NPC Book's API. Take every NPC out of the scene.
        // (They stay in the chat, and can come back later.)
        run: (api) => {
            for (const r of api.getScene().roster) api.removeFromScene(r.id);
        },
    },
    {
        name: 'Someone dies',
        // ( ... ) captures part of the text: here, one capitalised word.
        pattern: /\b([A-Z][\w'-]+) has died\b/,
        // `match[1]` is what the ( ... ) captured, e.g. "Mira".
        // markDead() takes an id or a name, finds them in this chat, removes
        // them from the scene for good and marks them dead.
        run: (api, match) => {
            if (api.markDead(match[1])) toastr.warning(`${match[1]} has died.`, 'Key phrase');
        },
    },
];

// Check one message's text against every rule.
function checkMessage(api, text, who) {
    for (const rule of RULES) {
        const match = String(text || '').match(rule.pattern);
        if (!match) continue;
        console.log(`[Key phrases] ${who} triggered "${rule.name}"`);
        try { rule.run(api, match); } catch (e) { console.warn(`[Key phrases] "${rule.name}" failed`, e); }
    }
}

function register(api) {
    const chat = () => SillyTavern.getContext().chat || [];

    // ── The AI's replies ─────────────────────────────────────────────────────
    // NPC Book fires `npcbook:message` once a reply is final: its tracker
    // block is removed and the scene is saved. detail.idx = message number.
    // Changes made here belong to that reply, so a swipe rolls them back
    // (and the rules run again on the new swipe).
    document.addEventListener('npcbook:message', (e) => {
        checkMessage(api, chat()[e.detail.idx]?.mes, 'AI');
    });

    // ── Your own messages ────────────────────────────────────────────────────
    // This is SillyTavern's own event, not NPC Book's. MESSAGE_SENT fires as
    // soon as your message is in the chat, before the AI starts replying, so
    // the reply already sees the changed scene.
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.MESSAGE_SENT, (idx) => {
        checkMessage(api, chat()[idx]?.mes, 'You');
    });
}

if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Other actions a rule can take (all on `api`, see EXTENDING.md section 4):
//   api.addToScene(id)                        bring a library card into the scene
//   api.getInstance(name)                     read this chat's copy of an NPC
//   api.setExtData(name, extId, data)         change an extension's data (e.g.
//                                             lower HP from examples/simple-stats)
//   api.refreshScene()                        redraw the scene bar
// Tip: "continue" on a reply runs the AI rules again on the longer text, so
// keep actions safe to repeat (removing or killing twice does nothing more).
// ─────────────────────────────────────────────────────────────────────────────
