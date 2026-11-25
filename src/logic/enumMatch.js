// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Loose enum matching: map free text the model wrote ("sits majestically on the throne", "furious")
// to the closest entry of a user-configurable list ("Sitting", "Angry").
//
// How it works, generically for any list:
//  1. exact (normalised) match wins;
//  2. otherwise both the value and every list entry are split into words, each word is stemmed
//     ("sits"/"sitting"/"sat" → "sit") and folded through a synonym table ("perched" → sit, "furious" → angry);
//  3. an entry scores by the share of its content words found in the value (stems, synonyms, then near-misses
//     such as typos or shared prefixes); the best score wins, ties go to the word that comes first in the value;
//  4. nothing close → the fallback.
// Words right after a negation ("not sitting", "no longer angry") are ignored.

import { normalize } from './text.js';

/** Synonym groups: the first word is the concept; any word in a group (or its stem) maps to it. */
const SYNONYM_GROUPS = [
    // postures
    ['sit', 'sat', 'sits', 'sitting', 'seat', 'seated', 'perch', 'perched', 'enthroned'],
    ['stand', 'stood', 'standing', 'upright', 'rise', 'rising', 'risen', 'arise', 'arose'],
    ['lie', 'lies', 'lying', 'lay', 'lays', 'lain', 'laid', 'sprawl', 'recline', 'prone', 'supine', 'flat'],
    ['kneel', 'knelt', 'kneeling', 'genuflect', 'knee', 'knees'],
    ['crouch', 'squat', 'hunch', 'hunker', 'cower', 'duck'],
    ['lean', 'leant', 'slouch', 'propped'],
    ['walk', 'stroll', 'pace', 'stride', 'strode', 'wander', 'march', 'saunter', 'amble', 'approach', 'step', 'stalk', 'trudge', 'limp'],
    ['run', 'ran', 'sprint', 'dash', 'rush', 'flee', 'fled', 'bolt', 'jog', 'race', 'gallop', 'hurry'],
    ['float', 'hover', 'levitate', 'fly', 'flew', 'flying', 'soar'],
    ['hang', 'hung', 'dangle', 'suspended'],
    ['climb', 'clamber'],
    ['swim', 'swam', 'swum', 'paddle'],
    ['ride', 'rode', 'ridden', 'mounted', 'horseback'],
    ['bow', 'bowed', 'bowing', 'curtsy', 'curtsey'],
    ['hide', 'hid', 'hidden', 'conceal', 'concealed', 'lurk'],
    ['fight', 'fought', 'combat', 'brawl', 'spar', 'duel'],
    ['dance', 'twirl'],
    // states
    ['calm', 'composed', 'serene', 'relaxed', 'peaceful', 'tranquil', 'collected', 'placid', 'unbothered', 'neutral', 'content'],
    ['happy', 'glad', 'joyful', 'joy', 'cheerful', 'delighted', 'pleased', 'elated', 'smile', 'smiling', 'grin', 'beaming', 'jovial', 'merry'],
    ['amused', 'amuse', 'laugh', 'laughing', 'chuckle', 'giggle', 'entertained', 'smirk', 'playful', 'teasing', 'mischievous'],
    ['excited', 'excite', 'thrilled', 'eager', 'enthusiastic', 'giddy', 'exhilarated', 'energetic'],
    ['curious', 'intrigued', 'interested', 'inquisitive', 'fascinated', 'puzzled', 'wondering'],
    ['suspicious', 'suspect', 'wary', 'distrustful', 'distrust', 'skeptical', 'sceptical', 'guarded', 'doubtful', 'leery', 'cautious'],
    ['determined', 'resolute', 'resolved', 'focused', 'steadfast', 'driven', 'unwavering'],
    ['stern', 'serious', 'severe', 'strict', 'grim', 'cold', 'icy', 'frosty', 'haughty', 'commanding'],
    ['annoyed', 'annoy', 'irritated', 'irked', 'exasperated', 'frustrated', 'impatient', 'peeved', 'vexed', 'grumpy', 'sulky'],
    ['angry', 'anger', 'furious', 'fury', 'rage', 'raging', 'enraged', 'irate', 'livid', 'mad', 'wrathful', 'wrath', 'seething', 'outraged', 'incensed', 'hostile', 'fuming'],
    ['nervous', 'anxious', 'anxiety', 'uneasy', 'tense', 'jittery', 'worried', 'worry', 'apprehensive', 'fidgety', 'fidget', 'restless', 'unsettled'],
    ['embarrassed', 'embarrass', 'flustered', 'ashamed', 'sheepish', 'blush', 'blushing', 'mortified', 'shy', 'bashful', 'humiliated'],
    ['afraid', 'scared', 'fear', 'fearful', 'frightened', 'terrified', 'terror', 'panic', 'panicked', 'horrified', 'petrified', 'spooked', 'alarmed'],
    ['sad', 'sorrow', 'sorrowful', 'unhappy', 'melancholy', 'grief', 'grieving', 'depressed', 'gloomy', 'mournful', 'crying', 'cry', 'weep', 'weeping', 'tearful', 'downcast', 'dejected', 'heartbroken', 'miserable'],
    ['tired', 'exhausted', 'weary', 'fatigued', 'sleepy', 'drowsy', 'drained', 'spent', 'lethargic'],
    ['injured', 'injury', 'hurt', 'wounded', 'wound', 'bleeding', 'bruised', 'battered', 'harmed', 'bloodied'],
    ['asleep', 'sleep', 'sleeping', 'slept', 'dozing', 'doze', 'napping', 'nap', 'slumber', 'slumbering'],
    ['unconscious', 'fainted', 'faint', 'comatose', 'senseless', 'knockedout', 'passedout', 'outcold'],
    ['aroused', 'horny', 'lustful', 'flirty', 'flirtatious', 'seductive', 'sultry'],
    ['confused', 'bewildered', 'perplexed', 'baffled', 'disoriented'],
    ['surprised', 'shocked', 'startled', 'astonished', 'stunned', 'amazed'],
    ['bored', 'uninterested', 'indifferent', 'apathetic'],
    ['proud', 'smug', 'triumphant', 'confident', 'arrogant', 'cocky'],
    ['drunk', 'tipsy', 'intoxicated', 'inebriated'],
    ['sick', 'ill', 'nauseous', 'feverish', 'unwell', 'poisoned'],
    ['loving', 'affectionate', 'tender', 'adoring', 'fond'],
    ['dead', 'deceased', 'lifeless', 'slain', 'killed'],
];

/** Multi-word phrases folded into one token before splitting. */
const PHRASES = [
    [/\bno longer\b/g, 'not'],
    [/\b(?:is|are|was|were|does|do|did)n t\b/g, 'not'],
    [/\b(?:knocked|passed|blacked) out\b/g, 'knockedout'],
    [/\bout cold\b/g, 'outcold'],
    [/\bon (?:his|her|their|its|my|your) (?:back|side|stomach|belly|front)\b/g, 'lie'],
    [/\bon (?:his|her|their|its|my|your|one|both) knees?\b/g, 'kneel'],
    [/\bon all fours\b/g, 'crouch'],
    [/\bfell asleep\b/g, 'asleep'],
];

/** Words that carry no meaning for matching (on either side). */
const STOP = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'upon',
    'up', 'down', 'out', 'over', 'off', 'about', 'against', 'near', 'beside', 'behind', 'under', 'around', 'across', 'through',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had', 'very', 'quite', 'slightly', 'somewhat',
    'bit', 'little', 'rather', 'still', 'now', 'just', 'again', 'then', 'while', 'as', 'he', 'she', 'they', 'it', 'his', 'her',
    'their', 'its', 'him', 'them', 'my', 'your', 'i', 'you', 'we', 'this', 'that', 'there', 'here', 'feeling', 'feels', 'looks',
    'looking', 'seems', 'appears', 'somewhat', 'mostly', 'fully', 'completely', 'totally', 'extremely', 'really', 'so',
]);
const NEGATIONS = new Set(['not', 'no', 'never', 'nor', 'without', 'stop', 'stops', 'stopped', 'stopping', 'quit', 'quits', 'cease', 'ceases']);

/** A small English stemmer: good enough to make "sits", "sitting", "seated" and "Sitting" agree. */
export function stem(word) {
    let w = String(word || '');
    if (w.length <= 3) return w;
    if (/ies$|ied$/.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
    else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
    else if (/ly$/.test(w) && w.length > 5) w = w.slice(0, -2);
    else if (/(?:ch|sh|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
    else if (/[^su]s$/.test(w)) w = w.slice(0, -1);
    if (/([bdgkmnprt])\1$/.test(w)) w = w.slice(0, -1); // sitt → sit, runn → run
    if (/[^aeiou]e$/.test(w) && w.length > 3) w = w.slice(0, -1); // smile/smiling → smil
    return w;
}

const SYN = new Map();
for (const group of SYNONYM_GROUPS) {
    const concept = group[0];
    for (const word of group) {
        if (!SYN.has(word)) SYN.set(word, concept);
        const s = stem(word);
        if (!SYN.has(s)) SYN.set(s, concept);
    }
}

/** The concept a single word stands for: its synonym group, else its stem. */
export function concept(word) {
    return SYN.get(word) ?? SYN.get(stem(word)) ?? stem(word);
}

/** Text → [{ c: concept, s: stem, i: position }] with stop words and negated words removed. */
function tokens(text) {
    let t = normalize(text).replace(/[_-]+/g, ' ');
    for (const [re, rep] of PHRASES) t = t.replace(re, rep);
    const out = [];
    let negate = 0;
    t.split(' ').forEach((w, i) => {
        if (!w) return;
        if (NEGATIONS.has(w)) { negate = 2; return; }
        if (STOP.has(w)) { if (negate) negate--; return; }
        if (negate) { negate = 0; return; }
        out.push({ c: concept(w), s: stem(w), w, i });
    });
    return out;
}

function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            best = Math.min(best, cur[j]);
        }
        if (best > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

/** How well a value word matches an entry word: 1 same concept, 0.8 near miss (typo / shared prefix), 0 none. */
function wordScore(v, e) {
    if (v.c === e.c || v.s === e.s) return 1;
    const a = v.s, b = e.s;
    const short = a.length <= b.length ? a : b, long = short === a ? b : a;
    if (short.length >= 5 && long.startsWith(short)) return 0.8;
    for (const [x, y] of [[a, b], [v.w, e.w]]) { // typos: compare stems, then the words as written
        const n = Math.min(x.length, y.length);
        if (n < 5) continue;
        const max = n >= 8 ? 2 : 1;
        if (editDistance(x, y, max) <= max) return 0.8;
    }
    return 0;
}

/**
 * Pick the list entry closest to a free-text value.
 * @param {*} value what the model (or user) wrote, e.g. "sits majestically on the throne"
 * @param {string[]} list allowed values, e.g. ['Standing', 'Sitting', 'Lying down']
 * @param {*} fallback returned when the value is empty or nothing is reasonably close
 * @returns the matching list entry (as written in the list) or the fallback
 */
export function closestEnum(value, list, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const entries = (list || []).filter(x => String(x ?? '').trim());
    if (!entries.length) return fallback;
    const v = normalize(value);
    const exact = entries.find(x => normalize(x) === v);
    if (exact !== undefined) return exact;

    const vt = tokens(value);
    if (!vt.length) return fallback;
    let best = null;
    entries.forEach((entry, order) => {
        let et = tokens(entry);
        if (!et.length) et = normalize(entry).split(' ').filter(Boolean).map((w, i) => ({ c: concept(w), s: stem(w), w, i }));
        if (!et.length) return;
        let total = 0;
        let first = Infinity;
        for (const e of et) {
            let top = 0, pos = Infinity;
            for (const t of vt) {
                const sc = wordScore(t, e);
                if (sc > top || (sc === top && sc > 0 && t.i < pos)) { top = sc; pos = t.i; }
            }
            total += top;
            if (top > 0) first = Math.min(first, pos);
        }
        const score = total / et.length;
        if (score <= 0) return;
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && (first < best.first || (first === best.first && order < best.order)))) {
            best = { entry, score, first, order };
        }
    });
    return best && best.score >= 0.5 ? best.entry : fallback;
}
