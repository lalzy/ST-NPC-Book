// ─────────────────────────────────────────────────────────────────────────────
// Example 3: change how NPC Book looks ("Restyle")
//
// Changing the look needs no NPC Book hook at all: SillyTavern loads the
// "css" file named in manifest.json, and CSS can restyle any of NPC Book's
// elements. All the real work is in style.css, next to this file.
//
// This JS file only adds an on/off switch: a scene-bar icon that toggles the
// class `npcbx-restyle` on <body>. Every rule in style.css starts with
// `body.npcbx-restyle`, so the new look applies only while it is switched on.
// ─────────────────────────────────────────────────────────────────────────────

const EXT_ID = 'ex3_restyle';
const BODY_CLASS = 'npcbx-restyle';
const STORE_KEY = 'npcbx-restyle-on'; // remembers the switch in the browser

function register(api) {
    // Restore the last choice (on by default).
    const isOn = () => localStorage.getItem(STORE_KEY) !== '0';
    document.body.classList.toggle(BODY_CLASS, isOn());

    api.registerExtension({
        id: EXT_ID,
        label: 'Restyle',
        sceneButton: {
            icon: 'fa-palette',
            title: () => (isOn() ? 'Restyle: on (click for the normal look)' : 'Restyle: off (click for the new look)'),
            active: () => isOn(), // dims the icon while off
            onClick() {
                localStorage.setItem(STORE_KEY, isOn() ? '0' : '1');
                document.body.classList.toggle(BODY_CLASS, isOn());
                api.refreshScene(); // redraw so the icon's title / dimming update
            },
        },
    });
}

if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Good to know
// • No switch wanted? Delete this file's register() body and drop the
//   `body.npcbx-restyle` prefix in style.css. (manifest.json still needs a
//   "js" file, so keep an empty one.)
// • Finding class names: right-click a part of the scene bar → Inspect.
//   The main ones are listed at the top of style.css.
// • Class names are NPC Book's internals, not part of its versioned API, so a
//   future NPC Book update may rename one. Keep restyles small and scoped.
// ─────────────────────────────────────────────────────────────────────────────
