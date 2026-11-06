import test from "node:test";
import assert from "node:assert/strict";
import {criticalFailure, outcomeFlags, withRollOutcome} from "../scripts/roll-outcomes.mjs";

test("trait outcomes distinguish failure, success and the exact raise count", () => {
  assert.deepEqual(outcomeFlags({total: 3}), ["fail"]);
  assert.deepEqual(outcomeFlags({total: 4}), ["success"]);
  assert.deepEqual(outcomeFlags({total: 7}), ["success"]);
  assert.deepEqual(outcomeFlags({total: 8}), ["raise-1", "success"]);
  assert.deepEqual(outcomeFlags({total: 16}), ["raise-3", "success"]);
});
test("outcomes use the actual request/opposed TN and critical failure takes precedence", () => {
  assert.deepEqual(outcomeFlags({total: 11, targetNumber: 8}), ["success"]);
  assert.deepEqual(outcomeFlags({total: 12, targetNumber: 8}), ["raise-1", "success"]);
  assert.deepEqual(outcomeFlags({total: 12, targetNumber: 8, criticalFailure: true}), ["critical-failure", "fail"]);
  assert.deepEqual(outcomeFlags({total: 0, targetNumber: 0}), ["success"]);
  assert.deepEqual(outcomeFlags({total: Infinity}), []);
});
test("a reroll replaces stale outcome flags while retaining custom and opposed flags", () => {
  const source = {roll: ["fire", "success", "raise-2", "opposed"], opposed: ["grapple", "raise-3", "success"]};
  const before = structuredClone(source), updated = withRollOutcome(source, {total: 2});
  assert.deepEqual(updated.roll, ["fail", "fire", "opposed"]);
  assert.deepEqual(updated.opposed, source.opposed); assert.deepEqual(source, before);
  assert.deepEqual(withRollOutcome(updated, {total: 9}).roll, ["fire", "opposed", "raise-1", "success"]);
});
test("critical failure recognizes native and generic Tools pools including Wild Dice", () => {
  const pool = dice => ({terms: [{dice}], isCritfail: false});
  const die = (total, wild = false) => ({total, denomination: wild ? "w" : "d"});
  assert.equal(criticalFailure({isCritfail: true}), true);
  assert.equal(criticalFailure(pool([die(1), die(1, true)])), true);
  assert.equal(criticalFailure(pool([die(1), die(3, true)])), false);
  assert.equal(criticalFailure(pool([die(1)])), true);
  assert.equal(criticalFailure(pool([die(1), die(1), die(8, true)])), false);
  assert.equal(criticalFailure(pool([])), false);
});
