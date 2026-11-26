# NPC Book example extensions

Start at 1 and go up. Each one is a single `index.js` (plus `manifest.json`), heavily commented, and adds only one or two new ideas on top of the one before it.

To try one, copy its folder to `SillyTavern/data/<your-user>/extensions/` and reload SillyTavern. They can all be installed at the same time.

| # | Folder | What it adds | New hooks used |
|---|---|---|---|
| 1 | [`01-one-field`](01-one-field/index.js) | One "Occupation" text field on NPC cards, shown to the AI. | `registerExtension`, `defaultData`, `cardTab`, `sceneXml` |
| 2 | [`02-tab-and-buttons`](02-tab-and-buttons/index.js) | A "Notes" field in every UI spot: card tab, chat tab, scene-bar icon, window-header button. | `chatTab`, `sceneButton`, `modalButton`, `cardTab.onSave`, `getScene`, `getLibrary`, `refreshScene` |
| 3 | [`03-restyle`](03-restyle/style.css) | A new look for the scene bar (round avatars, accent names), with an on/off icon. | A plain CSS file in `manifest.json`, plus `sceneButton` |
| 4 | — | Male / female split in the scene bar. | **Not possible yet, see below.** |
| 5 | — | Switching persona changes the user's clothing. | **Not possible from an extension yet, see below.** |
| 6 | [`06-key-phrases`](06-key-phrases/index.js) | "If you or the AI say X, do Y": popup, empty the scene, mark someone dead. | `npcbook:message` event, SillyTavern's `MESSAGE_SENT`, `removeFromScene`, `markDead` |

After these, the bigger examples are:

- [`occupation`](occupation/index.js): example 1, but the AI also fills in and updates the field (`instructions`, `fromTracker`, `onTrackerEntry`, `entryKeys`, `placeholders`).
- [`simple-stats`](simple-stats/index.js): a stat sheet with HP the AI changes during play, a persona sheet and `setExtData`.

## Not built: missing hooks

**4. Male / female split in the scene bar.** The scene bar can only split one way: friendly on the left, enemies on the right (`sceneSide` returns `'friendly'` or `'enemy'`). The divider shows a shield and a skull and the right side is styled red, so using it for gender would mislabel both groups and break real enemies. Reading gender itself is fine (it is the `gender` Identity key, `instance.traits.gender`). What is missing is a hook that names the groups, for example `sceneGroup(instance) → { key, label, icon }` with the bar drawing one section per group.

**5. Persona change sets the user's clothing.** Two things are missing for an extension to do this:
- There is no API to write the user's outfit. `setExtData(…, { scope: 'user' })` only writes the extension's own `ext` data; `getUser()` returns a copy. A hook such as `setUserOutfit(items)` (or `setUser(patch)`) would be needed.
- NPC Book has no persona-changed event of its own (SillyTavern's `PERSONA_CHANGED` event can be used instead, so this part is workable).

Note that NPC Book itself already does the basic version: each persona has its own starting outfit (set in Persona Management → NPC Book), and when you switch persona in a chat, the user's outfit resets to the new persona's starting outfit.

**Also, for 1:** an extension can't add a key to the card's **Identity** section, so example 1 puts its field on its own tab. To have "occupation" inside Identity, add it to NPC Book Settings → Identity keys (no code needed).
