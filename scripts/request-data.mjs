import {t as sbsI18n} from "./i18n.mjs";
import {normalizeFlags} from "./rules.mjs";

export const traitName = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();

export const lingeringRollFlags = (flags, opposed = false) => normalizeFlags([...normalizeFlags(flags), opposed ? "opposed-roll" : "shake-off"]);

export function traitRequest({trait, tn = 4, penalty = 0, modifier = 0, flags = [], kind, attribute, description}, attributes, untrainedNames = []) {
  const name = String(trait ?? "").trim();
  if (!name) throw new Error(sbsI18n("swade-better-effects.UI.EnteraskillattributeorUntrained_aaffcc3fec"));
  const targetNumber = tn === "" ? 4 : Number(tn);
  if (!Number.isFinite(targetNumber)) throw new Error(sbsI18n("swade-better-effects.UI.TNmustbeafinitenumber_48b72c3aa1"));
  const penaltyValue = Number(penalty);
  if (!Number.isSafeInteger(penaltyValue)) throw new Error(sbsI18n("swade-better-effects.UI.Penaltymustbeawholenumber_1e76cd341d"));
  const terms = {targetNumber, flags: normalizeFlags(flags)};
  if (!Number.isFinite(Number(modifier))) throw new Error(sbsI18n("swade-better-effects.UI.Modifiermustbeafinitenumber_5a8a0495ac"));
  if (Number(modifier)) terms.modifier = Number(modifier);
  if (penaltyValue) terms.penalty = -Math.abs(penaltyValue);
  if (typeof description === "string" && description.trim()) terms.description = description.trim();
  const match = attributes.find(entry => [entry.key, entry.name].some(label => traitName(label) === traitName(name)));
  if (kind === "attribute" || !kind && match) {
    if (!match) throw new Error(sbsI18n("swade-better-effects.UI.Chooseavalidattribute_3b791d7de6"));
    return {version: 1, kind: "attribute", trait: match.key, name: match.name, ...terms};
  }
  const untrained = kind === "untrained" || !kind && ["untrained", "unskilled", ...untrainedNames].some(label => traitName(label) === traitName(name));
  return {version: 1, kind: untrained ? "untrained" : "skill", trait: name, name,
    attribute: attributes.some(entry => entry.key === attribute) ? attribute : "agility", ...terms};
}

export function validateRequest(request) {
  return request?.version === 1 && ["attribute", "skill", "untrained", "formula"].includes(request.kind)
    && typeof request.trait === "string" && !!request.trait.trim() && typeof request.name === "string" && !!request.name.trim()
    && Number.isFinite(request.targetNumber) && Array.isArray(request.flags) && request.flags.every(flag => typeof flag === "string")
    && (request.kind !== "formula" || typeof request.formula === "string" && request.formula.length <= 128)
    && (request.modifier === undefined || Number.isFinite(request.modifier))
    && (request.penalty === undefined || Number.isSafeInteger(request.penalty) && request.penalty <= 0)
    && (request.description === undefined || typeof request.description === "string")
    && (request.recipients === undefined || Array.isArray(request.recipients) && request.recipients.every(id => typeof id === "string"));
}

export function mergeRequestPresets(existing, incoming) {
  const result = structuredClone(existing);
  for (const entry of incoming) {
    if (!entry?.id || !entry.name?.trim() || !validateRequest(entry.request)) throw new Error(sbsI18n("swade-better-effects.UI.Asavedrollrequestcouldnot_d67cb9c855"));
    if (!result.some(item => item.id === entry.id)) result.push(structuredClone(entry));
  }
  return result;
}
