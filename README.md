# NPC Book (SillyTavern extension)

I found Doom Enhancement SUite, RPGCompanion, SIM Tracker (etc, etc, etc) to be far too complicated and heavy for what I really care about. Which is "multiple-NPCs" in an "separate card-format" with "LLM can add/remove from scene and keep track of their state". So here is 'yet another' state tracker, which is light-weight (visually and in use), and does just that.

To prevent LLM Hallucination drift (User is standing, hair swaying in the wind, looking majestic) we use an ENUM-based approach, dictating what it can, and can not state (Standing, sitting, etc. It get's to pick one, or user can set it), exception is inner monologe(for obvious reasons).

# Features:
- Dedicated NPC button to create NPCs (like lorebook/Character cards, but for 'characters', no longer do you have to choose a lesser of two evils).
- State tracking of Posture, Emotional state, inner thoughts, and outfit.
- Separation of Outfit(currently wearing), and Wardrobe (all outfits the NPC owns and the LLm can pick between when changing clothing).
- Separate dressed-states to give the LLm headsup about what is currently the state (naked, has underwear on, etc).
- Full configuration of the Enum states, don't like a state? Change it.
- Profile generation if a character doesn't have one already.
- Speaker Cards with (optional) portrait' and their own dialogue color.
- Set starting cast in greetings (with per-greeting overrides).

- Vibe coded because I hate making extensions.
![Character Dialogue Card](image3.png)
![NPC Book creation](image1.png)
![During chat pop-up and NPC listing](image2.png)


## Install
In SillyTavern, open **Extensions** (the stacked-cubes icon) → **Install extension**, paste this link and install:

```
https://github.com/lalzy/ST-NPC-Book
```

Or install it manually: download this repository and put the files in `SillyTavern/data/<your-user>/extensions/NPC-Book/`, then reload SillyTavern.

## Setup
1. Open **Extensions** → **NPC Book** and click **Add entries to Prompt Manager**.
2. Open your Prompt Manager. You'll find two new entries, *NPC Book — Instructions* and *NPC Book — Present NPCs*. Leave them where they are, or move them wherever you like.
3. Click the new **NPC Book** button in the top bar (next to Character Management) to start making NPCs.

Using Text Completion? There is no Prompt Manager there, so set **Mode** to *Auto inject* in the NPC Book settings instead.

## Using it

**NPC Library.** The top-bar button opens your NPCs. Each card has a name, portrait, dialogue color, wardrobe, a private description (only you see it) and details plus a profile (height, pronouns, sexuality…) that the AI is told.

**Scene bar.** Shown above the chat box: you on the left, then everyone currently in the scene. The AI adds and removes characters as the story moves. Use **+** to add someone yourself, or click a character to change their posture, mood, thoughts or outfit.

**Clothing.** NPCs and your persona each have a wardrobe, and the AI can only dress them from it. To change what someone wears, click them and open **Outfit**. Set up your own wardrobe under **Persona Management** → **Connections** → **NPC Book**.

**New characters.** When the AI introduces someone without a card, NPC Book creates one with details and a wardrobe. Characters with the same name but a different age or role are kept as separate people.

**Starting cast.** Put a `characters` block in a greeting or an alternate greeting. The block is removed from the message, and the characters are in the scene from the first message:

```json
{
  "characters": [
    {"id": "seraphina"},
    {"id": "suzie", "posture": "sitting", "feet": "black-socks"},
    {"id": "user", "posture": "lying down"}
  ]
}
```

Each character starts from their card. Any field you add overrides the card for that greeting only:

| Field | Example |
|---|---|
| `posture` | `"sitting"` |
| `mood` | `"nervous"` |
| `feelings` | `"Who is that?"` |
| `clothing` | `{"bottom-outer": "jeans", "feet": "none"}`: set or empty a slot (other slots keep the default outfit)<br>`["nothing", "pajamas (wet)"]`: undress, then put these on, with an optional condition in brackets<br>`"nothing"`: naked |

Item names are matched loosely, so `"jeans"` finds "Blue Jeans". An item that isn't in the wardrobe is added to it. Use `"id": "user"` to set your own starting posture and clothing.

**Speaker cards.** The AI wraps each character's part of a reply in an <npc> block, and each block shows as a card with their portrait on the left and their dialogue in their color (switch off under Portraits for plain text). Greetings can use the same blocks, so a card's opening message looks like the rest of the chat:

```html
The glade is quiet; morning light filters through the canopy.

<npc id="seraphina">*She looks up from the herbs.* "You're awake. How do you feel?"
She kneels by the bed and checks the bandages.</npc>

<npc id="suzie">*Suzie peeks around the doorframe.* "Is he okay?"</npc>
```

Use the character's NPC Library ID. Text outside a block is shown as normal narration. Start a new block whenever the focus moves to another character, and don't nest blocks. To change a character's portrait, click it on their NPC card: you can upload an image, pick one from the SillyTavern server, crop it, or generate one with the Image Generation extension. The portrait size is set under Extensions → NPC Book → Portraits. Characters without a portrait show their initials.

**Swipes.** Swiping or deleting a message rolls the scene back to that point.

**Settings.** Under **Extensions** → **NPC Book** you can set the postures, moods and clothing conditions the AI can choose from, edit the prompts it receives, and turn features on or off.

## Sister extensions
NPC Book can be extended by other extensions, which can add their own tabs to NPC cards and your persona, and their own information to what the AI sees. See *NPC Book — GURPS* for an example.


## Existing sister extensions:
- [Gurps Stat-sheet](https://github.com/lalzy/ST-NPCBook-Gurps)