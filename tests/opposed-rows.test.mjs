import assert from "node:assert/strict";
import {test} from "node:test";
import {latestTargetOpposition} from "../scripts/opposed-rows.mjs";

test("target results use the latest visible opposition for that specific roll and defender", () => {
  const message = (id, defenderUuid, timestamp, extra = {}) => ({id, timestamp,
    context: {opposition: {messageUuid: "original", defenderUuid}}, ...extra});
  const old = message("old", "Bao", 1), other = message("other", "Aputik", 2),
    latest = message("latest", "Bao", 3), secret = message("hidden", "Bao", 4, {isContentVisible: false});
  const messages = [old, other, latest, secret];
  assert.equal(latestTargetOpposition(messages, "original", "Bao", m => m.context), latest);
  assert.equal(latestTargetOpposition(messages, "original", "Aputik", m => m.context), other);
  assert.equal(latestTargetOpposition(messages, "another roll", "Bao", m => m.context), null);
  const shake = {timestamp: 5, context: {response: {messageUuid: "original", defenderUuid: "Bao", mode: "shakeOff"}}};
  assert.equal(latestTargetOpposition([...messages, shake], "original", "Bao", m => m.context), shake);
});
