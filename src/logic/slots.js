// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Clothing slots: slot list, aliases and slot inference from item names.

import { normalize } from './text.js';

export const SLOTS = [
    { key: 'head', label: 'Head' },
    { key: 'hair', label: 'Hair' },
    { key: 'face', label: 'Face' },
    { key: 'glasses', label: 'Glasses' },
    { key: 'neck', label: 'Neck' },
    { key: 'piercings', label: 'Piercings' },
    { key: 'cover', label: 'Cover' },
    { key: 'upper_outer', label: 'Upper (outer)' },
    { key: 'upper_inner', label: 'Upper (inner)' },
    { key: 'hands', label: 'Hands' },
    { key: 'waist', label: 'Waist' },
    { key: 'lower_outer', label: 'Lower (outer)' },
    { key: 'lower_inner', label: 'Lower (inner)' },
    { key: 'feet_outer', label: 'Feet (outer)' },
    { key: 'feet_inner', label: 'Feet (inner)' },
    { key: 'other', label: 'Other' },
];
/** Slots that hold a list: putting something on there never takes anything else off. */
export const STACKING_SLOTS = new Set(['piercings', 'other']);
const SLOT_KEYS = new Set(SLOTS.map(s => s.key));

const SLOT_ALIASES_EXTRA = {
    cap: 'head', crown: 'head', tiara: 'head', circlet: 'head', helm: 'head', bandana: 'head', beret: 'head', headband: 'head',
    hairtie: 'hair', scrunchie: 'hair', ribbon: 'hair', hairpin: 'hair', hairclip: 'hair', barrette: 'hair', hairnet: 'hair', comb: 'hair', bow: 'hair',
    mask: 'face', veil: 'face', eyepatch: 'face', blindfold: 'face', makeup: 'face', lipstick: 'face', facepaint: 'face', muzzle: 'face', gag: 'face',
    sunglasses: 'glasses', goggles: 'glasses', monocle: 'glasses', eyeglasses: 'glasses',
    stud: 'piercings', nosering: 'piercings',
    choker: 'neck', pendant: 'neck', amulet: 'neck', neckerchief: 'neck', tie: 'neck',
    robe: 'cover', bathrobe: 'cover', poncho: 'cover', parka: 'cover', overcoat: 'cover', blazer: 'cover', cardigan: 'cover', breastplate: 'cover', cuirass: 'cover', mantle: 'cover', shawl: 'cover',
    tunic: 'upper_outer', blouse: 'upper_outer', sweater: 'upper_outer', jumper: 'upper_outer', vest: 'upper_outer', tee: 'upper_outer', tshirt: 'upper_outer', hoodie: 'upper_outer', corset: 'upper_outer', doublet: 'upper_outer', jerkin: 'upper_outer', apron: 'upper_outer', camisole: 'upper_inner', chemise: 'upper_inner', bralette: 'upper_inner', binder: 'upper_inner',
    glove: 'hands', gauntlet: 'hands', mitten: 'hands', bracer: 'hands',
    girdle: 'waist', cummerbund: 'waist',
    trouser: 'lower_outer', trousers: 'lower_outer', jean: 'lower_outer', jeans: 'lower_outer', short: 'lower_outer', shorts: 'lower_outer', legging: 'lower_outer', leggings: 'lower_outer', breeches: 'lower_outer', kilt: 'lower_outer', greaves: 'lower_outer',
    pantie: 'lower_inner', panty: 'lower_inner', knickers: 'lower_inner', boxers: 'lower_inner', boxer: 'lower_inner', thong: 'lower_inner', loincloth: 'lower_inner', undergarment: 'lower_inner', smallclothes: 'lower_inner',
    shoe: 'feet_outer', boot: 'feet_outer', sandal: 'feet_outer', slipper: 'feet_outer', heel: 'feet_outer', heels: 'feet_outer', sneaker: 'feet_outer', loafer: 'feet_outer', clog: 'feet_outer', moccasin: 'feet_outer', sabaton: 'feet_outer',
    sock: 'feet_inner', stocking: 'feet_inner', tights: 'feet_inner', pantyhose: 'feet_inner', footwrap: 'feet_inner',
    earring: 'piercings', earrings: 'piercings', piercing: 'piercings', piercings: 'piercings',
    bracelet: 'other', brooch: 'other', anklet: 'other',
};
const SLOT_ALIASES = {
    hat: 'head', helmet: 'head', hood: 'head', hair: 'hair', face: 'face', glasses: 'glasses', spectacles: 'glasses',
    collar: 'neck', scarf: 'neck', necklace: 'neck',
    cloak: 'cover', coat: 'cover', jacket: 'cover', armor: 'cover', armour: 'cover', outerwear: 'cover', cape: 'cover',
    upper: 'upper_outer', top: 'upper_outer', torso: 'upper_outer', chest: 'upper_outer', shirt: 'upper_outer', upper_outer: 'upper_outer',
    bra: 'upper_inner', undershirt: 'upper_inner', upper_inner: 'upper_inner', upper_underwear: 'upper_inner',
    gloves: 'hands', hand: 'hands',
    belt: 'waist', sash: 'waist',
    lower: 'lower_outer', bottom: 'lower_outer', legs: 'lower_outer', pants: 'lower_outer', skirt: 'lower_outer', lower_outer: 'lower_outer',
    panties: 'lower_inner', underwear: 'lower_inner', briefs: 'lower_inner', lower_inner: 'lower_inner', lower_underwear: 'lower_inner',
    feet: 'feet_outer', shoes: 'feet_outer', boots: 'feet_outer', footwear: 'feet_outer', feet_outer: 'feet_outer',
    socks: 'feet_inner', stockings: 'feet_inner', feet_inner: 'feet_inner',
    accessory: 'other', accessories: 'other', jewelry: 'other', jewellery: 'other', ring: 'other', rings: 'other', misc: 'other',
};

Object.assign(SLOT_ALIASES, SLOT_ALIASES_EXTRA);

export function normalizeSlot(s) {
    const k = normalize(s).replace(/[()]/g, '').replace(/[\s-]+/g, '_');
    if (SLOT_KEYS.has(k)) return k;
    if (SLOT_ALIASES[k]) return SLOT_ALIASES[k];
    // "upper outer", "outer upper", "feet (inner)", "bottom-outer", "top inner" etc.
    const parts = k.split('_');
    const BASES = { upper: 'upper', top: 'upper', torso: 'upper', chest: 'upper', lower: 'lower', bottom: 'lower', bottoms: 'lower', legs: 'lower', leg: 'lower', feet: 'feet', foot: 'feet', shoes: 'feet' };
    const inner = parts.some(p => ['inner', 'under', 'underwear'].includes(p));
    for (const p of parts) if (BASES[p]) return `${BASES[p]}_${inner ? 'inner' : 'outer'}`;
    return null;
}

export function normalizeSlots(list) {
    const arr = Array.isArray(list) ? list : (list ? [list] : []);
    const out = [];
    for (const s of arr) { const k = normalizeSlot(s); if (k && !out.includes(k)) out.push(k); }
    return out.length ? out : ['other'];
}

export function inferSlots(name) {
    const n = normalize(name);
    if (/\b(piercing|earrings?|ear cuff|(nose|lip|belly|navel|eyebrow|tongue|nipple|septum) (ring|stud|bar|piercing))s?\b/.test(n)) return ['piercings'];
    if (/\b(hair (tie|band|clip|pin|ribbon|ornament|stick)s?)\b/.test(n)) return ['hair'];
    for (const w of n.split(' ').reverse()) {
        const k = SLOT_ALIASES[w] || SLOT_ALIASES[w.replace(/s$/, '')];
        if (k) return [k];
    }
    if (/dress|gown|robe|jumpsuit|overall|pyjama|pajama|nightgown/.test(normalize(name))) return ['upper_outer', 'lower_outer'];
    return ['other'];
}
