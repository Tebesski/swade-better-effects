import {normalizeFlags} from "./rules.mjs";

const outcomeFlag = flag => /^(?:success|fail|critical-failure|raise-\d+)$/.test(flag);

export function outcomeFlags({total, targetNumber = 4, criticalFailure = false}) {
  if (!Number.isFinite(total) || !Number.isFinite(targetNumber)) return [];
  if (criticalFailure) return ["critical-failure", "fail"];
  if (total < targetNumber) return ["fail"];
  const raises = Math.floor((total - targetNumber) / 4);
  return raises > 0 ? [`raise-${raises}`, "success"] : ["success"];
}

export function withRollOutcome(context, result) {
  const flags = outcomeFlags(result);
  if (!flags.length) return context;
  return {...context, roll: normalizeFlags([...(context.roll ?? []).filter(flag => !outcomeFlag(flag)), ...flags])};
}

export function criticalFailure(roll) {
  if (roll?.isCritfail === true) return true;
  // Tools sometimes serializes trait dice as a generic SwadeRoll. Apply SWADE's
  // majority-of-ones rule to its pool as well, including the Wild Die.
  const dice = roll?.terms?.[0]?.dice ?? [];
  if (!dice.length) return false;
  const wild = dice.find(die => die.constructor?.name === "WildDie" || die.denomination === "w" || die.options?.flavor === "Wild Die");
  return dice.filter(die => die.total === 1).length > dice.length / 2 && (!wild || wild.total === 1);
}
