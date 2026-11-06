import {normalizeFlags, selectorForKey, testPredicate} from "./rules.mjs";

export const NOTE_PREFIX = "sbe.rollNote.";
// SWADE's legacy skill-path migration strips prefixes before any literal @Skill.
export const noteChangeKey = key => `${NOTE_PREFIX}${encodeURIComponent(key)}`;
export function noteBaseKey(key) {
  if (!key.startsWith(NOTE_PREFIX)) return null;
  try { return decodeURIComponent(key.slice(NOTE_PREFIX.length)); } catch { return null; }
}

export function noteSelectorForKey(key) {
  const skill = key.match(/^@Skill\{(.+)\}\[system\.(?:die|wild-die)\.(?:sides|modifier)\]$/);
  if (skill) return `skill:${skill[1]}`;
  const attribute = key.match(/^system\.attributes\.(agility|smarts|spirit|strength|vigor)\.(?:die|wild-die)\.(?:sides|modifier)$/);
  if (attribute) return `attribute:${attribute[1]}`;
  const selector = selectorForKey(key);
  return selector && /^(?:global:|target-roll:|outgoing-damage$|incoming-damage$|ap$)/.test(selector) ? selector : null;
}

function matchesRoll(selector, context, incoming) {
  const flags = normalizeFlags(context.rollKinds ?? context.roll);
  const damage = context.rollType === "damage";
  if (["outgoing-damage", "incoming-damage", "ap"].includes(selector)) return damage && incoming === (selector === "incoming-damage");
  const [category, ...parts] = selector.split(":"), kind = parts.join(":");
  if (category === "skill") return !damage && !incoming && !!context.skill
    && (kind === context.skill.id || kind.toLocaleLowerCase() === context.skill.name?.toLocaleLowerCase());
  if (category === "attribute") return !damage && !incoming && !context.skill && kind === context.attribute;
  if (!["global", "target-roll"].includes(category)) return false;
  if (incoming !== (category === "target-roll" || kind.startsWith("target") || kind === "gangUpDefend")) return false;
  if (kind === "damage" || kind === "targetDamage" || kind === "ap") return damage;
  if (damage) return false;
  return kind === "trait" || kind === context.attribute
    || ["attack", "targetAttack"].includes(kind) && flags.includes("attack")
    || kind === "targetAttackRanged" && flags.includes("attack") && flags.includes("ranged")
    || kind === "targetAttackMelee" && flags.includes("attack") && flags.includes("melee")
    || ["gangUpAttack", "gangUpDefend"].includes(kind) && flags.includes("gang-up");
}

// Notes are resolved once for a posted roll. Rerolls retain this snapshot.
export function resolveRollNotes({context, attackerNotes = [], targets = []}) {
  const result = [], seen = new Set();
  const append = (note, incoming, target = {}) => {
    if (!note.html?.trim() || !matchesRoll(note.selector, context, incoming)) return;
    if (!testPredicate(note.predicate, {...context, target: target.flags ?? [], actor: note.ownerFlags ?? []})) return;
    const id = `${incoming ? target.uuid : "source"}:${note.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    result.push({label: note.label, html: note.html, ...(incoming ? {target: target.name} : {})});
  };
  for (const note of attackerNotes) for (const target of targets.length ? targets : [{}]) append(note, false, target);
  for (const target of targets) for (const note of target.notes ?? []) append(note, true, target);
  return result;
}
