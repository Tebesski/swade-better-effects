import test from "node:test";
import assert from "node:assert/strict";
import {traitRollScore} from "../scripts/trait-score.mjs";

const die = (faces, exploding = true) => ({faces, modifiers: exploding ? ["x"] : []});
const prepared = (sides, modifier = 0, wild = false) => ({terms: [
  {rolls: [{terms: [die(sides)]}, ...(wild ? [{terms: [die(6)]}] : [])]},
  {operator: "+"}, {number: modifier}
]});
// The test inputs use a pool mean followed by a single additive modifier.
const sum = expression => expression.split("+").reduce((total, term) => total + Number(term.trim()), 0);

test("opposed trait selection includes modifiers and uses current prepared dice", () => {
  assert.ok(traitRollScore(prepared(6, 2), sum) > traitRollScore(prepared(8), sum));
  assert.ok(traitRollScore(prepared(12, -4), sum) < traitRollScore(prepared(6), sum));
  assert.ok(traitRollScore(prepared(10, 1), sum) > traitRollScore(prepared(6, 2), sum));
  assert.ok(traitRollScore(prepared(6, 2, true), sum) > traitRollScore(prepared(8, 0, true), sum));
});

test("opposed selection evaluates expected results without consuming dice", () => {
  const d6 = traitRollScore({terms: [{rolls: [{terms: [die(6, false)]}]}]}, Number);
  const wildcard = traitRollScore({terms: [{rolls: [{terms: [die(6, false)]}, {terms: [die(6, false)]}]}]}, Number);
  assert.ok(Math.abs(d6 - 3.5) < 1e-9);
  assert.ok(Math.abs(wildcard - 161 / 36) < 1e-9);
  assert.equal(traitRollScore({terms: [{...die(6, false), number: 2}]}, Number), 7);
});
