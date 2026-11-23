import {matchesFlag, normalizePattern} from "./rules.mjs";
const key = value => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const list = value => [...new Set((Array.isArray(value) ? value : String(value ?? "").split(",")).map(v => String(v).trim()).filter(Boolean))];

export function restrictionData(value = {}) {
  return {traits: list(value.traits), linkedAttributes: list(value.linkedAttributes).filter(attr => list(value.traits).some(t => key(t) === key(attr))),
    rollFlags: list(value.rollFlags).map(normalizePattern).filter(Boolean)};
}

export function restrictionMatches(rule, context, attributeNames = {}) {
  const {traits, linkedAttributes, rollFlags} = restrictionData(rule);
  if (context.rollType === "trait" && !context.roll?.includes("formula")) {
    const names = context.skill ? [context.skill.name, context.skill.swid] : [context.attribute, attributeNames[context.attribute]];
    if (traits.some(trait => trait === "*" || names.filter(Boolean).some(name => key(name) === key(trait)))) return true;
    if (context.skill && linkedAttributes.some(attr => key(attr) === key(context.attribute))) return true;
  }
  return rollFlags.some(flag => matchesFlag(flag, context.roll));
}

export function validateRestriction(value) {
  const rule = restrictionData(value);
  if (!rule.traits.length && !rule.rollFlags.length) throw new Error("Choose at least one restricted trait or roll flag.");
  return rule;
}
