# NPC Book (SillyTavern extension)

NPC cards that are sent to the LLM only while the NPC is present in the chat. No lorebooks are used.

## Install
Unzip so the folder is `SillyTavern/data/<your-user>/extensions/NPC-Book/` (e.g. `data/default-user/extensions/NPC-Book/`), then reload SillyTavern.

## Setup
1. Extensions panel → **NPC Book** → *Add entries to Prompt Manager*. Two entries appear just above Chat History:
   - **NPC Book — Instructions** (`{{npcInstructions}}`)
   - **NPC Book — Present NPCs** (`{{npcScene}}`), which is empty when nobody is present
   Drag them where you want and edit each one to set its role, Relative or In-Chat position, and depth.
   Text Completion has no Prompt Manager. There, put the two macros in your Story String, or switch Mode to *Auto inject*, which sends a system message at the depth you set.
2. Click the top-bar button (next to Character Management) to open the NPC Library.

## Data
- **Template (library):** ID (unique and locked once saved), Name, Portrait, Description (only you see it), Details (sent to the LLM), and Identity (age / gender / role, configurable).
- **Instance (per chat):** template ID plus Current Posture, Current State and Current Feelings.

## How the LLM tracks the scene
The LLM ends each reply with `<npcs>[ ... ]</npcs>`, which lists everyone present. The extension removes that block from the visible message. Anyone not listed is removed from the scene. If the block is missing, the scene stays as it was.

## Matching
A reported NPC counts as an existing one only when:
1. its ID or Name matches exactly (case-insensitive), and
2. its reported identity data matches at least the threshold (default 50%). Each key is compared against the template's Identity fields; if a field is empty, it's searched for in Description and Details. Numbers allow ± the numeric tolerance.

If either check fails, a new card is created with a unique ID, e.g. `sophia_2`. NPCs already in the scene are matched by ID with no data check.

## Swipes
Each message stores its roster per swipe, so swiping or deleting a message restores that point's scene. Manual edits apply to the latest message, including all of its swipes.

## You (persona+)
Your card sits to the left of the NPCs in the scene bar. It tracks your current posture and outfit only; state and feelings stay yours to decide. Each persona has its own wardrobe (click your card, then Edit wardrobe). The LLM updates you through an entry with `"id": "user"`.

## Wardrobe & paperdoll
Paperdoll slots: Head, Neck, Cover, Upper (outer/inner), Hands, Waist, Lower (outer/inner), Feet (outer/inner), Other. Other can hold several items at once; every other slot holds one item.
- Each NPC card has a **Wardrobe** tab. Add items, click slot chips to choose which slots each item covers (a dress = Upper (outer) + Lower (outer)), and tick **Default** for what the NPC wears when entering a scene.
- The LLM changes clothes with `"outfit": {"wear": [...], "remove": [...], "condition": {...}}`, using **only** items from that character's wardrobe. Anything else is ignored. Putting an item on replaces whatever already occupies those slots.
- NPCs the LLM creates come with a 4–8 item wardrobe that it generates.
- Click a character, open the **Outfit** tab, then click a slot to change what's worn there or its condition.

## Dialogue colors
Each NPC card has a **Dialogue color** (#RRGGBB). While the NPC is in the scene, the prompt tells the LLM to wrap that character's spoken lines in `<font color=#RRGGBB>"..."</font>`. New cards get a free color from a palette, and NPCs the LLM creates get one automatically. Clear the field to give a character no color. The rule text is editable in settings (`[[COLOR_RULE]]`).

## Starting cast in the first message
Put a list of NPC IDs or names in a character's greeting (or an alternate greeting):

````
```json
characters[
  seraphina, sophia_housewife
]
```
````

`characters: [Seraphina, Bob]` without the code fence also works. When the chat starts, those NPCs are put in the scene wearing their default outfits, and the block is removed from the message. Each alternate greeting can have its own cast. Names that aren't in the NPC Library are reported in a warning.

## Speaker portraits
In AI messages, each paragraph with dialogue in an NPC's dialogue color gets that NPC's portrait at its start. The portrait appears only when the speaker changes. If an NPC has no portrait and the Image Generation extension is active, one is generated once. By default your LLM first fills a portrait template from the NPC's details, current outfit, posture and the latest story messages, and only its final tag line goes to the image generator. Switch to *Direct* mode to send a fixed prompt instead. The **Generate** button on the card makes a new portrait at any time.

## Portrait tools
Click the portrait on a card to choose:
- **From this device**
- **From the server**: SillyTavern's image gallery folders, character avatars and persona avatars
- **Crop current**
- **Generate**
- **Remove**

After you pick an image, a square crop opens (it works with mouse or touch). Choose *Use full image* to skip cropping.

Generated portraits are always framed as portraits: a portrait prefix goes first, close-up tags are removed, and a negative prompt against cropped faces is added. All three are editable in settings. The LLM gets the NPC's identity (race, age, gender, role), Details, Notes (Description) and the outfit worn right now. That is the **Starting outfit** in the library, or the current outfit during a story.
