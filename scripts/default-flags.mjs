import {t as sbsI18n} from "./i18n.mjs";
import {normalizeFlag, normalizeFlags} from "./rules.mjs";
import {applyFlagChanges, suppressionMatcher, suppressesFlag} from "./flag-changes.mjs";

export const EQUIPMENT_FLAGS = ["stored", "carried", "equipped", "off-hand", "main-hand", "two-hands"];
const LIGHT_FLAGS = ["bright-light", "dim-light", "dark-light", "pitch-dark-light"];
const CARD_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];
const JOKER_RANKS = {96: "green-joker", 97: "blue-joker", 98: "black-joker", 99: "red-joker"};
export const STANDARD_FLAGS = ["wounds", "fatigue", "distracted", "encumbered", "conviction", "joker", "attack", "damage", "trait", "opposed", "support", "test", "success", "fail", "critical-failure", "raise-1", "power-preparation", "power-maintain", "attribute", "skill", "power", "weapon", "melee", "ranged", "gear", "armor", "shield", "consumable", "edge", "hindrance", "ability", "ancestry", "wildcard", "extra", "agility", "smarts", "spirit", "strength", "vigor", ...EQUIPMENT_FLAGS,
  ...LIGHT_FLAGS, ...LIGHT_FLAGS.slice(1).map(flag => `${flag}-penalty`),
  ...["light", "medium", "heavy", "near-total"].flatMap(level => [`${level}-cover`, `${level}-cover-penalty`]),
  "shake-off", "opposed-roll", "card-face", "card-number", "card-joker", ...[...CARD_RANKS, ...Object.values(JOKER_RANKS)].map(rank => `card-${rank}`)];
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

function actionCardFlags(actor, token) {
  const combatant = token ? token.combatant : actor.getCombatant?.(globalThis.game?.combat);
  const holder = combatant?.groupLeader ?? combatant;
  // SWADE can set cardValue for sorting even when no card has been dealt.
  if (holder?.initiative == null || !holder.cardString) return [];
  const value = holder.cardValue;
  if (holder.hasJoker) return ["card-joker", JOKER_RANKS[value] && `card-${JOKER_RANKS[value]}`];
  const rank = CARD_RANKS[value - 2];
  if (!rank) return [];
  const category = value <= 10 ? "card-number" : value <= 13 ? "card-face" : "";
  return [`card-${rank}`, category];
}

export function automaticFlags(doc, token) {
  if (doc?.documentName === "ActiveEffect") return normalizeFlags([normalizeFlag(doc.name)]);
  if (doc?.documentName === "Item") {
    const flags = [normalizeFlag(doc.name), ...equipmentFlags(doc)];
    if (doc.type === "power") {
      flags.push(normalizeFlag(doc.system?.arcane), ...normalizeFlags(doc.system?.trapping).map(name => `trapping-${name}`));
    }
    globalThis.Hooks?.callAll("swadeBetterEffectsAutomaticFlags", doc, flags);
    return normalizeFlags(flags);
  }
  if (doc?.documentName !== "Actor") return [];
  const size = doc.type === "vehicle" ? doc.system?.size : doc.system?.stats?.size;
  return normalizeFlags([ancestryFlag(doc), Number.isInteger(size) ? `size${size}` : "", ...actionCardFlags(doc, token)]);
}

export function ancestryFlag(doc) {
  for (const item of doc.items ?? []) {
    if (item.type === "ancestry") return normalizeFlag(item.name ?? doc.system.details?.species?.name);
  }
  return normalizeFlag(doc.system.details?.species?.name);
}

function flagEffects(doc) {
  if (doc?.documentName !== "Actor") return [];
  const effects = [];
  for (const effect of doc.allApplicableEffects?.() ?? doc.effects ?? []) {
    if (!isGear(effect.parent) || itemGrantsFlags(effect.parent)) effects.push(effect);
  }
  return effects;
}

export function isFlagSuppressed(doc, flag) { return suppressesFlag(flagEffects(doc), flag); }

// Native modifiers have labels rather than flags. Give standard penalties stable
// names across languages, and accept explicit flags supplied by integrations.
export function modifierFlags(modifier = {}) {
  const label = String(modifier.label ?? "");
  const canonical = {"SWADE.Wounds": "wounds", "SWADE.Fatigue": "fatigue", "SWADE.Distr": "distracted",
    "SWADE.Encumbered": "encumbered", "SWADE.Conv": "conviction", "SWADE.Joker": "joker"};
  const flags = Array.isArray(modifier.flags) || typeof modifier.flags === "string" ? modifier.flags
    : modifier.flags?.["swade-better-effects"]?.tags;
  return normalizeFlags([label, ...normalizeFlags(flags), ...normalizeFlags(modifier.tags), ...Object.entries(canonical)
    .filter(([key]) => label === key || label === globalThis.game?.i18n?.localize(key)).map(([, flag]) => flag)]);
}

export function isModifierSuppressed(actor, modifier) {
  const matches = suppressionMatcher(flagEffects(actor));
  return matches ? modifierFlags(modifier).some(matches) : false;
}

export function filterSuppressedModifiers(actor, modifiers) {
  if (!modifiers.length) return modifiers;
  const matches = suppressionMatcher(flagEffects(actor));
  if (matches) for (let i = modifiers.length - 1; i >= 0; i--) {
    if (modifierFlags(modifiers[i]).some(matches)) modifiers.splice(i, 1);
  }
  return modifiers;
}

function suppliedFlags(doc, token) {
  let flags = normalizeFlags([...automaticFlags(doc, token), ...customFlags(doc)]);
  if (isGear(doc)) {
    const state = equipmentFlags(doc)[0];
    flags = flags.filter(flag => !EQUIPMENT_FLAGS.includes(flag) || flag === state);
  }
  return applyFlagChanges(flags, flagEffects(doc));
}

export function effectiveFlags(doc, token) {
  if (!doc) return [];
  const excluded = new Set(excludedFlags(doc));
  const flags = suppliedFlags(doc, token);
  globalThis.Hooks?.callAll("swadeBetterEffectsDocumentFlags", doc, token, flags);
  return normalizeFlags(flags).filter(flag => !excluded.has(flag));
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

export function rollCategoryFlags(item, {kind = sbsI18n("swade-better-effects.UI.damage_6f5a5c61cc"), attribute, skill} = {}) {
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

export function hudActionFlag(item, inCombat) {
  const kind = item?.flags?.["swade-hud"]?.actionKind ?? item?.flags?.["swade-better-setting"]?.actionKind;
  if (kind === "intimidation" && inCombat) return "test";
  return ["support", "test"].includes(kind) ? kind : undefined;
}
