import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID} from "./constants.mjs";
import {collectRollNotes, collectRules, wrapMethod} from "./effects.mjs";
import {documentFlags, rememberFlags, rollTarget} from "./flags.mjs";
import {normalizeFlags, resolveTrait} from "./rules.mjs";
import {hudActionFlag, rollCategoryFlags} from "./default-flags.mjs";
import {withOpposition} from "./opposed-context.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {resolveRollNotes} from "./note-rules.mjs";
import {cleanRollNote} from "./roll-notes.mjs";
import {criticalFailure, withRollOutcome} from "./roll-outcomes.mjs";
import {applyDamageFormula, sharedDamageRules, snapshotDamageFormulas} from "./damage-formulas.mjs";

function actorToken(actor) {
  return actor?.token ?? actor?.getActiveTokens?.(false, true)?.find(t => t.object?.controlled) ?? actor?.getActiveTokens?.(false, true)?.[0];
}

export function makeContext(actor, item, flags = [], options = {}) {
  const token = options.token?.document ?? options.token ?? actorToken(actor);
  const attackerFlags = normalizeFlags([...documentFlags(actor, token), ...documentFlags(token)]);
  const itemFlags = documentFlags(item);
  return {version: 1, hasRoll: true, roll: normalizeFlags([...flags, ...attackerFlags, ...itemFlags, ...rollCategoryFlags(item, options)]), attacker: attackerFlags, item: itemFlags,
    attribute: options.attribute ?? options.skill?.system?.attribute, rollType: options.kind ?? "damage",
    skill: options.skill ? {id: options.skill.id ?? null, name: options.skill.name ?? String(options.skill), modifier: Number(options.skill.system?.die?.modifier ?? 0)} : null,
    attributeModifier: Number(actor?.system.attributes?.[options.attribute]?.die?.modifier ?? 0),
    actorUuid: actor?.uuid ?? null, tokenUuid: token?.uuid ?? null, itemUuid: item?.uuid ?? null,
    targetUuids: [...(game.user.targets ?? [])].map(target => target.document.uuid),
    attackerRules: collectRules(actor, item).map(rule => ({...rule, ownerFlags: attackerFlags})),
    attackerNotes: collectRollNotes(actor, item).map(note => ({...note, ownerFlags: attackerFlags}))};
}

export function snapshotRollNotes(context, message) {
  if (Array.isArray(context.notes)) return context;
  const tokens = context.opposition ? (context.opposition.tokenUuid ? [foundry.utils.fromUuidSync(context.opposition.tokenUuid)].filter(Boolean) : [])
    : messageTargets(message, context);
  const targets = tokens.map(token => {
    const {flags} = rollTarget(context, token);
    return {uuid: token.uuid, name: token.name, flags,
      notes: collectRollNotes(token.actor).map(note => ({...note, ownerFlags: flags}))};
  });
  context.notes = resolveRollNotes({context, attackerNotes: context.attackerNotes, targets})
    .map(note => ({...note, html: cleanRollNote(note.html, {publicContent: true})}));
  const description = context.request?.description;
  if (typeof description === "string" && description.trim()) {
    context.notes.unshift({label: sbsI18n("swade-better-effects.UI.Description_526e0087cc"), html: foundry.utils.escapeHTML(description).replace(/\r\n?|\n/g, `<br>`)});
  }
  delete context.attackerNotes;
  return context;
}

const nativeDamage = new WeakMap();

export function tagRoll(roll, flags, {actor, item, token, targetUuids, deferDamage = false} = {}) {
  const context = makeContext(actor, item, flags, {token});
  context.rollType = "damage";
  if (targetUuids) context.targetUuids = targetUuids;
  if (deferDamage && roll.terms[0]) nativeDamage.set(roll.terms[0], context);
  const applied = !deferDamage && !roll._evaluated ? applyDamageFormula(roll, context, sharedDamageRules(context), roll.acing) : context;
  return setRollContext(roll, applied);
}

export function setRollContext(roll, context) {
  context = structuredClone(context);
  roll.options[MODULE_ID] = context;
  // SWADE's RollDialog rebuilds rolls from their terms, discarding Roll.options. Term options survive that rebuild.
  if (roll.terms[0]) roll.terms[0].options[MODULE_ID] = structuredClone(context);
  // SWADE Tools copies the dice options, rather than the enclosing PoolTerm options, on rerolls.
  for (const die of roll.terms[0]?.dice ?? []) die.options[MODULE_ID] = structuredClone(context);
  return roll;
}

export function damageRoll(message) { return message.significantRoll ?? message.rolls?.at(-1); }

export function isDamageMessage(message) {
  const roll = damageRoll(message);
  return !!roll && (roll.options?.rollType === "damage" || message.flags?.["swade-tools"]?.rolltype === "damage"
    || message.getFlag(MODULE_ID, "context")?.rollType === "damage" || fromTerms(roll.terms)?.rollType === "damage");
}

export function isTraitMessage(message) {
  const roll = damageRoll(message);
  return !!roll && (roll.options?.rollType === "trait" || ["skill", "attribute"].includes(message.flags?.["swade-tools"]?.rolltype)
    || message.getFlag(MODULE_ID, "context")?.rollType === "trait" || fromTerms(roll.terms)?.rollType === "trait");
}

export function traitAdjustment(context, token, {includeDefender = true} = {}) {
  const actor = token?.actor;
  const {flags: target} = rollTarget(context, token);
  return resolveTrait({context: {...context, target}, attackerRules: context.attackerRules ?? [],
    defenderRules: includeDefender ? collectRules(actor).map(rule => ({...rule, ownerFlags: target})) : []});
}

export function messageSources(message) {
  const tools = message.flags?.["swade-tools"];
  const tokenId = tools?.usevehicletoken ?? tools?.usetoken ?? message.speaker?.token;
  const scene = game.scenes?.get(message.speaker?.scene) ?? canvas.scene;
  const actor = scene?.tokens.get(tokenId)?.actor ?? game.actors.get(tools?.usevehicle ?? tools?.useactor) ?? message.speakerActor;
  return {actor, item: actor?.items.get(tools?.itemroll)};
}

export function damageAP(message) {
  const roll = damageRoll(message);
  if (roll?.ap !== undefined) return roll.ap;
  const savedAP = messageContext(message).ap;
  if (Number.isFinite(savedAP)) return savedAP;
  const {actor, item} = messageSources(message);
  const action = item?.system.actions?.additional?.[message.flags?.["swade-tools"]?.useaction];
  const ap = Number(action?.ap ?? item?.system.ap ?? 0);
  return Math.max(0, ap + (actor?.system.stats?.globalMods.ap ?? []).reduce((sum, mod) => sum + Number(mod.value), 0));
}

export function damageIsHeavyWeapon(message) {
  return damageRoll(message)?.isHeavyWeapon ?? messageContext(message).isHeavyWeapon ?? messageSources(message).item?.system.isHeavyWeapon ?? false;
}

function fromTerms(terms) {
  for (const term of terms ?? []) {
    if (term.options?.[MODULE_ID]) return term.options[MODULE_ID];
    const nested = fromTerms(term.roll?.terms) ?? (term.rolls ?? []).map(r => fromTerms(r.terms)).find(Boolean);
    if (nested) return nested;
  }
}

export function messageContext(message) {
  const roll = damageRoll(message);
  const saved = message.getFlag(MODULE_ID, "context") ?? roll?.options?.[MODULE_ID] ?? fromTerms(roll?.terms);
  if (saved) return outcomeContext(message, saved);
  const {actor, item} = messageSources(message);
  const tools = message.flags?.["swade-tools"];
  const skill = actor?.items.find(i => i.type === "skill" && i.name === tools?.skill);
  return outcomeContext(message, makeContext(actor, item, [], {kind: isTraitMessage(message) ? "trait" : "damage", skill, attribute: tools?.attribute}));
}

function outcomeContext(message, context) {
  if (isDamageMessage(message) || !isTraitMessage(message)) return context;
  const roll = damageRoll(message);
  const total = roll?.total;
  if (!Number.isFinite(total)) return context;
  const adjustment = Number(message.flags?.["swade-tools"]?.gmmod ?? 0);
  const targetNumber = context.opposition?.targetNumber ?? context.response?.targetNumber ?? context.request?.targetNumber ?? roll.targetNumber ?? roll.options?.targetNumber ?? 4;
  return withRollOutcome(context, {total: total + adjustment, targetNumber, criticalFailure: criticalFailure(roll)});
}

export function registerRollHooks() {
  // Document creation awaits this workflow after preCreateChatMessage snapshots
  // the rules. Every client and target then uses the same rolled values.
  wrapMethod(CONFIG.ChatMessage.documentClass, "_preCreateOperation", async function (original, messages, ...args) {
    const allowed = await original(messages, ...args);
    if (allowed !== false) await Promise.all(messages.map(snapshotDamageFormulas));
    return allowed;
  });
  Hooks.on("updateChatMessage", message => { if (isTraitMessage(message)) rememberFlags(messageContext(message).roll); });
  wrapMethod(CONFIG.Dice.DamageRoll, "fromTerms", function (original, terms, ...args) {
    const context = nativeDamage.get(terms[0]);
    const roll = original(terms, ...args);
    if (!context) return roll;
    const updated = {...context, targetUuids: [...game.user.targets].map(target => target.document.uuid)};
    const rules = sharedDamageRules(updated);
    return rules.length ? setRollContext(roll, applyDamageFormula(roll, updated, rules)) : roll;
  });
  Hooks.on("swadeRollDamage", (actor, item, roll, _modifiers, options) =>
    tagRoll(roll, options?.effectFlags ?? [], {actor, item, deferDamage: true}));
  const trait = (actor, skillOrAttribute, roll, modifiers, options, isAttribute) => {
    const flags = [...(options.effectFlags ?? [])];
    flags.push(hudActionFlag(options.item, game.combat?.started));
    if (modifiers.some(mod => mod.label === "SWADE.GangUp" || mod.label === game.i18n.localize("SWADE.GangUp"))) flags.push("gang-up");
    const tokenUuid = options.sbeOpposition?.defenderUuid ?? options.sbeResponse?.defenderUuid ?? options.sbeRequest?.tokenUuid ?? options.sbeLingeringSource?.tokenUuid;
    const defender = tokenUuid ? foundry.utils.fromUuidSync(tokenUuid) : null;
    const context = withOpposition(makeContext(actor, options.item, flags, {kind: "trait", token: defender, skill: isAttribute ? null : skillOrAttribute,
      attribute: isAttribute ? skillOrAttribute : skillOrAttribute.system.attribute}), options.sbeOpposition);
    if (options.sbeRequest) { context.request = structuredClone(options.sbeRequest); roll.targetNumber = options.sbeRequest.targetNumber; }
    if (options.sbeResponse) { context.response = structuredClone(options.sbeResponse); roll.targetNumber = options.sbeResponse.targetNumber; }
    const lingeringOpposition = options.sbeRequest?.opposition;
    if (lingeringOpposition) {
      context.opposed = lingeringOpposition.flags;
      context.rollKinds = normalizeFlags([...rollCategoryFlags(options.item, {kind: "trait", skill: isAttribute ? null : skillOrAttribute}), "opposed"]);
    }
    const opponent = context.opposition;
    const originalActor = opponent?.actorUuid ? foundry.utils.fromUuidSync(opponent.actorUuid) : null;
    const untargeted = options.sbeRequest?.lingering || options.sbeRequest?.application || options.sbeResponse;
    let target = untargeted ? null : opponent ? (opponent.tokenUuid ? foundry.utils.fromUuidSync(opponent.tokenUuid) : null)
      ?? (originalActor ? {actor: originalActor, document: originalActor, uuid: originalActor.uuid} : null) : game.user.targets.first()?.document;
    const opposing = options.sbeLingeringSource ?? lingeringOpposition;
    if (opposing) {
      const uuid = options.sbeLingeringSource ? opposing.targetUuid : opposing.tokenUuid;
      const actorUuid = options.sbeLingeringSource ? opposing.targetActorUuid : opposing.actorUuid;
      target = (uuid ? foundry.utils.fromUuidSync(uuid) : null) ?? (actorUuid ? {actor: foundry.utils.fromUuidSync(actorUuid)} : null);
    }
    if (opponent) roll.targetNumber = opponent.targetNumber;
    if (untargeted) context.targetUuids = [];
    if (options.sbeLingeringSource) context.targetUuids = options.sbeLingeringSource.targetUuid ? [options.sbeLingeringSource.targetUuid] : [];
    const result = traitAdjustment(context, target);
    modifiers.push(...result.applied);
    if (options.sbeLingeringSource) {
      // Native suppressChat serializes every modifier, including ignored ones.
      for (let i = modifiers.length - 1; i >= 0; i--) if (modifiers[i].ignore) modifiers.splice(i, 1);
    }
    context.traitApplied = result.value;
    context.traitTargetUuid = target?.uuid ?? null;
    setRollContext(roll, context);
  };
  Hooks.on("swadePreRollSkill", (actor, skill, roll, modifiers, options) => trait(actor, skill, roll, modifiers, options, false));
  Hooks.on("swadePreRollAttribute", (actor, attribute, roll, modifiers, options) => trait(actor, attribute, roll, modifiers, options, true));
  Hooks.on("preCreateChatMessage", message => {
    const damage = isDamageMessage(message);
    if (!damage && !isTraitMessage(message)) return;
    const context = structuredClone(messageContext(message));
    context.rollType = damage ? "damage" : "trait";
    if (damage) { context.ap = damageAP(message); context.isHeavyWeapon = damageIsHeavyWeapon(message); }
    context.roll = normalizeFlags(context.roll);
    if (context.opposition) {
      const opposition = context.opposition;
      const token = opposition.tokenUuid ? foundry.utils.fromUuidSync(opposition.tokenUuid) : null;
      message.updateSource({"flags.swade.targets": token ? [{uuid: token.uuid, name: token.name}] : []});
      if (opposition.whisper?.length) message.updateSource({whisper: opposition.whisper, blind: !!opposition.blind});
    }
    if (context.response) {
      context.targetUuids = [];
      message.updateSource({"flags.swade.targets": []});
      if (context.response.whisper?.length) message.updateSource({whisper: context.response.whisper, blind: !!context.response.blind});
    }
    if (context.request?.whisper?.length) message.updateSource({whisper: context.request.whisper, blind: false});
    if (context.request?.lingering) {
      message.updateSource({whisper: [], blind: false, style: CONST.CHAT_MESSAGE_STYLES.OTHER});
    }
    if (context.request?.lingering || context.request?.application || context.lingeringDamage) {
      const targets = (context.targetUuids ?? []).map(uuid => foundry.utils.fromUuidSync(uuid)).filter(Boolean);
      message.updateSource({"flags.swade.targets": targets.map(token => ({uuid: token.uuid, name: token.name}))});
    }
    snapshotRollNotes(context, message);
    message.updateSource({[`flags.${MODULE_ID}.context`]: context});
  });
}

