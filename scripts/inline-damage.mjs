import {t} from "./i18n.mjs";
import {MODULE_ID} from "./constants.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {damageRoll, isDamageMessage, messageContext, messageSources, setRollContext, traitAdjustment} from "./roll-context.mjs";
import {snapshotDamageFormulas} from "./damage-formulas.mjs";
import {sharedDamageResult} from "./inline-damage-data.mjs";

const text = (key, data) => t(`${MODULE_ID}.InlineDamage.${key}`, data);
const QUERY = `${MODULE_ID}.inlineDamage`;
const RESOLUTION_QUERY = `${MODULE_ID}.damageResolution`;
const pending = new Map();
let toolsOutcome;
let toolsDefense;
export const setInlineAttackOutcome = resolver => { toolsOutcome = resolver; };
export const setInlineDamageDefense = resolver => { toolsDefense = resolver; };
export const inlineDamageDefense = (actor, context) => context.inlineDamage && context.hitLocation ? toolsDefense?.(actor, context.hitLocation) : undefined;

export function resolutionKey(message, token) {
  if (message.damageResolutionKey) return message.damageResolutionKey;
  const id = message.inlineDamageResultId ?? message.getFlag(MODULE_ID, `inlineDamage.${token.id}`)?.id;
  if (id) return id;
  const data = JSON.stringify([damageRoll(message)?.toJSON(), message.flags?.["swade-tools"]?.gmmod]);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `roll-${hash >>> 0}-${data.length}`;
}

export function damageResolution(message, token) {
  const saved = message.getFlag(MODULE_ID, `damageResolutions.${token.id}`);
  return saved?.resultKey === resolutionKey(message, token) ? saved : null;
}

async function saveResolution({messageId, targetUuid, resultKey, state, final}, {user}) {
  const message = game.messages.get(messageId), token = foundry.utils.fromUuidSync(targetUuid);
  if (!message || !token?.actor?.testUserPermission(user, "OWNER") || !["damaged", "soaked", "none"].includes(state)
    || !messageTargets(message, messageContext(message)).some(target => target.uuid === targetUuid)) throw new Error(text("Unavailable"));
  if (resultKey !== resolutionKey(message, token)) return;
  const previous = damageResolution(message, token);
  if (previous?.final) return;
  await message.setFlag(MODULE_ID, `damageResolutions.${token.id}`, {resultKey, state, final: !!final});
}

export async function recordDamageResolution(message, token, state, final = true) {
  token = token?.document ?? token;
  if (!message?.id || !token?.actor) return;
  const request = {messageId: message.id, targetUuid: token.uuid, resultKey: resolutionKey(message, token), state, final};
  if (game.user.isGM || game.messages.get(message.id)?.isOwner) return saveResolution(request, {user: game.user});
  if (game.users.activeGM) return game.users.activeGM.query(RESOLUTION_QUERY, request);
  throw new Error(text("NeedsGM"));
}

export function damageSource(message, context = messageContext(message)) {
  const uuid = context.itemUuid ?? message.flags?.["swade-better-powers"]?.powerCast?.itemUuid
    ?? message.flags?.["swade-hud"]?.powerCast?.itemUuid;
  return (uuid && foundry.utils.fromUuidSync(uuid)) || messageSources(message).item;
}

export function inlineDamageOptions(message, action, preview = false) {
  const item = damageSource(message);
  if (!item) return null;
  const powers = game.modules.get("swade-better-powers")?.api;
  const projected = item.type === "power" && powers?.getPowerDamageOptions?.(message, {action, preview});
  const variant = item.system.actions?.additional?.[action];
  const formula = variant?.type === "damage" && variant.override || item.system.damage;
  if (projected?.hasDamage) return projected;
  return formula?.trim() ? {hasDamage: true, formula, options: {dmgOverride: formula, additionalMods: []}} : null;
}

export function inlineDamageActions(message) {
  const item = damageSource(message);
  if (!item) return [];
  const preferred = message.flags?.["swade-tools"]?.damageaction;
  const actions = ["damage", ...Object.entries(item.system.actions?.additional ?? {}).filter(([, action]) => action.type === "damage").map(([key]) => key)];
  return actions.filter(key => inlineDamageOptions(message, key, true)?.hasDamage)
    .map(key => ({key, name: item.system.actions?.additional?.[key]?.name ?? text("Damage"), preferred: key === preferred}));
}

export function inlineAttackOutcome(message, token) {
  if (isDamageMessage(message)) return {hit: true, raise: false};
  const item = damageSource(message), context = messageContext(message);
  const tools = toolsOutcome?.(message, token);
  if (tools) return tools;
  const roll = damageRoll(message), total = roll?.total + (Number(message.flags?.["swade-tools"]?.gmmod) || 0);
  const melee = item?.type === "weapon" && (context.roll ?? []).includes("melee");
  const tn = message.flags?.["swade-hud"]?.nativeAttack?.targets?.[token.id]?.targetNumber
    ?? (melee ? token.actor?.system.stats?.parry?.value ?? 4 : 4);
  const adjusted = total + traitAdjustment(context, token).value - (context.traitApplied ?? 0);
  return {hit: !roll?.isCritfail && adjusted >= tn, raise: adjusted >= tn + 4};
}

async function save({messageId, targetUuid, targetUuids = [targetUuid], result}, {user}) {
  const message = game.messages.get(messageId), token = foundry.utils.fromUuidSync(targetUuid);
  const item = message && damageSource(message);
  if (!message || !item?.actor?.testUserPermission(user, "OWNER") || !token?.actor
    || !messageTargets(message, messageContext(message)).some(target => target.uuid === targetUuid)) throw new Error(text("Unavailable"));
  if (token.hidden && !user.isGM && !token.testUserPermission(user, "OWNER")) throw new Error(text("Unavailable"));
  if (!user.isGM && (message.blind || message.whisper.length && !message.whisper.includes(user.id) && message.author.id !== user.id)) throw new Error(text("Unavailable"));
  const roll = Roll.fromData(result.roll);
  if (!roll._evaluated || !Number.isFinite(roll.total) || result.context?.actorUuid !== item.actor.uuid
    || result.context?.itemUuid !== item.uuid || result.context?.targetUuids?.length !== 1 || result.context.targetUuids[0] !== targetUuid) throw new Error(text("Unavailable"));
  const allowed = new Map(messageTargets(message, messageContext(message)).map(token => [token.uuid, token]));
  if (!Array.isArray(targetUuids) || !targetUuids.length || targetUuids.some(uuid => !allowed.has(uuid)
    || allowed.get(uuid).hidden && !user.isGM && !allowed.get(uuid).testUserPermission(user, "OWNER"))) throw new Error(text("Unavailable"));
  await message.update(Object.fromEntries([...new Set(targetUuids)].map(uuid =>
    [`flags.${MODULE_ID}.inlineDamage.${allowed.get(uuid).id}`, sharedDamageResult(result, uuid)])));
}

export function inlineDamageMessage(message, targetUuid) {
  const token = foundry.utils.fromUuidSync(targetUuid);
  const saved = token && message.getFlag(MODULE_ID, `inlineDamage.${token.id}`);
  if (!saved || saved.context.targetUuids[0] !== targetUuid) return null;
  const roll = Roll.fromData(saved.roll);
  const context = saved.context;
  return {documentName: "ChatMessage", id: message.id, uuid: message.uuid, author: message.author, speaker: message.speaker,
    visible: message.visible, isContentVisible: message.isContentVisible, whisper: [...message.whisper], blind: message.blind,
    inlineDamageTargetUuid: targetUuid, significantRoll: roll, rolls: [roll],
    inlineDamageResultId: saved.id,
    flags: {[MODULE_ID]: {context}},
    getFlag: (scope, key) => scope === MODULE_ID && key === "context" ? context : scope === "swade" && key === "targets"
      ? [{uuid: targetUuid, name: token.name}] : message.getFlag(scope, key)};
}

export async function rollInlineDamage(message, targetUuid, {allTargets = false, damageAction} = {}) {
  const key = `${message.id}:${allTargets ? "all" : targetUuid}`;
  if (!allTargets && pending.has(`${message.id}:all`)) return pending.get(`${message.id}:all`);
  if (pending.has(key)) return pending.get(key);
  const task = performRoll(message, targetUuid, allTargets, damageAction);
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

async function performRoll(message, targetUuid, allTargets, damageAction) {
  const item = damageSource(message), targets = messageTargets(message, messageContext(message));
  const eligible = targets.filter(target => !damageResolution(message, target));
  const token = allTargets ? eligible.find(token => token.uuid === targetUuid) ?? eligible[0] : eligible.find(token => token.uuid === targetUuid);
  if (message.visible === false || message.isContentVisible === false || !item?.actor?.isOwner || !token?.actor) throw new Error(text("Unavailable"));
  targetUuid = token.uuid;
  const recipients = allTargets ? eligible
    .filter(target => target.actor && (!target.hidden || game.user.isGM || target.isOwner)).map(target => target.uuid) : [targetUuid];
  if (isDamageMessage(message)) {
    const original = damageRoll(message), copy = original.clone();
    const adjustment = Number(message.flags?.["swade-tools"]?.gmmod) || 0;
    if (adjustment) copy.terms.push(new foundry.dice.terms.OperatorTerm({operator: adjustment < 0 ? "-" : "+"}),
      new foundry.dice.terms.NumericTerm({number: Math.abs(adjustment)}));
    const roll = CONFIG.Dice.DamageRoll.fromTerms(copy.terms);
    const context = structuredClone(messageContext(message));
    Object.assign(context, {actorUuid: item.actor.uuid, itemUuid: item.uuid, targetUuids: [targetUuid], inlineDamage: true, rollType: "damage"});
    roll.ap = original.ap; roll.isHeavyWeapon = original.isHeavyWeapon;
    setRollContext(roll, context); await roll.evaluate();
    return persistRoll(message, targetUuid, recipients, roll, context, {});
  }
  let outcome = inlineAttackOutcome(message, token);
  if (outcome.shots?.length > 1) {
    const shot = await foundry.applications.api.DialogV2.wait({window: {title: text("ChooseHit")}, classes: ["sbe-app"], rejectClose: false,
      buttons: outcome.shots.map(hit => ({action: String(hit.shot), label: text("Shot", {number: hit.shot + 1,
        outcome: game.i18n.localize(hit.raise ? "SWADE.Raise" : "SWADE.Success")})}))});
    const selected = outcome.shots.find(hit => String(hit.shot) === String(shot));
    if (!selected) return;
    outcome = {...outcome, ...selected};
  }
  const actions = inlineDamageActions(message);
  let action = actions.find(entry => entry.key === damageAction)?.key ?? actions.find(entry => entry.preferred)?.key ?? actions[0]?.key;
  if (!action) return;
  if (!damageAction && actions.length > 1 && !actions.some(entry => entry.preferred)) {
    action = await foundry.applications.api.DialogV2.wait({window: {title: text("ChooseAction")}, classes: ["sbe-app"], rejectClose: false,
      buttons: actions.map(entry => ({action: entry.key, label: entry.name}))});
    if (!action) return;
  }
  const projection = inlineDamageOptions(message, action, true);
  if (!projection) return;
  const variant = item.system.actions?.additional?.[action];
  const options = projection.options;
  if (item.system.actions?.dmgMod) options.additionalMods.push({label: item.name, value: item.system.actions.dmgMod});
  if (variant?.modifier) options.additionalMods.push({label: variant.name, value: variant.modifier});
  if (outcome.raise) options.additionalMods.push({label: game.i18n.localize("SWADE.BonusDamage"),
    value: `+${item.system.bonusDamageDice ?? 1}d${item.system.bonusDamageDie ?? 6}x`});
  const roll = await item.rollDamage({...options, suppressChat: true, sbeInlineTargetUuid: targetUuid,
    ap: variant?.ap, isHeavyWeapon: variant?.isHeavyWeapon, sbsTargetingAction: action,
    effectFlags: (messageContext(message).roll ?? []).filter(flag => !/^(?:trait|skill|attribute|success|fail|critical-failure|raise-\d+)$/.test(flag))});
  if (!roll) return;
  roll.ap = Number(variant?.ap ?? item.system.ap ?? 0) + (item.actor.system.stats?.globalMods?.ap ?? []).reduce((sum, mod) => sum + Number(mod.value), 0);
  roll.isHeavyWeapon = !!(variant?.isHeavyWeapon || item.system.isHeavyWeapon);
  const context = structuredClone(messageContext({significantRoll: roll, getFlag: () => undefined}));
  context.rollType = "damage"; context.targetUuids = [targetUuid]; context.inlineDamage = true;
  context.hitLocation = message.flags?.["swade-tools"]?.usecalled || "torso";
  context.ap = roll.ap; context.isHeavyWeapon = roll.isHeavyWeapon;
  const snapshot = {flags: {[MODULE_ID]: {context}}, getFlag: () => context,
    updateSource: changes => Object.entries(changes).forEach(([path, value]) => foundry.utils.setProperty(snapshot, path, value))};
  await snapshotDamageFormulas(snapshot);
  setRollContext(roll, snapshot.flags[MODULE_ID].context);
  await roll.evaluate();
  return persistRoll(message, targetUuid, recipients, roll, snapshot.flags[MODULE_ID].context, {action, raise: outcome.raise, shot: outcome.shot});
}

async function persistRoll(message, targetUuid, recipients, roll, context, metadata) {
  const request = {messageId: message.id, targetUuid, targetUuids: recipients, result: {id: foundry.utils.randomID(), roll: roll.toJSON(), context, ...metadata}};
  if (game.user.isGM || message.isOwner) await save(request, {user: game.user});
  else if (game.users.activeGM) await game.users.activeGM.query(QUERY, request);
  else throw new Error(text("NeedsGM"));
  return roll;
}

export function registerInlineDamage() {
  CONFIG.queries[RESOLUTION_QUERY] = (request, context) => {
    if (!game.user.isGM) throw new Error(text("NeedsGM"));
    return saveResolution(request, context);
  };
  CONFIG.queries[QUERY] = (request, context) => {
    if (!game.user.isGM) throw new Error(text("NeedsGM"));
    return save(request, context);
  };
}
