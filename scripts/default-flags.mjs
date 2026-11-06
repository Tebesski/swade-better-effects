import {normalizeFlag, normalizeFlags} from "./rules.mjs";
import {applyFlagChanges, suppressesFlag} from "./flag-changes.mjs";

export const EQUIPMENT_FLAGS = ["stored", "carried", "equipped", "off-hand", "main-hand", "two-hands"];
export const STANDARD_FLAGS = ["attack", "damage", "trait", "opposed", "success", "fail", "critical-failure", "raise-1", "power-preparation", "power-maintain", "attribute", "skill", "power", "weapon", "melee", "ranged", "gear", "armor", "shield", "consumable", "edge", "hindrance", "ability", "ancestry", "wildcard", "extra", "agility", "smarts", "spirit", "strength", "vigor", ...EQUIPMENT_FLAGS];
const physical = new Set(["weapon", "armor", "shield", "gear", "consumable"]);
export const isGear = doc => doc?.documentName === "Item" && physical.has(doc.type);
export const customFlags = doc => normalizeFlags(doc?.getFlag?.("swade-better-effects", "tags") ?? doc?.flags?.["swade-better-effects"]?.tags ?? []);
export const excludedFlags = doc => normalizeFlags(doc?.getFlag?.("swade-better-effects", "excludedTags") ?? doc?.flags?.["swade-better-effects"]?.excludedTags ?? []);
export const flagActivation = doc => doc?.getFlag?.("swade-better-effects", "flagActivation") ?? doc?.flags?.["swade-better-effects"]?.flagActivation ?? "equipped";

export function equipmentFlags(item) {
  if (!isGear(item) || item.system.equipStatus === undefined || item.system.equipStatus === null) return [];
  const state = Number(item.system.equipStatus);
  const name = ["stored", "carried", "off-hand", "equipped", "main-hand", "two-hands"][state];
  return normalizeFlags([name]);
}

export function itemGrantsFlags(item) {
  if (!isGear(item)) return true;
  if (Number(item.system.quantity ?? 1) <= 0) return false;
  const state = Number(item.system.equipStatus ?? 0);
  return flagActivation(item) === "carried" ? state >= 1 : state > 1;
}

export function automaticFlags(doc) {
  if (doc?.documentName === "ActiveEffect") return normalizeFlags([normalizeFlag(doc.name)]);
  if (doc?.documentName === "Item") return normalizeFlags([normalizeFlag(doc.name), doc.type === "power" ? normalizeFlag(doc.system?.arcane) : "", ...equipmentFlags(doc)]);
  if (doc?.documentName !== "Actor") return [];
  return normalizeFlags([ancestryFlag(doc)]);
}

export function ancestryFlag(doc) {
  const ancestry = [...(doc.items ?? [])].find(item => item.type === "ancestry");
  return normalizeFlag(ancestry?.name ?? doc.system.details?.species?.name);
}

function flagEffects(doc) {
  if (doc?.documentName !== "Actor") return [];
  return [...(doc.allApplicableEffects?.() ?? doc.effects ?? [])].filter(effect => !isGear(effect.parent) || itemGrantsFlags(effect.parent));
}

export function isFlagSuppressed(doc, flag) { return suppressesFlag(flagEffects(doc), flag); }

function suppliedFlags(doc) {
  let flags = normalizeFlags([...automaticFlags(doc), ...customFlags(doc)]);
  if (isGear(doc)) {
    const state = equipmentFlags(doc)[0];
    flags = flags.filter(flag => !EQUIPMENT_FLAGS.includes(flag) || flag === state);
  }
  return applyFlagChanges(flags, flagEffects(doc));
}

export function effectiveFlags(doc) {
  const excluded = new Set(excludedFlags(doc));
  return suppliedFlags(doc).filter(flag => !excluded.has(flag));
}

export function flagInputData(doc, value) {
  const requested = new Set(normalizeFlags(value));
  const generated = new Set([...automaticFlags(doc), ...applyFlagChanges([], flagEffects(doc))]);
  const current = new Set(effectiveFlags(doc));
  // Preserve stored flags hidden by an effect, but respect deletions from the
  // visible list, including deletions of generated and effect-supplied flags.
  const preserved = customFlags(doc).filter(flag => !current.has(flag) || requested.has(flag) && generated.has(flag));
  let tags = normalizeFlags([...preserved, ...[...requested].filter(flag => !generated.has(flag))]);
  if (isGear(doc)) tags = tags.filter(flag => !EQUIPMENT_FLAGS.includes(flag));
  const excludedTags = normalizeFlags([...excludedFlags(doc), ...suppliedFlags(doc).filter(flag => !requested.has(flag))]).filter(flag => !requested.has(flag));
  return {tags, excludedTags};
}

export function customFlagsFromInput(doc, value) { return flagInputData(doc, value).tags; }

export function flagsAfterEquipmentChange(doc) {
  return {tags: customFlags(doc).filter(flag => !EQUIPMENT_FLAGS.includes(flag)), excludedTags: excludedFlags(doc).filter(flag => !EQUIPMENT_FLAGS.includes(flag))};
}

export function flagsAfterAncestryChange(doc, name) {
  const flag = normalizeFlag(name);
  return {excludedTags: excludedFlags(doc).filter(excluded => excluded !== flag)};
}

export function rollCategoryFlags(item, {kind = "damage", attribute, skill} = {}) {
  const flags = [kind, attribute, normalizeFlag(skill?.name ?? skill)];
  if (kind !== "damage") flags.push("trait", skill ? "skill" : "attribute");
  if (item?.type === "power") flags.push("power");
  if (item?.type === "weapon") {
    flags.push("attack", "weapon");
    const fighting = skill ? skill?.system?.swid === "fighting" || String(skill?.name ?? skill).toLowerCase() === "fighting" : !/\d/.test(item.system.range ?? "");
    if (item.system.isMelee && (!item.system.isRanged || fighting)) flags.push("melee");
    if (item.system.isRanged && (!item.system.isMelee || !fighting)) flags.push("ranged");
  }
  return normalizeFlags(flags);
}
