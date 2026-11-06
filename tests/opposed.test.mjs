import test from "node:test";
import assert from "node:assert/strict";
import {opposedResult, withOpposition} from "../scripts/opposed-context.mjs";
import {selectorForKey, resolveTrait, testPredicate} from "../scripts/rules.mjs";

const response = {hasRoll: true, roll: ["trait", "skill", "athletics", "agility"], attribute: "agility", skill: {id: "athletics-id", name: "Athletics"}};
const opposition = {targetNumber: 9, flags: ["trait", "attack", "grapple", "melee"], tokenUuid: "Scene.a.Token.b"};
const againstGrapple = {op: "flag", source: "roll", flag: "grapple"};
const rule = (selector, value = 1, predicate = againstGrapple) => ({selector, value, type: "add", label: "Grapple training", predicate});

test("opposition carries original flags and the original opponent without mutating either roll", () => {
  const before = structuredClone(response), original = structuredClone(opposition);
  const result = withOpposition(response, opposition);
  assert.ok(result.roll.includes("grapple")); assert.ok(result.roll.includes("athletics"));
  assert.ok(result.rollKinds.includes("opposed")); assert.ok(!result.rollKinds.includes("attack"));
  assert.deepEqual(result.targetUuids, ["Scene.a.Token.b"]);
  assert.deepEqual(result.opposed, ["attack", "grapple", "melee", "trait"]);
  assert.deepEqual(response, before); assert.deepEqual(opposition, original);
});

test("existing AEGIS Skills modifier rows apply only to the chosen skill when their condition matches", () => {
  const selector = selectorForKey("@Skill{Athletics}[system.die.modifier]"); assert.equal(selector, "skill:Athletics");
  const context = withOpposition(response, opposition);
  assert.equal(resolveTrait({context, attackerRules: [rule(selector)]}).value, 1);
  assert.equal(resolveTrait({context: response, attackerRules: [rule(selector)]}).value, 0);
  assert.equal(resolveTrait({context: {...context, skill: {id: "other", name: "Fighting"}}, attackerRules: [rule(selector)]}).value, 0);
  assert.equal(resolveTrait({context, attackerRules: [rule("skill:athletics-id")]}).value, 1);
  assert.equal(resolveTrait({context, defenderRules: [rule(selector)]}).value, 0);
});

test("inherited attack flags do not make a resistance an attack roll", () => {
  const context = withOpposition(response, opposition);
  assert.equal(resolveTrait({context, attackerRules: [rule("global:attack", 10), rule("skill:Athletics")]}).value, 1);
  assert.equal(resolveTrait({context, defenderRules: [rule("target-roll:targetAttack", -2)]}).value, 0);
});

test("specific trait non-Add modes adjust the existing modifier and preserve additive effect rows", () => {
  const context = withOpposition({...response, skill: {...response.skill, modifier: 2}}, opposition);
  assert.equal(resolveTrait({context, attackerRules: [{...rule("skill:Athletics", 2), type: "multiply"}]}).value, 2);
  assert.equal(resolveTrait({context, attackerRules: [rule("skill:Athletics"), {...rule("skill:Athletics", 1), type: "override"}]}).value, 0);
});

test("attribute-specific modifiers stay separate from skills linked to that attribute", () => {
  const selector = selectorForKey("system.attributes.agility.die.modifier"); assert.equal(selector, "attribute:agility");
  const skillContext = withOpposition(response, opposition), attributeContext = {...skillContext, skill: null};
  assert.equal(resolveTrait({context: skillContext, attackerRules: [rule(selector)]}).value, 0);
  assert.equal(resolveTrait({context: attributeContext, attackerRules: [rule(selector)]}).value, 1);
});

test("explicit Opposed roll conditions and their negation require an opposed roll", () => {
  const condition = {op: "flag", source: "opposed", flag: "grap*"}, not = {op: "not", child: condition};
  assert.equal(testPredicate(condition, withOpposition(response, opposition)), true);
  assert.equal(testPredicate(not, response), false);
  assert.equal(testPredicate(not, withOpposition(response, {...opposition, flags: ["fire"]})), true);
});

test("opposed success, raises and critical failure use the source TN exactly", () => {
  assert.deepEqual(opposedResult(8, 9), {outcome: "Failure", raises: 0});
  assert.deepEqual(opposedResult(9, 9), {outcome: "Success", raises: 0});
  assert.deepEqual(opposedResult(17, 9), {outcome: "Success", raises: 2});
  assert.deepEqual(opposedResult(17, 9, true), {outcome: "Critical failure", raises: 0});
  assert.throws(() => opposedResult(4, NaN), /finite/);
});
