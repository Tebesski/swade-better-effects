import test from "node:test";
import assert from "node:assert/strict";
import {changeSignature, customChangeName} from "../scripts/rules.mjs";

test("custom behaviour names follow their change and ignore stale metadata", () => {
  const change = {key: "system.stats.globalMods.trait", type: "add", value: "-2"};
  const rows = [{signature: changeSignature(change), customName: "  Blindness penalty  "}];
  assert.equal(customChangeName(change, 0, rows), "Blindness penalty");
  assert.equal(customChangeName({...change, value: "-4"}, 0, rows), "");
  assert.equal(customChangeName(change, 1, rows), "");
  assert.equal(customChangeName(change, 0), "");
});
