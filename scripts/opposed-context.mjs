import {t as sbsI18n} from "./i18n.mjs";
import {normalizeFlags} from "./rules.mjs";

export function withOpposition(context, opposition) {
  if (!opposition) return context;
  return {...context, rollKinds: normalizeFlags([...context.roll, "opposed", "opposed-roll"]),
    roll: normalizeFlags([...context.roll, ...opposition.flags, "opposed", "opposed-roll"]), opposed: normalizeFlags(opposition.flags),
    targetUuids: opposition.tokenUuid ? [opposition.tokenUuid] : [], opposition: structuredClone(opposition)};
}

export function opposedResult(total, targetNumber, criticalFailure = false) {
  if (!Number.isFinite(total) || !Number.isFinite(targetNumber)) throw new Error(sbsI18n("swade-better-effects.UI.Opposedrollsrequireafiniteresult_c324de9ff1"));
  if (criticalFailure) return {outcome: sbsI18n("swade-better-effects.UI.Criticalfailure_bbdaf0a2a4"), raises: 0};
  if (total < targetNumber) return {outcome: sbsI18n("swade-better-effects.UI.Failure_7031edbcf9"), raises: 0};
  return {outcome: sbsI18n("swade-better-effects.UI.Success_c88a0b9074"), raises: Math.max(0, Math.floor((total - targetNumber) / 4))};
}
