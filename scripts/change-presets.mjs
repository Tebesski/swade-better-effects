import {t as sbsI18n} from "./i18n.mjs";
export const TARGET_ROLL_PREFIX = "sbe.targetRoll.";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";
import {ADD_ITEM_KEY, APPLICATION_KEY, DEFENSES, MAP_KEY} from "./constants.mjs";
export const globalKind = key => key.startsWith(TARGET_ROLL_PREFIX) ? key.slice(TARGET_ROLL_PREFIX.length)
  : key.startsWith("system.stats.globalMods.") ? key.slice("system.stats.globalMods.".length) : null;

export function changeGroups(context) {
  const globals = context.globalModPresets;
  const byKinds = kinds => kinds.flatMap(kind => globals.filter(p => globalKind(p.key) === kind));
  const group = (id, label, options) => ({id, label, options});
  const global = [group("traits", sbsI18n("swade-better-effects.UI.Traits_e0ab4adb01"), byKinds(["trait", "agility", "smarts", "spirit", "strength", "vigor"])),
    group("attack", sbsI18n("swade-better-effects.UI.Attack_4cd548f3cc"), byKinds(["attack", sbsI18n("swade-better-effects.UI.targetAttack_c5d6dea11e"), sbsI18n("swade-better-effects.UI.targetAttackRanged_9746a5c459"), sbsI18n("swade-better-effects.UI.targetAttackMelee_6dd7303d1e")])),
    group("gang-up", sbsI18n("swade-better-effects.UI.GangUp_1ecd1742d9"), byKinds([sbsI18n("swade-better-effects.UI.gangUpAttack_9d89bd6160"), sbsI18n("swade-better-effects.UI.gangUpDefend_d7d7ef8376")])),
    group("damage", sbsI18n("swade-better-effects.UI.Damage_0c874f581a"), byKinds(["damage", sbsI18n("swade-better-effects.UI.targetDamage_ed94a59477")])),
    ...byKinds(["ap"]).map(p => group("ap", p.label, [p]))].filter(g => g.options.length);
  const other = [];
  const claimed = new Set();
  for (const [id, label, pattern] of [["movement", sbsI18n("swade-better-effects.UI.Movement_49ba63e89a"), /^system\.pace/], ["wounds", sbsI18n("swade-better-effects.UI.Wounds_16a5581737"), /^system\.wounds/],
    ["recovery", sbsI18n("swade-better-effects.UI.Recovery_48f6a8d568"), /(?:unShakeBonus|unStunBonus|soakBonus|bleedOut)/], ["wealth", sbsI18n("swade-better-effects.UI.Wealth_35466d70b1"), /^system\.details\.wealth/]]) {
    const options = context.otherPresets.filter(p => pattern.test(p.key));
    if (options.length > 1) { other.push(group(id, label, options)); for (const p of options) claimed.add(p.key); }
  }
  for (const preset of context.otherPresets) if (!claimed.has(preset.key)) other.push(group(preset.key, preset.label, [preset]));
  const targeting = group("targeting", sbsI18n("swade-better-effects.UI.Modifytargetingroll_b0d6bac9c2"), globals.map(p => ({...p, key: `${TARGET_ROLL_PREFIX}${globalKind(p.key)}`})));
  other.push(targeting);
  const better = [
    group("power-roll", sbsI18n("swade-better-effects.UI.NoPowerPoints_fbaa49cd57"), [
      {key: "sbe.powerRoll.power-preparation", label: sbsI18n("swade-better-effects.UI.PowerPreparation_956c4a395e")},
      {key: "sbe.powerRoll.power-maintain", label: sbsI18n("swade-better-effects.UI.PowerMaintenance_d9ef080536")}
    ]),
    group("map", sbsI18n("swade-better-effects.UI.MAPmodifier_c7c1a300b8"), [{key: MAP_KEY, label: sbsI18n("swade-better-effects.UI.MAPmodifier_c7c1a300b8")}]),
    group("flag", sbsI18n("swade-better-effects.UI.FlagRules_c7616a59e0"), [{key: MODIFY_FLAG_KEY, label: sbsI18n("swade-better-effects.UI.FlagRules_c7616a59e0")}]),
    ...Object.entries(DEFENSES).map(([key, {selector, label}]) => group(selector, label, [{key, label}])),
    group("add-item", sbsI18n("swade-better-effects.UI.AddItem_054bcbbe57"), [{key: ADD_ITEM_KEY, label: sbsI18n("swade-better-effects.UI.AddItem_054bcbbe57")}]),
    group("application", sbsI18n("swade-better-effects.UI.Application_e7ad522ea3"), [{key: APPLICATION_KEY, label: sbsI18n("swade-better-effects.UI.Application_e7ad522ea3")}])
  ];
  return {global, other, better, all: [...global, ...other, ...better]};
}
