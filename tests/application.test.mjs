import test from "node:test";
import assert from "node:assert/strict";
import {applicationMatches} from "../scripts/application-data.mjs";

test("Applications distinguish hits, newly applied Shaken, and wounds after soak", () => {
  assert.equal(applicationMatches({condition: "attack"}, {attack: true}), true);
  assert.equal(applicationMatches({condition: "attack"}, {shaken: true, wounds: 2}), false);
  assert.equal(applicationMatches({condition: "shaken"}, {shaken: true, wounds: 0}), true);
  assert.equal(applicationMatches({condition: "shaken"}, {shaken: false, wounds: 2}), false);
  const wounds = {condition: "wounds", wounds: 2};
  assert.equal(applicationMatches(wounds, {wounds: 1}), false);
  assert.equal(applicationMatches(wounds, {wounds: 2}), true);
  assert.equal(applicationMatches(wounds, {wounds: 3}), true);
  assert.equal(applicationMatches({...wounds, wounds: 0}, {wounds: 3}), false);
});
