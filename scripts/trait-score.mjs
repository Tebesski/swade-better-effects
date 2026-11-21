import {t as sbsI18n} from "./i18n.mjs";
// Compare prepared native Trait rolls without consuming random numbers.
// Exploding tails below 1e-10 are negligible for choosing the stronger trait.
function dieDistribution(die) {
  const sides = Number(die.faces);
  if (!Number.isInteger(sides) || sides < 1) throw new Error(sbsI18n("swade-better-effects.UI.Unsupportedopposingtraitdie_5b7c010259"));
  const exploding = sides > 1 && die.modifiers.some(modifier => /^x/.test(modifier));
  const values = new Map();
  let weight = 1;
  for (let aces = 0; weight > 1e-10; aces++) {
    for (let face = 1; face <= sides; face++) {
      if (exploding && face === sides) continue;
      values.set(aces * sides + face, weight / sides);
    }
    if (!exploding) break;
    weight /= sides;
  }
  return values;
}

function poolMean(pool) {
  const distributions = pool.rolls.map(roll => dieDistribution(roll.terms[0]));
  const values = [...new Set(distributions.flatMap(distribution => [...distribution.keys()]))].sort((a, b) => a - b);
  const cumulative = distributions.map(() => 0);
  let previous = 0, mean = 0;
  for (const value of values) {
    for (let i = 0; i < distributions.length; i++) cumulative[i] += distributions[i].get(value) ?? 0;
    const probability = cumulative.reduce((product, value) => product * value, 1);
    mean += value * (probability - previous);
    previous = probability;
  }
  return mean;
}

export function traitRollScore(roll, evaluate = expression => Roll.safeEval(expression)) {
  const expression = roll.terms.map(term => {
    if (term.rolls) return poolMean(term);
    if (term.faces) {
      const distribution = dieDistribution(term);
      return (term.number ?? 1) * [...distribution].reduce((mean, [value, chance]) => mean + value * chance, 0);
    }
    if (term.operator) return term.operator;
    if (term.number !== undefined) return term.number;
    if (term.roll) return `(${traitRollScore(term.roll, evaluate)})`;
    throw new Error(sbsI18n("swade-better-effects.UI.Unsupportedopposingtraitmodifier_4cae359d70"));
  }).join(" ");
  const score = evaluate(expression);
  if (!Number.isFinite(score)) throw new Error(sbsI18n("swade-better-effects.UI.Invalidopposingtraitmodifiers_c5a714b6cd"));
  return score;
}
