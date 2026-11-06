import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFlag, normalizeFlags, validatePredicate, testPredicate, emptyPredicate, changeSignature, conditionFor, resolveDamage, calculateWounds} from "../scripts/rules.mjs";

const flag = (name, source = "roll") => ({op: "flag", source, flag: name});
const rule = (selector, value, predicate = emptyPredicate(), type = "add", extra = {}) => ({selector, type, value, predicate, ...extra});
const resolve = extra => resolveDamage({damage: 12, toughness: 6, armor: 2, ap: 0, context: {hasRoll: true, roll: ["fire"], target: [], attacker: [], item: []}, ...extra});

test("flags normalize accents, punctuation and duplicate entries", () => {
  assert.equal(normalizeFlag("  Cold  Iron!! "), "cold-iron");
  assert.equal(normalizeFlag("Élf's BÁNE"), "elf-s-bane");
  assert.deepEqual(normalizeFlags(["FIRE", "Silver, fire", "", "Cold Iron"]), ["cold-iron", "fire", "silver"]);
  assert.equal(normalizeFlag("----"), "");
  assert.ok(normalizeFlag("x".repeat(200)).length <= 80);
});
test("ALL, ANY and nested NOT predicates", () => {
  const p = {op: "all", children: [flag("fire"), {op: "any", children: [flag("elf", "target"), flag("insect", "target")]}, {op: "not", child: flag("silver")}]};
  assert.equal(testPredicate(p, {hasRoll: true, roll: ["fire"], target: ["insect"]}), true);
  assert.equal(testPredicate(p, {hasRoll: true, roll: ["fire", "silver"], target: ["insect"]}), false);
});
test("missing roll context does not activate a negative condition", () => {
  assert.equal(testPredicate({op: "not", child: flag("silver")}), false);
  assert.equal(testPredicate({op: "not", child: flag("silver")}, {hasRoll: true, roll: []}), true);
});
test("owner flags refer to the rule owner", () => {
  assert.equal(testPredicate(flag("elf", "actor"), {actor: ["elf"]}), true);
  assert.equal(testPredicate(flag("elf", "actor"), {target: ["elf"]}), false);
});
test("empty ALL is unconditional; empty ANY never matches", () => {
  assert.equal(testPredicate(emptyPredicate()), true);
  assert.equal(testPredicate({op: "any", children: []}), false);
});
test("malformed, excessive, and unknown predicates fail closed", () => {
  assert.equal(validatePredicate(flag("")), false);
  assert.equal(testPredicate({op: "javascript", value: "true"}), false);
  assert.equal(validatePredicate(flag("fire", "unknown")), false);
  let p = flag("fire"); for (let i = 0; i < 14; i++) p = {op: "not", child: p};
  assert.equal(validatePredicate(p), false);
});
test("a fire-only Toughness bonus is evaluated for each attack", () => {
  const defenderRules = [rule("toughness", 4, flag("fire"))];
  assert.equal(resolve({defenderRules}).toughness, 10);
  assert.equal(resolve({defenderRules, context: {hasRoll: true, roll: ["cold"]}}).toughness, 6);
});
test("werewolf resistance halves non-silver damage", () => {
  const defenderRules = [rule("incoming-damage", .5, {op: "not", child: flag("silver")}, "multiply")];
  assert.equal(resolve({damage: 13, defenderRules}).damage, 6);
  assert.equal(resolve({damage: 13, defenderRules, context: {hasRoll: true, roll: ["silver"]}}).damage, 13);
});
test("attacker damage bonus matches creature flags on each target independently", () => {
  const attackerRules = [rule("outgoing-damage", 4, flag("insect", "target"))];
  assert.equal(resolve({attackerRules, context: {hasRoll: true, target: ["insect"]}}).damage, 16);
  assert.equal(resolve({attackerRules, context: {hasRoll: true, target: ["elf"]}}).damage, 12);
});
test("defensive and offensive rules do not run on the wrong side", () => {
  const r = resolve({attackerRules: [rule("toughness", 100)], defenderRules: [rule("outgoing-damage", 100)]});
  assert.equal(r.damage, 12); assert.equal(r.toughness, 6);
});
test("the defender's outgoing AP does not pierce its own armor; incoming AP rules can adjust it", () => {
  assert.equal(resolve({defenderRules: [rule("ap", 4)]}).ap, 0);
  assert.equal(resolve({defenderRules: [rule("target-roll:ap", 2)]}).ap, 2);
});
test("outgoing bonuses resolve before incoming resistance", () => {
  assert.equal(resolve({attackerRules: [rule("outgoing-damage", 4)], defenderRules: [rule("incoming-damage", .5, emptyPredicate(), "multiply")]}).damage, 8);
});
test("armor penalties cannot remove non-armor Toughness", () => {
  const result = resolve({defenderRules: [rule("armor", -10)]});
  assert.equal(result.armor, 0); assert.equal(result.toughness, 4);
});
test("conditional armor increases total Toughness and remains vulnerable to AP", () => {
  const r = resolve({ap: 4, defenderRules: [rule("armor", 4, flag("fire"))]});
  assert.equal(r.armor, 6); assert.equal(r.toughness, 10); assert.equal(r.effectiveToughness, 6);
});
test("AP is capped at armor, preserving non-armor Toughness", () => {
  assert.equal(resolve({ap: 100}).effectiveToughness, 4);
});
test("multiple defenses do not mutate shared roll input or leak to another target", () => {
  const input = {context: {hasRoll: true, roll: ["fire"]}, defenderRules: [rule("toughness", 4, flag("fire"))]};
  const before = structuredClone(input);
  resolve(input); resolve(input);
  assert.deepEqual(input, before);
  assert.equal(resolve({}).toughness, 6);
});
test("priority, multiplication, addition, override, upgrade, and downgrade", () => {
  assert.equal(resolve({defenderRules: [rule("incoming-damage", 2), rule("incoming-damage", .5, emptyPredicate(), "multiply")]}).damage, 8);
  assert.equal(resolve({defenderRules: [rule("toughness", 10, emptyPredicate(), "upgrade"), rule("toughness", 7, emptyPredicate(), "override")]}).toughness, 7);
  assert.equal(resolve({defenderRules: [rule("incoming-damage", 3, emptyPredicate(), "subtract")]}).damage, 9);
  assert.equal(resolve({defenderRules: [rule("incoming-damage", 5, emptyPredicate(), "downgrade")]}).damage, 5);
  assert.equal(resolve({defenderRules: [rule("incoming-damage", 3, emptyPredicate(), "override", {priority: 1}), rule("incoming-damage", 2)]}).damage, 5);
});
test("invalid numeric rules never execute expressions or contaminate damage", () => {
  assert.throws(() => resolve({defenderRules: [rule("incoming-damage", "1d6")]}), /finite numeric/);
  assert.throws(() => resolve({damage: NaN}), /finite numbers/);
  assert.throws(() => resolve({defenderRules: [rule("incoming-damage", 2, emptyPredicate(), "custom")]}), /Unsupported/);
  assert.equal(resolve({defenderRules: [rule("incoming-damage", -100)]}).damage, 0);
});
test("condition signatures detect standard-editor changes and reordering", () => {
  const c = {key: "system.stats.toughness.value", type: "add", value: "4", phase: "initial", priority: null};
  const conditions = [{signature: changeSignature(c), predicate: flag("fire")}];
  assert.deepEqual(conditionFor(c, 0, conditions), flag("fire"));
  assert.equal(conditionFor({...c, value: "40"}, 0, conditions), undefined);
  assert.equal(conditionFor(c, 1, conditions), undefined);
});
test("damage equal to Toughness shakes and each raise inflicts a wound", () => {
  assert.deepEqual(calculateWounds({damage: 5, effectiveToughness: 6}), {wounds: 0, status: "none"});
  assert.deepEqual(calculateWounds({damage: 6, effectiveToughness: 6}), {wounds: 0, status: "shaken"});
  assert.deepEqual(calculateWounds({damage: 14, effectiveToughness: 6}), {wounds: 2, status: "wounded"});
});
test("11 fire damage against Toughness 6 with a conditional +4 causes Shaken and no wound", () => {
  const defended = resolve({damage: 11, armor: 0, defenderRules: [rule("toughness", 4, flag("fire"))]});
  assert.equal(defended.effectiveToughness, 10);
  assert.deepEqual(calculateWounds(defended), {wounds: 0, status: "shaken"});
  const ordinary = resolve({damage: 11, armor: 0, context: {hasRoll: true, roll: ["cold"]}, defenderRules: [rule("toughness", 4, flag("fire"))]});
  assert.deepEqual(calculateWounds(ordinary), {wounds: 1, status: "wounded"});
});
test("already Shaken, Hardy, wound cap, and Heavy Armor", () => {
  assert.equal(calculateWounds({damage: 6, effectiveToughness: 6, shaken: true}).wounds, 1);
  assert.equal(calculateWounds({damage: 6, effectiveToughness: 6, shaken: true, hardy: true}).wounds, 0);
  assert.equal(calculateWounds({damage: 100, effectiveToughness: 6, woundCap: true}).wounds, 4);
  assert.deepEqual(calculateWounds({damage: 100, effectiveToughness: 6, immune: true}), {wounds: 0, status: "none"});
});
