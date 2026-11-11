import {MODULE_ID} from "./constants.mjs";
import {collectEffectRules, collectRules} from "./effects.mjs";
import {rollTarget} from "./flags.mjs";
import {damageRuleKey, matchingDamageRules} from "./rules.mjs";

export function damageRulesForTarget(context, actor, token) {
  const {item, flags: target} = rollTarget(context, token, actor);
  const resolvedContext = {...context, hasRoll: true, target};
  const defenderRules = item ? collectEffectRules(item.effects, target)
    : collectRules(actor).map(rule => ({...rule, ownerFlags: target}));
  globalThis.Hooks?.callAll("swadeBetterEffectsDamageRules", resolvedContext, actor, token, item, defenderRules);
  return {context: resolvedContext, attackerRules: context.attackerRules ?? [], defenderRules};
}

export function isDamageFormula(value) {
  if (typeof value !== "string" || value.length > 128) return false;
  // Allow arithmetic and ordinary dice, including the exploding dice modifier.
  const arithmetic = value.replace(/\b\d*d\d+(?:x\d*)?\b/gi, "1");
  return /^[\d+*/().\s-]+$/.test(arithmetic) && Roll.validate(value);
}

export function unrolledDamageFormula(rule) {
  return rule.selector === "outgoing-damage" && !Number.isFinite(Number(rule.value));
}

export function sharedDamageRules(context) {
  const targets = (context.targetUuids ?? []).map(uuid => foundry.utils.fromUuidSync(uuid)).filter(token => token?.actor);
  const matching = token => [...matchingDamageRules({...damageRulesForTarget(context, token?.actor, token), skipRolled: false})]
    .filter(rule => rule.selector.endsWith("-damage") && !rule.resolutionOnly);
  const first = matching(targets[0]);
  const otherTargets = targets.slice(1).map(token => matching(token).map(rule => damageRuleKey(rule)));
  // Apply only the common prefix. A later addition cannot move before a
  // target-specific multiply or override without changing the result.
  const shared = [];
  for (const rule of first) {
    const value = rule.formula ?? rule.value;
    if (!Number.isFinite(Number(value)) && !isDamageFormula(value)) break;
    if (otherTargets.some(keys => keys[shared.length] !== damageRuleKey(rule))) break;
    shared.push(rule);
  }
  return shared;
}

const DIE = /\b(\d*d(\d+))(?:x\d*)?\b/gi;
function damageLabel(rule) {
  return String(rule.label || "Conditional damage").replace(/[\[\]]/g, "");
}
function damageDie(die, acing) {
  return die.replace(DIE, (term, base, faces) =>
    acing === true && Number(faces) > 1 ? `${base}x` : acing === false ? base : term);
}
function damageValue(rule, acing) {
  const value = String(rule.formula ?? rule.value).trim();
  const label = damageLabel(rule);
  if (Number.isFinite(Number(value))) return `${Number(value) < 0 ? `(${value})` : value}[${label}]`;
  const labeled = damageDie(value, acing).replace(DIE, die => `${die}[${label}]`);
  return /^\d*d\d+(?:x\d*)?\[[^\]]*\]$/i.test(labeled) ? labeled : `(${labeled})`;
}
function additiveTerms(rule, acing) {
  const value = String(rule.formula ?? rule.value).replace(/\s/g, "");
  const terms = value.match(/[+-]?(?:\d*d\d+(?:x\d*)?|\d+(?:\.\d+)?)/gi);
  if (!terms || terms.join("") !== value) return;
  return terms.map(term => {
    const negative = term[0] === "-";
    const sign = negative !== (rule.type === "subtract") ? "-" : "+";
    return ` ${sign} ${damageDie(term.replace(/^[+-]/, ""), acing)}[${damageLabel(rule)}]`;
  }).join("");
}

export function damageFormula(base, rules, acing) {
  let expression = base;
  for (const rule of rules) {
    const additive = ["add", "subtract"].includes(rule.type ?? "add") && additiveTerms(rule, acing);
    if (additive) { expression += additive; continue; }
    const value = damageValue(rule, acing);
    switch (rule.type ?? "add") {
      case "add": expression += ` + ${value}`; break;
      case "subtract": expression += ` - ${value}`; break;
      case "multiply": expression = `(${expression}) * ${value}`; break;
      case "override": expression = value; break;
      case "upgrade": expression = `max(${expression}, ${value})`; break;
      case "downgrade": expression = `min(${expression}, ${value})`; break;
    }
  }
  return expression;
}

export function applyDamageFormula(roll, context, rules, acing) {
  if (!rules.length) return context;
  const formula = damageFormula(roll.formula, rules, acing);
  const terms = Roll.parse(formula, roll.data);
  if (rules.every(rule => ["add", "subtract"].includes(rule.type ?? "add"))) {
    // Preserve already-prepared SWADE damage terms, including power overrides.
    terms.splice(0, roll.terms.length, ...roll.terms.map(term => foundry.dice.terms.RollTerm.fromData(foundry.utils.deepClone(term.toJSON()))));
  }
  roll.terms = terms;
  roll.resetFormula();
  return {...context, damageRulesInRoll: rules.map(rule => damageRuleKey(rule))};
}

export async function snapshotDamageFormulas(message) {
  const context = message.getFlag(MODULE_ID, "context");
  if (context?.rollType !== "damage") return;
  const rolled = [...(context.damageRulesInRoll ?? [])];
  const rules = context.attackerRules ?? [];
  const evaluated = await Promise.all(rules.map(async rule => {
    if (rule.selector !== "outgoing-damage") return rule;
    const key = damageRuleKey(rule, "attacker");
    const index = rolled.indexOf(key);
    if (index >= 0) { rolled.splice(index, 1); return rule; }
    if (!unrolledDamageFormula(rule) && !rule.formula) return rule;
    // Divergent target rules retain their own value for the damage resolver.
    const formula = rule.formula ?? rule.value;
    try {
      if (!isDamageFormula(formula)) throw new Error("Invalid damage formula.");
      const roll = await new Roll(formula).evaluate({allowInteractive: false});
      if (!Number.isFinite(roll.total)) throw new Error("Damage formula did not produce a finite total.");
      return {...rule, formula, value: roll.total};
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not roll ${rule.label ?? "conditional damage"}`, error);
      return null;
    }
  }));
  if (evaluated.some((rule, index) => rule !== rules[index])) {
    message.updateSource({[`flags.${MODULE_ID}.context.attackerRules`]: evaluated.filter(Boolean)});
  }
}
