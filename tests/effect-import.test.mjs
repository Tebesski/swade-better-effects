import test from "node:test";
import assert from "node:assert/strict";
import {effectItemData} from "../scripts/effect-import-data.mjs";
import {EFFECT_TYPE, MODULE_ID} from "../scripts/constants.mjs";

test("actor effects become reusable Items without their actor's execution state", () => {
  const source = {_id: "old", name: "Earth Armor", img: "icons/svg/shield.svg", description: "<p>Armor</p>",
    disabled: true, transfer: true, origin: "Compendium.test.actors.Actor.a", start: {round: 2}, duration: {value: 3, units: "rounds", expired: true},
    system: {changes: [{key: "system.stats.toughness.armor", value: "2", type: "add"}]},
    flags: {[MODULE_ID]: {tags: ["earth"], conditions: [{signature: "signature", customName: "Armor"}],
      lingering: {enabled: true}, lingeringState: {progress: 1}, lingeringSource: {actorUuid: "Actor.old"}, itemEffect: true}}};
  const original = structuredClone(source);
  const item = effectItemData(source, "folder-id");
  assert.equal(item.type, EFFECT_TYPE);
  assert.equal(item.folder, "folder-id");
  assert.equal(item.system.description, source.description);
  const copy = item.effects[0];
  assert.equal(copy._id, undefined);
  assert.equal(copy.disabled, false);
  assert.equal(copy.transfer, false);
  assert.equal(copy.start, null);
  assert.equal(copy.origin, null);
  assert.deepEqual(copy.duration, {value: 3, units: "rounds", expired: false});
  assert.deepEqual(copy.system, source.system);
  assert.deepEqual(copy.flags[MODULE_ID], {tags: ["earth"], conditions: source.flags[MODULE_ID].conditions, lingering: {enabled: true}});
  assert.deepEqual(source, original);
});
