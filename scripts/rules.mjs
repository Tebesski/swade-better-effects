// No Foundry globals: this is also the executable rules specification used by tests.
import {DEFENSES, MAP_KEY} from "./constants.mjs";
export function normalizeFlag(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
}

export function normalizeFlags(values) {
  const entries = Array.isArray(values) ? values : String(values ?? "").split(",");
  return [...new Set(entries.flatMap(v => String(v ?? "").split(",")).map(normalizeFlag).filter(Boolean))].sort();
}

export function normalizePattern(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9*]+/g, "-").replace(/^-+|-+$/g, "").replace(/\*+/g, "*").slice(0, 80).replace(/-+$/g, "");
}

export function matchesFlag(pattern, flags) {
  const normalized = normalizePattern(pattern);
  if (!normalized) return false;
  const expression = new RegExp(`^${normalized.split("*").join(".*")}$`);
  return normalizeFlags(flags).some(flag => expression.test(flag));
}

export function validatePredicate(node, depth = 0) {
  if (depth > 12 || !node || typeof node !== "object") return false;
  if (node.op === "flag") return ["roll", "opposed", "attacker", "target", "item", "actor"].includes(node.source) && !!normalizePattern(node.flag);
  if (node.op === "not") return validatePredicate(node.child, depth + 1);
  return ["all", "any"].includes(node.op) && Array.isArray(node.children) && node.children.length <= 64
    && node.children.every(c => validatePredicate(c, depth + 1));
}

export function testPredicate(node, context = {}, depth = 0) {
  if (!validatePredicate(node, depth)) return false;
  // An absent roll context must never make IF NOT silver into an unconditional resistance.
  if (["flag", "not"].includes(node.op) && needsContext(node) && !context.hasRoll) return false;
  if (["flag", "not"].includes(node.op) && needsOpposedContext(node) && !Array.isArray(context.opposed)) return false;
  if (node.op === "flag") return matchesFlag(node.flag, context[node.source]);
  if (node.op === "not") return !testPredicate(node.child, context, depth + 1);
  return node.op === "all" ? node.children.every(c => testPredicate(c, context, depth + 1))
    : node.children.some(c => testPredicate(c, context, depth + 1));
}

function needsOpposedContext(node) {
  if (node?.op === "flag") return node.source === "opposed";
  if (node?.op === "not") return needsOpposedContext(node.child);
  return (node?.children ?? []).some(needsOpposedContext);
}

export function needsContext(node) {
  if (node?.op === "flag") return node.source !== "actor";
  if (node?.op === "not") return needsContext(node.child);
  return (node?.children ?? []).some(needsContext);
}

export function predicateFlags(node) {
  if (node?.op === "flag") return String(node.flag).includes("*") ? [] : normalizeFlags([node.flag]);
  if (node?.op === "not") return predicateFlags(node.child);
  return normalizeFlags((node?.children ?? []).flatMap(predicateFlags));
}

export const emptyPredicate = () => ({op: "all", children: []});
export const hasCondition = p => p && !(p.op === "all" && !p.children?.length);

export function changeSignature(change) {
  return JSON.stringify([change.key, change.type ?? "add", String(change.value ?? ""), change.phase ?? "initial", change.priority ?? null]);
}

export function conditionFor(change, index, conditions = []) {
  const entry = conditions[index];
  return entry?.signature === changeSignature(change) ? entry.predicate : undefined;
}

export function selectorForKey(key) {
  if (key === MAP_KEY) return "map";
  if (Object.hasOwn(DEFENSES, key)) return DEFENSES[key].selector;
  if (/^sbe\.powerRoll\.(power-preparation|power-maintain)$/.test(key)) return `power-roll:${key.split(".").at(-1)}`;
  if (key.startsWith("sbe.targetRoll.")) return `target-roll:${key.slice("sbe.targetRoll.".length)}`;
  const skill = key.match(/^@Skill\{(.+)\}\[system\.die\.modifier\]$/);
  if (skill) return `skill:${skill[1]}`;
  const attribute = key.match(/^system\.attributes\.(agility|smarts|spirit|strength|vigor)\.die\.modifier$/);
  if (attribute) return `attribute:${attribute[1]}`;
  const global = key.match(/^system\.stats\.globalMods\.(trait|agility|smarts|spirit|strength|vigor|attack|targetAttack|targetAttackRanged|targetAttackMelee|gangUpAttack|gangUpDefend)$/);
  if (global) return `global:${global[1]}`;
  return ({"system.stats.toughness.value": "toughness", "system.toughness.total": "toughness",
    "system.stats.toughness.armor": "armor", "system.toughness.armor": "armor",
    "system.stats.globalMods.damage": "outgoing-damage", "system.stats.globalMods.targetDamage": "incoming-damage",
    "system.stats.globalMods.ap": "ap"})[key];
}

export function numericChange(current, type, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Conditional rules require a finite numeric value.");
  switch (type) {
    case "add": return current + n;
    case "subtract": return current - n;
    case "multiply": return current * n;
    case "override": return n;
    case "upgrade": return Math.max(current, n);
    case "downgrade": return Math.min(current, n);
    default: throw new Error(`Unsupported conditional operation: ${type}`);
  }
}

export function resolveMapPenalty({penalty, context = {}, rules = []}) {
  let value = Math.abs(Number(penalty));
  if (!Number.isFinite(value)) throw new Error("MAP must be a finite number.");
  const applied = [];
  // Choosing no multi-action penalty must never become a bonus or a penalty.
  if (!value) return {penalty: 0, applied};
  const priority = {multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50};
  for (const rule of [...rules].sort((a,b) => (a.priority ?? priority[a.type] ?? 20) - (b.priority ?? priority[b.type] ?? 20))) {
    if (rule.selector !== "map" || !testPredicate(rule.predicate ?? emptyPredicate(), {...context, actor: rule.ownerFlags ?? []})) continue;
    const before = value;
    value = numericChange(value, rule.type ?? "add", rule.value);
    if (!Number.isFinite(value)) throw new Error("A MAP change produced a non-finite result.");
    applied.push({label: rule.label ?? "Modify MAP", before, after: value});
  }
  return {penalty: value > 0 ? -value : 0, applied};
}

export const damageRuleKey = (rule, side = rule.side) =>
  JSON.stringify([side, rule.selector, rule.type ?? "add", String(rule.formula ?? rule.value), rule.label ?? ""]);

const damageDefenses = Object.values(DEFENSES);
const damageDefenseOrder = {weakness: 1, resistance: 2, immunity: 3};

export function* matchingDamageRules({context = {}, attackerRules = [], defenderRules = [], skipRolled = true}) {
  const rolled = [...(skipRolled ? context.damageRulesInRoll ?? [] : [])];
  const defaults = {multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50};
  const rules = [...attackerRules.map(r => ({...r, side: "attacker"})), ...defenderRules.map(r => ({...r, side: "defender"}))]
    .sort((a, b) => (a.side === b.side ? 0 : a.side === "attacker" ? -1 : 1)
      || (damageDefenseOrder[a.selector] ?? 0) - (damageDefenseOrder[b.selector] ?? 0)
      || (a.priority ?? defaults[a.type] ?? 20) - (b.priority ?? defaults[b.type] ?? 20));
  for (const rule of rules) {
    const incomingAP = rule.side === "defender" && rule.selector === "target-roll:ap";
    if (rule.side === "defender" && ["target-roll:damage", "target-roll:targetDamage"].includes(rule.selector)) rule.selector = "incoming-damage";
    if (rule.side === "defender" && rule.selector === "target-roll:ap") rule.selector = "ap";
    if (rule.side === "defender" && rule.selector === "ap" && !incomingAP) continue;
    if (rule.side === "attacker" && !["outgoing-damage", "ap"].includes(rule.selector)) continue;
    const defense = damageDefenses.find(defense => defense.selector === rule.selector);
    if (rule.side === "defender" && !defense && !["incoming-damage", "toughness", "armor", "ap"].includes(rule.selector)) continue;
    if (defense && (rule.type !== defense.type || !Number.isFinite(Number(rule.value)) || Number(rule.value) < 0)) continue;
    if (!testPredicate(rule.predicate ?? emptyPredicate(), {...context, actor: rule.ownerFlags ?? []})) continue;
    const applied = rolled.indexOf(damageRuleKey(rule));
    if (applied < 0) yield rule;
    else rolled.splice(applied, 1);
  }
}

export function resolveDamage({damage, ap = 0, toughness, armor = 0, skipUnrolled = false, ...rules}) {
  const values = {damage: Number(damage), ap: Number(ap), toughness: Number(toughness), armor: Number(armor)};
  if (!Object.values(values).every(Number.isFinite)) throw new Error("Damage and defenses must be finite numbers.");
  const applied = [];
  let immunity;
  for (const rule of matchingDamageRules(rules)) {
    const defense = Object.hasOwn(damageDefenseOrder, rule.selector);
    const key = defense || rule.selector.endsWith("-damage") ? "damage" : rule.selector;
    if (!(key in values) || (skipUnrolled && key === "damage" && !Number.isFinite(Number(rule.value)))) continue;
    const before = values[key];
    values[key] = rule.selector === "immunity" ? 0 : numericChange(before, rule.type ?? "add", rule.value);
    if (rule.selector === "immunity") immunity ??= rule.label || "Immunity";
    if (!Number.isFinite(values[key])) throw new Error("A conditional rule produced a non-finite result.");
    if (key === "armor") values.armor = Math.max(0, values.armor);
    // Armor is part of total Toughness, so conditional armor changes both values.
    if (key === "armor") values.toughness += values.armor - before;
    const change = {label: rule.label ?? "Conditional effect", selector: rule.selector, before, after: values[key]};
    if (key === "damage") Object.assign(change, {type: rule.type ?? "add", rolledValue: Number(rule.value)});
    if (rule.formula) change.formula = rule.formula;
    if (rule.breakdown) change.breakdown = rule.breakdown;
    applied.push(change);
  }
  values.damage = Math.max(0, Math.floor(values.damage));
  values.armor = Math.max(0, values.armor);
  values.ap = Math.max(0, values.ap);
  values.effectiveToughness = values.toughness - Math.min(values.ap, values.armor);
  return {...values, applied, ...(immunity ? {immune: true, immunity} : {})};
}

export function resolveTrait({context, attackerRules = [], defenderRules = []}) {
  let value = 0;
  const applied = [];
  const traitFields = {skill: Number(context.skill?.modifier ?? 0), attribute: Number(context.attributeModifier ?? 0)};
  const rollFlags = normalizeFlags(context.rollKinds ?? context.roll);
  const matchesKind = kind => kind === "trait" || kind === context.attribute
    || kind === "attack" && rollFlags.includes("attack")
    || kind === "targetAttack" && rollFlags.includes("attack")
    || kind === "targetAttackRanged" && rollFlags.includes("attack") && rollFlags.includes("ranged")
    || kind === "targetAttackMelee" && rollFlags.includes("attack") && rollFlags.includes("melee")
    || ["gangUpAttack", "gangUpDefend"].includes(kind) && rollFlags.includes("gang-up");
  const priority = {multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50};
  for (const [side, rules] of [["attacker", attackerRules], ["defender", defenderRules]]) {
    for (const rule of [...rules].sort((a,b) => (a.priority ?? priority[a.type] ?? 20) - (b.priority ?? priority[b.type] ?? 20))) {
      const [category, ...parts] = rule.selector.split(":");
      const kind = parts.join(":");
      if (category === "skill" || category === "attribute") {
        if (side !== "attacker") continue;
        if (category === "attribute" && (context.skill || context.attribute !== kind)) continue;
        if (category === "skill" && (!context.skill || !(kind === context.skill.id || kind.toLocaleLowerCase() === context.skill.name?.toLocaleLowerCase()))) continue;
      } else if (category !== "global" && category !== "target-roll") continue;
      const incoming = category === "target-roll" || kind.startsWith("target") || kind === "gangUpDefend";
      if (["global", "target-roll"].includes(category) && ((side === "defender") !== incoming || !matchesKind(kind))) continue;
      if (!testPredicate(rule.predicate ?? emptyPredicate(), {...context, actor: rule.ownerFlags ?? []})) continue;
      const before = value;
      if (["skill", "attribute"].includes(category) && rule.type && rule.type !== "add") {
        const fieldBefore = traitFields[category];
        traitFields[category] = numericChange(fieldBefore, rule.type, rule.value);
        value += traitFields[category] - fieldBefore;
      } else value = numericChange(value, rule.type ?? "add", category === "global" && kind === "gangUpDefend" ? -Number(rule.value) : rule.value);
      applied.push({label: rule.label, value: value - before});
    }
  }
  return {value, applied};
}

export function calculateWounds({damage, effectiveToughness, shaken = false, hardy = false, woundCap = false, immune = false}) {
  const excess = damage - effectiveToughness;
  if (immune || excess < 0) return {wounds: 0, status: "none"};
  let wounds = Math.max(0, Math.floor(excess / 4));
  let status = wounds ? "wounded" : "shaken";
  if (!wounds && shaken && !hardy) { wounds = 1; status = "wounded"; }
  if (woundCap) wounds = Math.min(4, wounds);
  return {wounds, status};
}
