import {normalizeFlags} from "./rules.mjs";

export const traitName = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();

export function traitRequest({trait, tn = 4, flags = [], kind, attribute}, attributes, untrainedNames = []) {
  const name = String(trait ?? "").trim();
  if (!name) throw new Error("Enter a skill, attribute, or Untrained.");
  const targetNumber = tn === "" ? 4 : Number(tn);
  if (!Number.isFinite(targetNumber)) throw new Error("TN must be a finite number.");
  const match = attributes.find(entry => [entry.key, entry.name].some(label => traitName(label) === traitName(name)));
  if (kind === "attribute" || !kind && match) {
    if (!match) throw new Error("Choose a valid attribute.");
    return {version: 1, kind: "attribute", trait: match.key, name: match.name, targetNumber, flags: normalizeFlags(flags)};
  }
  const untrained = kind === "untrained" || !kind && ["untrained", "unskilled", ...untrainedNames].some(label => traitName(label) === traitName(name));
  return {version: 1, kind: untrained ? "untrained" : "skill", trait: name, name,
    attribute: attributes.some(entry => entry.key === attribute) ? attribute : "agility", targetNumber, flags: normalizeFlags(flags)};
}

export function validateRequest(request) {
  return request?.version === 1 && ["attribute", "skill", "untrained"].includes(request.kind)
    && typeof request.trait === "string" && !!request.trait.trim() && typeof request.name === "string" && !!request.name.trim()
    && Number.isFinite(request.targetNumber) && Array.isArray(request.flags) && request.flags.every(flag => typeof flag === "string")
    && (request.recipients === undefined || Array.isArray(request.recipients) && request.recipients.every(id => typeof id === "string"));
}

export function mergeRequestPresets(existing, incoming) {
  const result = structuredClone(existing);
  for (const entry of incoming) {
    if (!entry?.id || !entry.name?.trim() || !validateRequest(entry.request)) throw new Error("A saved roll request could not be migrated.");
    if (!result.some(item => item.id === entry.id)) result.push(structuredClone(entry));
  }
  return result;
}
