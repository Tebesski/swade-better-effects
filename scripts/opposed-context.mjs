import {normalizeFlags} from "./rules.mjs";

export function withOpposition(context, opposition) {
  if (!opposition) return context;
  return {...context, rollKinds: normalizeFlags([...context.roll, "opposed"]),
    roll: normalizeFlags([...context.roll, ...opposition.flags, "opposed"]), opposed: normalizeFlags(opposition.flags),
    targetUuids: opposition.tokenUuid ? [opposition.tokenUuid] : [], opposition: structuredClone(opposition)};
}

export function opposedResult(total, targetNumber, criticalFailure = false) {
  if (!Number.isFinite(total) || !Number.isFinite(targetNumber)) throw new Error("Opposed rolls require a finite result and target number.");
  if (criticalFailure) return {outcome: "Critical failure", raises: 0};
  if (total < targetNumber) return {outcome: "Failure", raises: 0};
  return {outcome: "Success", raises: Math.max(0, Math.floor((total - targetNumber) / 4))};
}
