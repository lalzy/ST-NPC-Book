// ─────────────────────────────────────────────────────────────────────────────
// Example 1: ONE new field ("Occupation")
//
// The smallest useful NPC Book extension. It does two things:
//   1. Adds an "Occupation" tab to every NPC card, with one text box.
//   2. Tells the AI each character's occupation (inside {{npcScene}}).
//
// That's it. No tracking, no buttons, no persona. Later examples add more.
//
// To try it: copy this folder to SillyTavern/data/<your-user>/extensions/
// and reload SillyTavern. Open NPC Book, pick a card, and look for the tab.
// ─────────────────────────────────────────────────────────────────────────────

// Your extension's id. NPC Book stores your data on every character under
// this key (character.ext.ex1_occupation). Pick it once and never change it.
const EXT_ID = 'ex1_occupation';

// NPC Book hands you its API object ("api"). Everything goes through it.
function register(api) {
    api.registerExtension({
        id: EXT_ID,
        label: 'Occupation',

        // What a character's data looks like before anyone has typed anything.
        defaultData: () => ({ occupation: '' }),

        // ── Part 1: the tab on the NPC card ──────────────────────────────────
        cardTab: {
            label: 'Occupation',
            icon: 'fa-briefcase', // any Font Awesome icon name

            // NPC Book calls render() when the tab opens.
            //   host = an empty jQuery element. Put your HTML in it.
            //   data = this character's data. Change it freely: NPC Book
            //          saves it when the user presses Save.
            render(host, { data }) {
                // Always escape text you put into HTML (api.util.esc).
                host.html(`
                    <label>Occupation
                        <input class="text_pole" placeholder="e.g. baker" value="${api.util.esc(data.occupation || '')}">
                    </label>`);

                // Keep `data` in step with the text box.
                host.find('input').on('input', (e) => { data.occupation = e.target.value; });
            },
        },

        // ── Part 2: what the AI sees ─────────────────────────────────────────
        // Called for each character in the scene that has data for this
        // extension. Return a small XML snippet; it goes inside that
        // character's block in {{npcScene}}. Return '' to add nothing.
        // Always escape text you put into XML (api.util.xt).
        sceneXml: ({ data }) => (data?.occupation ? `<occupation>${api.util.xt(data.occupation)}</occupation>` : ''),
    });
}

// Boilerplate, copy as-is into every extension: NPC Book may load before or
// after you, so either use it now or wait for its "ready" event.
if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Good to know
// • A card is a blueprint. The first time a chat meets an NPC, NPC Book copies
//   the card (your data included) into that chat. Editing the card later does
//   not change chats that already met them. The same tab also opens from the
//   character in the scene bar, and there it edits the chat's copy.
// • Want the AI to fill in / update the occupation by itself? See
//   examples/occupation (instructions + onTrackerEntry + fromTracker).
// • Want it inside the card's "Identity" section instead of its own tab?
//   No code needed: add "occupation" to NPC Book Settings → Identity keys.
//   (There is no hook for an extension to add Identity keys itself.)
// ─────────────────────────────────────────────────────────────────────────────
