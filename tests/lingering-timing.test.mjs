import test from "node:test";
import assert from "node:assert/strict";
import {isApplicationTurn} from "../scripts/lingering-effects.mjs";

test("Following turns skips the last actor's application turn across the round transition", () => {
  // The Combat document already points at round 2 while the end-turn event
  // still describes the last actor's turn in round 1.
  const combat = {id: "combat", round: 2, turn: 0};
  const actor = {id: "last"};
  const applied = {combat: "combat", combatant: "last", round: 1, turn: 3};
  assert.equal(isApplicationTurn(applied, combat, actor, {round: 1, turn: 3}), true);
  assert.equal(isApplicationTurn(applied, combat, actor, {round: 2, turn: 1}), false);
  assert.equal(isApplicationTurn(applied, combat, {id: "other"}, {round: 1, turn: 4}), false);
  assert.equal(isApplicationTurn({...applied, combat: null}, combat, actor, {round: 1, turn: 3}), false);
});
