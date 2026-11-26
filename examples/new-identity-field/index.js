// ─────────────────────────────────────────────────────────────────────────────
// Example 1: one new Identity field ("Occupation")
//
// Adds one field to the Identity section of every NPC card. Needs NPC Book
// API 12 (the `fields` member of registerExtension).
//
// With it, NPC Book does the rest by itself:
//   • the card editor shows an "Occupation" box in the Identity section
//   • the AI is asked for it with the other Identity keys
//   • the AI sees it in {{npcScene}}:  <identity ... occupation="baker"/>
//   • when the AI writes "occupation": "baker" for a character, it is stored
//
// To try it: copy this folder to SillyTavern/data/<your-user>/extensions/
// and reload SillyTavern. Open NPC Book and pick a card.
// ─────────────────────────────────────────────────────────────────────────────

function register(api) {
    api.registerExtension({
        // Your extension's id. The value is stored on every card under this
        // id: card.ext.ex1_occupation.occupation. Never change it later.
        id: 'ex1_occupation',
        label: 'Occupation',

        fields: [{
            name: 'Occupation',   // label in the card editor
            place: 'identity',    // 'root', 'identity' or 'profile'
            type: 'string',       // 'string' (default), 'number' or 'boolean'
            prompt: 'occupation', // name the AI sees and writes back
        }],
    });
}

// Boilerplate, copy as-is into every extension: NPC Book may load before or
// after you, so either use it now or wait for its "ready" event.
if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Other options for a field:
//   before: 'name'        sit before an existing field of that place
//   after: 'pronouns'     sit after one (no before/after = end of section)
//   placeholder: '…'      grey hint text in the empty box
//   instruction: '…'      your own line for the AI instead of the default
//   key: '…'              storage key, if it should differ from `prompt`
//
// The UI name and the prompt name can differ:
//   { name: 'Goals', place: 'profile', after: 'pronouns', prompt: 'life-goal' }
//   → the card shows "Goals"; the AI sees life-goal="to become a super star"
// ─────────────────────────────────────────────────────────────────────────────
