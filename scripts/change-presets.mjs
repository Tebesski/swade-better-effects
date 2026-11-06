export const TARGET_ROLL_PREFIX = "sbe.targetRoll.";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";
import {MAP_KEY} from "./constants.mjs";
export const globalKind = key => key.startsWith(TARGET_ROLL_PREFIX) ? key.slice(TARGET_ROLL_PREFIX.length)
  : key.startsWith("system.stats.globalMods.") ? key.slice("system.stats.globalMods.".length) : null;

export function changeGroups(context) {
  const globals = context.globalModPresets;
  const byKinds = kinds => kinds.flatMap(kind => globals.filter(p => globalKind(p.key) === kind));
  const group = (id, label, options) => ({id, label, options});
  const global = [group("traits", "Traits", byKinds(["trait", "agility", "smarts", "spirit", "strength", "vigor"])),
    group("attack", "Attack", byKinds(["attack", "targetAttack", "targetAttackRanged", "targetAttackMelee"])),
    group("gang-up", "Gang Up", byKinds(["gangUpAttack", "gangUpDefend"])),
    group("damage", "Damage", byKinds(["damage", "targetDamage"])),
    ...byKinds(["ap"]).map(p => group("ap", p.label, [p]))].filter(g => g.options.length);
  const other = [];
  const claimed = new Set();
  for (const [id, label, pattern] of [["movement", "Movement", /^system\.pace/], ["wounds", "Wounds", /^system\.wounds/],
    ["recovery", "Recovery", /(?:unShakeBonus|unStunBonus|soakBonus|bleedOut)/], ["wealth", "Wealth", /^system\.details\.wealth/]]) {
    const options = context.otherPresets.filter(p => pattern.test(p.key));
    if (options.length > 1) { other.push(group(id, label, options)); for (const p of options) claimed.add(p.key); }
  }
  for (const preset of context.otherPresets) if (!claimed.has(preset.key)) other.push(group(preset.key, preset.label, [preset]));
  const targeting = group("targeting", "Modify targeting roll", globals.map(p => ({...p, key: `${TARGET_ROLL_PREFIX}${globalKind(p.key)}`})));
  other.push(targeting);
  other.push(group("flag", "Modify flag", [{key: MODIFY_FLAG_KEY, label: "Modify flag"}]));
  other.push(group("map", "Modify MAP", [{key: MAP_KEY, label: "Modify MAP"}]));
  other.push(group("power-roll", "No Power Points", [
    {key: "sbe.powerRoll.power-preparation", label: "Power Preparation"},
    {key: "sbe.powerRoll.power-maintain", label: "Power Maintenance"}
  ]));
  return {global, other, all: [...global, ...other]};
}
