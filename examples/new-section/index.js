// ─────────────────────────────────────────────────────────────────────────────
// Example 7: a new card section ("Biography") with three fields
//
// Adds a "Biography" section to every NPC card, next to Identity and Profile,
// with three fields in it: Goals, Likes, Fears. Needs NPC Book API 13.
//
// NPC Book does the rest by itself:
//   • the card editor shows the Biography section after Profile
//   • the AI is asked for goals / likes / fears in its tracking rules
//   • the AI sees them in {{npcScene}}:
//       <biography goals="to become a super star" likes="cats" fears="the dark"/>
//   • when the AI writes "goals": "…" for a character, it is stored
//
// To try it: copy this folder to SillyTavern/data/<your-user>/extensions/
// and reload SillyTavern. Open NPC Book and pick a card.
// ─────────────────────────────────────────────────────────────────────────────

function register(api) {
    api.registerExtension({
        // Your extension's id. Values are stored on every card under this id:
        // card.ext.ex7_biography.goals / .likes / .fears. Never change it later.
        id: 'ex7_biography',
        label: 'Biography',

        // ── The section ──────────────────────────────────────────────────────
        sections: [{
            id: 'biography',       // fields join it with place: 'biography'
            label: 'Biography',    // heading in the card editor
            after: 'profile',      // 'identity', 'profile' or another section's id
            // prompt: 'biography' // element name the AI sees (default: the id)
        }],

        // ── The fields inside it ─────────────────────────────────────────────
        fields: [
            { name: 'Goals', place: 'biography', prompt: 'goals' },
            { name: 'Likes', place: 'biography', prompt: 'likes' },
            { name: 'Fears', place: 'biography', prompt: 'fears' },
        ],
    });
}

// Boilerplate, copy as-is into every extension: NPC Book may load before or
// after you, so either use it now or wait for its "ready" event.
if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });
