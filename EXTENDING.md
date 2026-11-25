# Extending NPC Book

NPC Book can be extended by other SillyTavern extensions ("sister extensions"). A sister extension can add its own data to every character (NPCs and your persona), its own editor tabs, its own lines in the prompt, read what the AI writes about each character, and change what NPC Book sends or reads. You never need to fork NPC Book to add a field.

Typical uses:

- **Stat sheets** for a game system (Ironsworn, D&D, GURPS®, your own).
- **One extra tracked field**, such as occupation, faction, hunger or reputation.
- **Prompt tweaks**, such as rewriting the scene text or adding your own `[[PLACEHOLDERS]]` to the tracking prompt.

NPC Book's own **Wardrobe** and **Relationships** features are sister extensions built only on this API (`NPCBook-Wardrobe`, `NPCBook-Relationships`), so they are full-size, real examples. Two small, commented examples are in [`examples/`](examples/):

| Example | Shows |
|---|---|
| [`examples/occupation`](examples/occupation/index.js) | One tracked text field, in about 60 lines: editor tab, prompt line, placeholder, reading the AI's entries, scene XML. |
| [`examples/simple-stats`](examples/simple-stats/index.js) | A stat sheet: HP that the AI changes during play (rolls back with swipes), stats and notes, a scene-bar button, writing data with `setExtData`. |

To try one, copy its folder to `SillyTavern/data/<your-user>/extensions/` and reload SillyTavern.

---

## 1. Getting started

A sister extension is an ordinary SillyTavern extension: a folder with a `manifest.json` and a JS file. NPC Book exposes its API on `window.NPCBook` and fires `npcbook:ready` when that is set. Extensions can load in any order, so handle both cases:

```js
function register(api) {
    api.registerExtension({
        id: 'my_ext',                 // unique; also the key your data is stored under
        label: 'My extension',
        defaultData: () => ({ value: '' }),
        cardTab: {
            label: 'My tab',
            render(host, { data }) {  // host is a jQuery element; data is a draft NPC Book saves on Save
                host.html(`<input class="text_pole" value="${api.util.esc(data.value)}">`);
                host.find('input').on('input', e => { data.value = e.target.value; });
            },
        },
        sceneXml: ({ data }) => (data?.value ? `<my_ext>${api.util.xt(data.value)}</my_ext>` : ''),
    });
}

if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', e => register(e.detail), { once: true });
```

Check `api.apiVersion` (currently **10**) if you rely on something newer than the version that introduced it (listed in section 9).

---

## 2. Where your data lives

Every character carries an `ext` object, and your data is `ext[<your id>]`. It can be any JSON-serialisable value (an object is usual). There are four places it can live:

| Scope | What it is | Saved in | Written by |
|---|---|---|---|
| `template` | The NPC Library card, the blueprint for new chats. | Extension settings | Card tab Save, `fromTracker`, `setExtData(…, {scope:'template'})` |
| `instance` | This chat's own copy of an NPC. It is copied from the card the first time the chat meets the NPC, then changes on its own. | The chat, per message, so **it rolls back on swipe or delete** | Instance sheet Save, `onTrackerEntry`, `setExtData(…)` |
| `persona` | Your persona's sheet, shared by all chats. | Extension settings | Persona sheet Save, `setExtData(…, {scope:'persona'})` |
| `user` | This chat's copy of the persona data. It only exists once something writes it. | The chat, per message (rolls back) | `onTrackerEntry` for the user entry, `setExtData(…, {scope:'user'})` |

Rules of thumb:

- Inside a chat, an NPC's data **always** comes from its instance. Editing the library card afterwards does not change chats that already met that NPC.
- For the user, the prompt uses the chat copy when there is one, and the persona sheet otherwise. Once your extension writes a chat copy, later edits to the persona sheet won't show in that chat until you write the chat copy again.
- `defaultData()` is used when a character has no data for your extension yet (editors and sheets).

---

## 3. Registration contract

`NPCBook.registerExtension(def)`. Only `id` is required. Registering the same `id` again replaces the earlier definition, and `NPCBook.unregisterExtension(id)` removes it (stored data is kept).

Every hook is called inside a try/catch. A hook that throws is logged to the console and skipped, so it never breaks NPC Book or other extensions.

### Identity

| Member | Type | Notes |
|---|---|---|
| `id` | string | Required. Also the key in `ext`. Use something unique and stable, such as `ironsworn`. |
| `label` | string | Display name, used as a fallback for tab and button labels. |
| `defaultData()` | `() → data` | Starting data for a character that has none. |

### UI

| Member | Called | Arguments |
|---|---|---|
| `cardTab: { label, icon?, render(host, ctx), onSave?(info) }` | When an NPC card opens in the library (as a tab), and when the sheet is opened from a character in the scene bar (as a popup, chat copy only). | `host`: a jQuery element to fill. `ctx`: `{ data, template, isNew, kind: 'char', id, scope }` (`scope` is `'template'` or `'instance'`; for an instance, `template` is the instance). `data` is a mutable draft, saved when the user presses Save. `onSave({ id, scope, data })` runs after NPC Book stored it, e.g. to update other characters. |
| `chatTab: true` or `{ label?, icon?, wide?, render? }` | Needs `cardTab`. Shows your sheet as a **tab** in a chat NPC's scene-bar popover (next to State and Outfit) instead of a separate sheet button. | `render` defaults to `cardTab.render`, with the same `ctx` (`scope: 'instance'`). `data` is a draft saved by the popover's Save, then `cardTab.onSave({ id, scope: 'instance', data })` runs. `wide: true` widens the popover while your tab is open. `label` defaults to `cardTab.label`. If your `outfitCatalog` has an `editLabel`, its button on the Outfit tab switches to your tab. |
| `personaSheet: { label, icon?, render(host, ctx), onSave?(info) }` | As a tab in the persona window (Persona Management → NPC Book), and as a button in your own scene-bar popover. | `ctx`: `{ data, kind: 'user', name, id: 'user', scope: 'persona', subject }` (`subject` is the stored persona data). Saved to the `persona` scope. |
| `sheetLabel` | string | Label of the sheet button in an NPC's scene-bar popover (only when there is no `chatTab`). Default: `"<cardTab.label> sheet"`. |
| `sceneSide(instance)` | Each time the scene bar is drawn, for every character in the scene (API 10). | Return `'enemy'` to show them on the right of the scene bar (after a divider), `'friendly'` for the left, or `undefined` to leave it to others. Without an answer, an instance whose card has `enemy: true` (or `kind: 'enemy'`) is an enemy. The bar only splits while an enemy is present. |
| `sceneButton: { icon, title, active?, onClick(anchorEl) }` | An icon in the scene bar head. | `icon` and `title` are strings or functions returning them (`icon` is a Font Awesome class, such as `'fa-dice-d20'`). `active() === false` dims it. Call `NPCBook.refreshScene()` after changing what it shows. |

Icons default to `fa-table-list` (sheets) and `fa-puzzle-piece` (scene buttons).

### Window header and extension libraries (API 9)

| Member | Called | Arguments / return |
|---|---|---|
| `modalButton: { icon, title, label?, active?, onClick(anchorEl) }` (or an array of them) | A button in the NPC Book window header (`.npcb-modal-head`, before Import / Export / Close). | `icon` (Font Awesome class), `title` and `label` are strings or functions returning them. `active() === false` dims it. Call `NPCBook.refreshModalButtons()` after changing them. |
| `templateLibrary: { label, getAll(), claim?(entry, template), add?(template, entry), open?(id) }` | Your own store of cards next to the NPC Library (for example a Bestiary of enemies). | `getAll()` returns `{ [id]: card }` with NPC Book's card shape. NPC Book then treats those ids as taken (ids are unique across the NPC Library and every extension library), finds those cards by id or name (`<npc id="…">` speaker blocks, tracker matching, greetings, `addToScene`), and copies them into chats like NPC cards. When the tracker creates a NEW character, the first library whose `claim(entry, template)` returns true gets it through `add(template, entry)` instead of the NPC Library (your other `fromTracker` data is already on `template.ext`). `open(id)` is used by the chat popover's **Card** button for your cards. |

### Prompt: what the AI is told

| Member | Called | Arguments / return |
|---|---|---|
| `instructions({ autoCreate })` | Each time the tracking prompt (`{{npcInstructions}}`) is built. | Return text to add to the tracking rules (where `[[OUTFIT_RULES]]` sits), or `''`. |
| `placeholders: { KEY: () → string }` | Same. | Fills `[[KEY]]` anywhere in the tracking prompt, including a prompt the user edited and your own `instructions` text. Built-in placeholders are filled first and can't be overridden. |
| `sceneXml(subject)` | For each character in `{{npcScene}}`, only when that character has data for your extension (always, with `sceneXmlAlways: true`). | `subject`: `{ kind: 'char' \| 'user', name, id?, template?, instance?, data, scene, sceneIds }`. For NPCs, `template` and `instance` are the chat instance. For the user, `subject` is the persona data and `user` this chat's user state. `scene` is the scene being described (`{ instances, active }`), `sceneIds` its active ids. Return an XML snippet (or `''`). Escape with `util.xa` (attributes) and `util.xt` (text). |
| `transformInstructions(text, { autoCreate })` | After the whole tracking prompt is built. | Return the new text, or `undefined` to leave it. Extensions run in registration order, each seeing the previous result. |
| `transformScene(text, { roster })` | After the whole scene text is built (only when it isn't empty). | Same as above. |

### Tracking: what the AI writes

After each reply, NPC Book reads the `<npcs>` JSON block the AI wrote. Each entry is one character, with `id`/`name` plus whatever changed. Your `instructions` tell the AI which extra keys to write, and these hooks read them.

| Member | Called | Arguments / return |
|---|---|---|
| `transformEntry(entry, { source, messageIndex })` | First, for every entry, before NPC Book reads it. `source` is `'tracker'` (a reply's `<npcs>` block) or `'greeting'` (a greeting's `characters` block). | Return a new entry object to replace it, `undefined` to keep it, or `null` to drop it. Use this to rename keys, fix common AI mistakes, or move your data into NPC Book's fields. |
| `fromTracker(entry, template)` | When the tracker creates a **new** NPC (before its first chat instance is copied). | Return starting data for the new card, or a falsy value for none. |
| `onTrackerEntry(info)` | For **every** applied entry: NPCs that are new, returning or already present, and the user's entry. Also for each greeting cast entry. Not called for entries that say a character left. | `info`: `{ kind: 'char' \| 'user', source, id, name, entry, data, isNew, instance?, scene?, user? }` (`scene`: the scene being built, for a tracker entry; `user`: the chat's user state, for the user's entry). `data` is a **copy** of the character's current chat data (or `null`). For the user, it falls back to the persona sheet. Return the new data, or `undefined` for no change. The result is stored on the chat (`instance` / `user` scope), so it rolls back with swipes. Treat `instance` as read-only. |
| `entryKeys: [string]` | Greeting cast blocks. | Keys your extension owns (such as `['occupation']`). NPC Book won't warn "unknown field" about them. |

| `onInstanceCreate({ instance, template, data })` | When a chat first meets an NPC and copies its card into a chat instance. | `data` is a copy of your data on the new instance (copied from the card), or `null`. Return the instance's data (e.g. remember where values started), or `undefined` to keep it. |

Order for one reply: `transformEntry`, then NPC Book applies its own fields (including clothing, see below), then `fromTracker` for new NPCs, then `onTrackerEntry`.

### Clothing: the paperdoll and `outfitCatalog`

NPC Book tracks what everyone wears, per slot (head, upper outer, feet…), in a paperdoll. Out of the box anyone can wear anything: the user types items into a slot, and the AI names them (`"outfit": {"wear": ["Blue jeans"]}`, or a slot map `{"lower_outer": "Blue jeans"}`). Worn items are self-contained: `{ id, name, slots, condition, note? }`.

An extension can offer known items and limit what can be worn:

| Member | Called | Arguments / return |
|---|---|---|
| `outfitCatalog(ctx)` | Each time a paperdoll opens a slot, and for every outfit change the AI or a greeting makes. | `ctx`: `{ source: 'editor' \| 'tracker' \| 'greeting', kind: 'char' \| 'user', id, subject, ext }`. `ext` is the character's ext data (in editors, the unsaved draft, so your own tab's edits show at once). Return `{ items, strict?, editLabel?, editIcon?, onEdit? }` or `undefined`. `items` are offered per slot and matched first. With `strict`, anything else is refused (the paperdoll hides its free "Put on something" field, and the AI's unknown items are ignored). `editLabel` adds a button under the paperdoll that opens your sheet for that character (or calls `onEdit`). |

The Wardrobe extension is the full example: its catalog is the character's wardrobe, strict while "Only wear what is in the wardrobe" is on, and its `onTrackerEntry` adds new clothing from the story to the wardrobe.

---

## 4. API reference (`window.NPCBook`)

| Member | Description |
|---|---|
| `apiVersion` / `version` | `10`. |
| `registerExtension(def)` / `unregisterExtension(id)` | See section 3. |
| `getScene()` | `{ roster: [{ id, name, instance, template }], userName }`: who is in the scene now (`template` equals `instance`; it is kept for older extensions). |
| `getRosterAt(messageIndex)` | Who was in the scene at a chat message. |
| `getInstance(ref)` | This chat's instance of an NPC (by id or name), active or not, or `null`. |
| `resolveNpc(ref)` | Id for an id or name (such as an `<npc id="…">` the AI wrote): the chat's instances first, then the library. |
| `getLibrary()` / `getTemplate(id)` | The NPC Library / one card. |
| `getUser()` | This chat's user state (`posture`, `outfit`, and `ext` once written), or `null`. |
| `getChatScene()` / `getPromptScene()` | The open chat's scene `{ instances, active }` as stored now / as the next prompt describes it (read only). |
| `getSettings()` | NPC Book's settings (read only): `postures`, `states`, `conditions`, `trackOutfits`, `traitKeys`, … |
| `openSheet(ref, extId, { scope })` | Open an extension's sheet for a character in a popup (`'instance'`, `'template'` or `'persona'`). |
| `getPersonaData(extId)` | Your persona-sheet data. |
| `getExtData(ref, extId, { scope })` | A copy of the data for one character. `scope`: `'instance'` (default), `'template'`, `'persona'`, `'user'`. For `persona`/`user`, `ref` is ignored. |
| `setExtData(ref, extId, data, { scope })` | Write and save the data, then refresh the scene bar and prompts. Returns `true` when written. The `instance` and `user` scopes write to the latest message, like a manual edit. |
| `refreshScene()` | Redraw the scene bar and refresh the prompts. |
| `refreshPrompts()` | Refresh the injected prompts only. |
| `openPersonaCharacter(tab?)` | Open the persona window (`'wardrobe'` or `'ext:<id>'`). |
| `saveSettings()` | Save extension settings, after you change a template or persona object directly. |
| `getAnyTemplate(id)` / `getAllTemplates()` | A card / every card from the NPC Library and all extension libraries (API 9). |
| `isIdTaken(id)` / `uniqueTemplateId(base)` | Whether an id is used in any library / a free id made from a name (API 9). |
| `libraryOf(id)` | `'npcbook'`, the extension id whose `templateLibrary` holds the card, or `null` (API 9). |
| `addToScene(id)` / `removeFromScene(id)` | Put a card (any library) into this chat's scene / take it out (API 9). |
| `markDead(id)` | A character died: take it out of this chat's scene for good and mark its instance `dead: true`. The card and the instance are kept (API 11). The tracker does the same for an entry with `"dead": true` (or a state of dead / slain / killed), and ignores later entries for a dead character unless they say `"dead": false`. |
| `getCardTabs()` | Every registered `cardTab` as `{ id, label, icon, render, onSave, defaultData }`, so an extension library can show the same tabs as an NPC card (API 9). |
| `closeLibrary()` / `refreshModalButtons()` | Close the NPC Book window / redraw the header buttons (API 9). |
| `util` | `esc` (HTML), `xa` (XML attribute), `xt` (XML text), `normalize`, `slugify`, `indent`, `clone`, `uniqueId`, `pickEnum`, `cleanId`, `initials`, `parseJson` (lenient JSON, e.g. for LLM answers). |
| `clothing` | The clothing model: `SLOTS`, `SLOT_LABEL`, `STACKING_SLOTS`, `inferSlots`, `normalizeSlot(s)`, `findItem`, `findItemLoose`, `makeItem`, `wearItem`, `outfitBySlot`, `resolveOutfit`, `applyClothing`, `exposureSummary`. |
| `ui` | NPC Book's UI pieces, so extensions look the same: `avatarHtml`, `injectStyle`, `bindTabs`, `closePopovers`, `placePopover`, `openCard(id, tab)`, `openInstanceEditor(id, anchor)`, `personaAvatar()`. |

Objects returned by `getScene`, `getInstance`, `getLibrary` and `getTemplate` are live. Read them freely, but write through `setExtData` (or save yourself) so changes are stored correctly.

---

## 5. Events

Listen on `document`:

| Event | `detail` | When |
|---|---|---|
| `npcbook:ready` | the API object | Once, when NPC Book has started. |
| `npcbook:message` | `{ idx, swipeId, type }` | A reply is final: its tracker block was removed and the scene saved. Good for TTS, logging or follow-up actions. |

---

## 6. Recipes

**Add one tracked field (such as occupation).** Use `defaultData`, `cardTab`, `instructions` (tell the AI the key), `fromTracker` (new NPCs), `onTrackerEntry` (changes), `entryKeys` (greetings) and `sceneXml`. See `examples/occupation`.

**A game-system stat sheet.** Same as above, plus `personaSheet` for the player. Keep values the AI changes during play (HP, momentum, conditions) in `onTrackerEntry` so they roll back with swipes. See `examples/simple-stats`.

**Fix or reshape what the AI writes.** Use `transformEntry`. For example, map `"job"` to `"occupation"`, or split a combined field.

**Change the prompt without forking.** Use `placeholders` for new `[[KEYS]]` users can place, `transformInstructions` / `transformScene` for full rewrites, and `sceneXml` for per-character additions.

**Act after each reply.** Listen for `npcbook:message`, then use `getScene()` / `getExtData()`.

**Limit or suggest clothing.** Use `outfitCatalog` (see the Wardrobe extension).

**Per-chat copies that remember where they started.** Use `onInstanceCreate` (see the Relationships extension, which marks what changed in this chat).

**Link two characters.** Use `cardTab.onSave` to update the other one with `setExtData` (see the Relationships extension's "both directions").

---

## 7. Compatibility promises

- With no sister extensions registered, NPC Book behaves exactly as it does without this API.
- Existing members keep their meaning. New members are added with a higher `apiVersion`.
- A sister extension that throws is skipped and logged. It never stops NPC Book's own processing.

---

## 8. Checklist for a new sister extension

1. Pick a stable `id`. It becomes the data key and can't change later without migrating data.
2. Use the ready pattern from section 1.
3. Give `defaultData()` and make your renderers tolerate missing fields (older saved data).
4. Tell the AI exactly which keys to write (`instructions`), and claim them in `entryKeys`.
5. Escape everything you put into HTML (`util.esc`) or XML (`util.xa` / `util.xt`).
6. Set `loading_order` above 100 in your manifest (NPC Book uses 100). The ready pattern works either way.

---

## 9. Version history

| apiVersion | Added |
|---|---|
| 5 | `registerExtension` with `cardTab`, `personaSheet`, `sceneXml`, `instructions`, `fromTracker`, `sceneButton`; scene/library getters; `npcbook:message`. |
| 6 | `onTrackerEntry`, `transformEntry`, `entryKeys`, `placeholders`, `transformInstructions`, `transformScene`, `unregisterExtension`, `getExtData`, `setExtData`, `getUser`, `refreshPrompts`. `sheetLabel` and the icon options are now documented. |
| 7 | Wardrobe and Relationships moved out of NPC Book into sister extensions. Added `outfitCatalog`, `onInstanceCreate`, `cardTab`/`personaSheet` `onSave`, render `ctx.id`/`scope`/`subject`, `sceneXmlAlways`, `sceneXml` `scene`/`sceneIds`, `onTrackerEntry` `scene`/`user`, `getChatScene`, `getPromptScene`, `getSettings`, `openSheet`, `util` additions, `clothing`, `ui`. Outfits are self-contained items (any clothing). |
| 8 | `chatTab`: a `cardTab` can also be a tab in a chat NPC's popover. Wardrobe and Relationships use it. |
| 9 | `modalButton` (NPC Book window header) and `templateLibrary` (extension card stores, e.g. a Bestiary; ids unique across all libraries; new characters can be claimed by a library). API: `getAnyTemplate`, `getAllTemplates`, `isIdTaken`, `uniqueTemplateId`, `libraryOf`, `addToScene`, `removeFromScene`, `getCardTabs`, `closeLibrary`, `refreshModalButtons`. `resolveNpc` also looks in extension libraries. |
| 10 | `sceneSide` and `isEnemy(ref)`: the scene bar shows friendly characters left and enemies right, with a divider. |
| 11 | `markDead(id)`; tracker entries with `"dead": true` remove the character from the scene for good (instance kept, marked dead). |
