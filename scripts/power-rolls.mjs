import {isFlagSuppressed} from "./default-flags.mjs";
import {documentFlags} from "./flags.mjs";
import {makeContext, setRollContext} from "./roll-context.mjs";
import {emptyPredicate, normalizeFlags, numericChange, testPredicate} from "./rules.mjs";
import {MODULE_ID} from "./constants.mjs";

export function powerRollModifier(actor, item, flag, value) {
  if (isFlagSuppressed(actor, flag)) return 0;
  const context = makeContext(actor, item, [flag], {kind: "trait"});
  const target = game.user.targets.first()?.document;
  context.target = normalizeFlags([...documentFlags(target?.actor), ...documentFlags(target)]);
  const priority = {multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50};
  const rules = context.attackerRules.filter(rule => rule.selector === `power-roll:${flag}`)
    .sort((a, b) => (a.priority ?? priority[a.type] ?? 20) - (b.priority ?? priority[b.type] ?? 20));
  for (const rule of rules) {
    if (testPredicate(rule.predicate ?? emptyPredicate(), {...context, actor: rule.ownerFlags})) {
      value = numericChange(value, rule.type ?? "add", rule.value);
    }
  }
  return value;
}

export function setPowerPreparation(roll, active) {
  const context = roll.terms[0]?.options?.[MODULE_ID];
  if (!context) return;
  const flags = context.roll.filter(flag => flag !== "power-preparation");
  if (active) flags.push("power-preparation");
  setRollContext(roll, {...context, roll: normalizeFlags(flags)});
}
