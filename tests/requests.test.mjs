import test from "node:test";
import assert from "node:assert/strict";
import {mergeRequestPresets, traitName, traitRequest, validateRequest} from "../scripts/request-data.mjs";
const attributes = [{key: "agility", name: "Agility"}, {key: "spirit", name: "Spirit"}];
test("requests resolve attributes and named skills, normalize flags, and default to TN 4", () => {
  const request = traitRequest({trait: " agility ", flags: " FIRE, cold iron, Fire "}, attributes);
  assert.equal(request.kind, "attribute"); assert.equal(request.trait, "agility"); assert.equal(request.targetNumber, 4);
  assert.deepEqual(request.flags, ["cold-iron", "fire"]); assert.equal(validateRequest(request), true);
  assert.equal(traitRequest({trait: "Athletics", tn: "8"}, attributes).kind, "skill");
  assert.equal(traitRequest({trait: "Agility", kind: "skill"}, attributes).kind, "skill");
  assert.equal(traitName(" Weird   Science "), "weird science");
});
test("untrained requests include localized native names and retain exact TNs", () => {
  for (const trait of ["Untrained", "unskilled", "Sans compétence"]) assert.equal(traitRequest({trait}, attributes, ["Sans compétence"]).kind, "untrained");
  assert.equal(traitRequest({trait: "Notice", tn: 0}, attributes).targetNumber, 0);
  assert.equal(traitRequest({trait: "Notice", tn: ""}, attributes).targetNumber, 4);
  assert.equal(traitRequest({trait: "Notice", attribute: "spirit"}, attributes).attribute, "spirit");
});
test("invalid request data cannot create nonfinite targets or malformed templates", () => {
  assert.throws(() => traitRequest({trait: " "}, attributes));
  assert.throws(() => traitRequest({trait: "Athletics", tn: "Infinity"}, attributes));
  assert.throws(() => traitRequest({trait: "Athletics", kind: "attribute"}, attributes));
  const valid = traitRequest({trait: "Athletics"}, attributes);
  for (const data of [{...valid, flags: "fire"}, {...valid, recipients: {}}, {...valid, targetNumber: NaN}, {...valid, name: ""}, {...valid, kind: "damage"}]) assert.equal(validateRequest(data), false);
});
test("legacy presets retain names, flags and recipients without overwriting settings edits", () => {
  const request = {...traitRequest({trait: "Athletics", flags: "grapple", tn: 8}, attributes), recipients: ["alice"]};
  const original = [{id: "one", name: "Updated request", request}], legacy = [{id: "one", name: "Old request", request}, {id: "two", name: "Imported request", request}];
  const merged = mergeRequestPresets(original, legacy);
  assert.deepEqual(merged.map(entry => entry.name), ["Updated request", "Imported request"]);
  assert.deepEqual(merged[1].request.recipients, ["alice"]); assert.deepEqual(merged[1].request.flags, ["grapple"]);
  merged[1].request.flags.push("fire"); assert.deepEqual(legacy[1].request.flags, ["grapple"]);
  assert.equal(original.length, 1);
});
test("invalid migration records fail before an old library can be removed", () => {
  assert.throws(() => mergeRequestPresets([], [{id: "one", name: "Broken request", request: {}}]));
});
