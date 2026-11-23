import {MODULE_ID, RESTRICT_KEY} from "./constants.mjs";
import {conditionsValid, wrapMethod} from "./effects.mjs";
import {makeContext} from "./roll-context.mjs";
import {rollTarget} from "./flags.mjs";
import {conditionFor, customChangeName, testPredicate} from "./rules.mjs";
import {restrictionMatches} from "./restriction-data.mjs";
import {withSuppressionScope} from "./flag-changes.mjs";

export function rollRestricted(actor, contextOrFactory, item) {
  if (!actor) return false;
  return withSuppressionScope(actor, () => checkRestrictions(actor, contextOrFactory, item));
}

function checkRestrictions(actor, contextOrFactory, item) {
  const effects = new Set(actor.allApplicableEffects());
  for (const effect of item?.effects ?? []) if (!effect.transfer) effects.add(effect);
  let context, names, flags;
  for (const effect of effects) {
    const changes = effect._source.system.changes;
    if (!changes.some(change => change.key === RESTRICT_KEY)) continue;
    if (!effect.active || !conditionsValid(effect)) continue;
    context ??= typeof contextOrFactory === "function" ? contextOrFactory() : contextOrFactory;
    names ??= Object.fromEntries(Object.entries(CONFIG.SWADE.attributes).map(([key, data]) => [key, game.i18n.localize(data.long)]));
    const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
    for (const [index, change] of changes.entries()) {
      if (change.key !== RESTRICT_KEY || !restrictionMatches(change.value, context, names)) continue;
      const predicate = conditionFor(change, index, conditions);
      if (predicate) {
        if (!flags) {
          let target;
          for (const uuid of context.targetUuids ?? []) {
            target = foundry.utils.fromUuidSync(uuid);
            if (target) break;
          }
          flags = {...context, actor: context.attacker, target: rollTarget(context, target).flags};
        }
        if (!testPredicate(predicate, flags)) continue;
      }
      ui.notifications.warn(game.i18n.format("swade-better-effects.UI.RollRestricted", {name: customChangeName(change, index, conditions) || effect.name}));
      return true;
    }
  }
  return false;
}

export function installRestrictions() {
  const trait = (actor, selected, _roll, _modifiers, options = {}) => {
    const skill = typeof selected === "string" ? null : selected;
    const context = _roll.options?.[MODULE_ID] ?? makeContext(actor, options.item, options.effectFlags ?? [], {kind: "trait", skill, attribute: skill?.system.attribute ?? selected});
    if (skill) context.skill.swid = skill.system.swid;
    if (rollRestricted(actor, context, options.item)) return false;
  };
  Hooks.on("swadePreRollAttribute", trait); Hooks.on("swadePreRollSkill", trait);
  wrapMethod(CONFIG.Item.documentClass.prototype, "rollDamage", function (original, options = {}) {
    if (rollRestricted(this.actor, () => makeContext(this.actor, this, options.effectFlags ?? [], {kind: "damage"}), this)) return null;
    return original(options);
  });
}
