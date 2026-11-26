// ─────────────────────────────────────────────────────────────────────────────
// Example 8: a field that depends on another field ("primary-hormone")
//
// Adds "Primary hormone" to the Identity section, right after gender. You
// never type it: it is worked out from gender. Needs NPC Book API 13.
//
//   gender male    →  testosterone
//   gender female  →  estrogen
//   anything else  →  N/A   (an empty gender too)
//
// NPC Book does the rest by itself:
//   • the card editor shows it as a read-only box that changes as you type
//     the gender
//   • the AI sees it in {{npcScene}}:  <identity gender="female" primary-hormone="estrogen" .../>
//   • the AI is not asked for it and can't overwrite it
//
// To try it: copy this folder to SillyTavern/data/<your-user>/extensions/
// and reload SillyTavern. Open NPC Book, pick a card, change the gender.
// ─────────────────────────────────────────────────────────────────────────────

function register(api) {
    api.registerExtension({
        id: 'ex8_hormone',
        label: 'Primary hormone',

        fields: [{
            name: 'Primary hormone',
            prompt: 'primary-hormone',
            place: 'identity',
            after: 'gender',

            // ── The dependency ───────────────────────────────────────────────
            // dependsOn: the field this one is worked out from. An Identity key
            // ('gender'), a profile field ('pronouns'), 'name', or another
            // extension field's prompt name.
            dependsOn: 'gender',

            // derive: what the result is for each value of `dependsOn`.
            // Keys are words in that value ("young woman" contains "woman"),
            // '|' separates alternatives, '*' is everything else.
            derive: {
                'male|man|boy': 'testosterone',
                'female|woman|girl': 'estrogen',
                '*': 'N/A',
            },
            // derive can also be a function, for anything a map can't say:
            // derive: (gender, card) => (gender === 'male' ? 'testosterone' : 'N/A'),
        }],
    });
}

// Boilerplate, copy as-is into every extension: NPC Book may load before or
// after you, so either use it now or wait for its "ready" event.
if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Reading it from another extension: the value is worked out, not stored, so
// read it with  api.getFieldValue('mira', 'primary-hormone')  (this chat's
// copy) or add { scope: 'template' } for the library card.
// ─────────────────────────────────────────────────────────────────────────────
