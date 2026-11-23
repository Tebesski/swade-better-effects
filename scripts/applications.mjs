import {t as sbsI18n} from "./i18n.mjs";
import {APPLICATION_KEY, MODULE_ID} from "./constants.mjs";
import {applicationMatches} from "./application-data.mjs";
import {sourceBinding} from "./lingering-opposition.mjs";
import {resolveApplicationMacro} from "./application-config.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {isGear} from "./default-flags.mjs";
import {collectRules, conditionsValid, effectApplicationData} from "./effects.mjs";
import {documentFlags, rollTarget} from "./flags.mjs";
import {immunityMatch} from "./immunity-notices.mjs";
import {resolveOutcomeEffect} from "./lingering-config.mjs";
import {buildRollRequest, postApplicationRequest} from "./requests.mjs";
import {damageRoll, isDamageMessage, isTraitMessage, messageContext, traitAdjustment} from "./roll-context.mjs";
import {criticalFailure} from "./roll-outcomes.mjs";
import {hasCondition, normalizeFlags} from "./rules.mjs";
import {inlineDamageMessage} from "./inline-damage.mjs";

const damageQuery = `${MODULE_ID}.applicationDamage`;
const removalQuery = `${MODULE_ID}.applicationRemove`;
const macroQuery = `${MODULE_ID}.applicationMacro`;
const pendingRemoval = new Set();
const runningMacros = new Set();
const log = error => console.error(`${MODULE_ID} | Application`, error);
const owns = (actor, user) => !!actor && !!user && actor.testUserPermission(user, "OWNER");
const resolve = uuid => typeof uuid === "string" && uuid ? foundry.utils.fromUuidSync(uuid) : null;
let toolsAttackHit;

export function setToolsApplicationAttackHit(test) { toolsAttackHit = test; }

function applicationRules(context, author) {
  const actor = resolve(context.actorUuid);
  if (actor?.documentName !== "Actor" || !owns(actor, author)) return [];
  const resolved = resolve(context.itemUuid);
  const item = resolved?.documentName === "Item" && owns(resolved.actor, author) ? resolved : null;
  const effects = new Set(actor.allApplicableEffects());
  for (const effect of item?.effects ?? []) effects.add(effect);
  const rules = [];
  for (const effect of effects) {
    if (effect.parent !== item && (isGear(effect.parent) || effect.parent?.type === "power")) continue;
    if (!effect.active || !conditionsValid(effect)) continue;
    const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
    for (const [index, change] of effect._source.system.changes.entries()) {
      if (change.key === APPLICATION_KEY && change.type === "add" && change.value && !hasCondition(conditions[index]?.predicate)) {
        rules.push({effect, actor, item, index, rule: change.value});
      }
    }
  }
  return rules;
}

export function hasDamageApplications(message, context = messageContext(message)) {
  return applicationRules(context, message.author).some(({rule}) => ["shaken", "wounds"].includes(rule.condition));
}

function audience(message, target, recipient) {
  const hidden = target.hidden || recipient?.token?.hidden;
  if (!hidden && !message.whisper.length) return [];
  const ids = hidden ? [] : message.whisper.filter(id => !message.blind || game.users.get(id)?.isGM);
  return [...new Set([game.user.id, ...ids, ...game.users.filter(user => user.isGM || owns(recipient?.actor, user)).map(user => user.id)])];
}

function immune(actor, token, context, flags) {
  if (!flags.length) return false;
  const target = rollTarget({}, token, actor).flags;
  const defenderRules = collectRules(actor, undefined, target);
  return !!immunityMatch({context: {...context, roll: flags, target}, defenderRules}, {requireFlag: true});
}

async function askRemove(effect) {
  if (!effect?.isOwner || effect.documentName !== "ActiveEffect" || !effect.actor) return;
  const content = document.createElement("div");
  content.textContent = sbsI18n("swade-better-effects.UI.RemovefromnowthatitsApplication_1dd8460362", {p0: (effect.name), p1: (effect.parent.name)});
  const remove = await foundry.applications.api.DialogV2.confirm({
    window: {title: sbsI18n("swade-better-effects.UI.RemoveonUse_3486d826a6")}, content, rejectClose: false,
    yes: {label: sbsI18n("swade-better-effects.UI.Remove_c3812fc4ac")}, no: {label: sbsI18n("swade-better-effects.UI.Keep_183f00f483"), default: true}
  });
  if (remove && resolve(effect.uuid) === effect) await effect.delete();
}

function promptRemove(message, effect) {
  if (pendingRemoval.has(effect.uuid)) return;
  pendingRemoval.add(effect.uuid);
  const author = message.author;
  const owner = author?.active && effect.testUserPermission(author, "OWNER") ? author : game.user;
  const task = owner.isSelf ? askRemove(effect) : owner.query(removalQuery, {effectUuid: effect.uuid});
  void task.catch(log).finally(() => pendingRemoval.delete(effect.uuid));
}

async function runMacro({messageUuid, tokenUuid, effectUuid, index, attack, shaken, wounds}) {
  const message = resolve(messageUuid);
  if (message?.documentName !== "ChatMessage" || message.author?.id !== game.user.id) return false;
  const target = resolve(tokenUuid);
  if (target?.documentName !== "Token" || !target.actor) return false;
  const context = messageContext(message);
  const entry = applicationRules(context, game.user).find(candidate => candidate.effect.uuid === effectUuid && candidate.index === index);
  const event = {attack, shaken, wounds};
  if (entry?.rule.behaviour !== "macro" || !applicationMatches(entry.rule, event)) return false;
  const macro = await resolveApplicationMacro(entry.rule.macroUuid);
  if (!macro) throw new Error(sbsI18n("swade-better-effects.UI.TheApplicationmacroisunavailableor_d5057c8085"));
  const key = `${effectUuid}:${index}`;
  if (runningMacros.has(key)) return false;
  runningMacros.add(key);
  try {
    const {actor, item, effect} = entry;
    const sourceToken = resolve(context.tokenUuid);
    const flags = normalizeFlags([...documentFlags(effect), ...normalizeFlags(entry.rule.flags)]);
    await macro.execute({actor, token: sourceToken?.object ?? null, sourceToken, item, targetActor: target.actor,
      targetToken: target, effect, message, application: {...event, condition: entry.rule.condition, flags}});
    return true;
  } finally { runningMacros.delete(key); }
}

async function runApplications(message, context, events, rules) {
  const used = new Set();
  for (const {target, ...event} of events) {
    const notes = [];
    for (const {effect, actor, index, rule} of rules) {
      if (!applicationMatches(rule, event)) continue;
      const flags = normalizeFlags([...documentFlags(effect), ...normalizeFlags(rule.flags)]);
      const sourceToken = resolve(context.tokenUuid);
      const source = {actor, token: sourceToken?.actor?.uuid === actor.uuid ? sourceToken : null};
      const defender = {actor: target.actor, token: target};
      const recipients = rule.recipient === "both" ? [defender, source] : [rule.recipient === "source" ? source : defender];
      let ran = false;
      try {
        if (rule.behaviour === "note" && typeof rule.note === "string" && rule.note.trim() && !immune(defender.actor, target, context, flags)) {
          notes.push({label: effect.name, text: rule.note});
          ran = true;
        }
        if (rule.behaviour === "macro" && !immune(defender.actor, target, context, flags)) {
          const execution = {messageUuid: message.uuid, tokenUuid: target.uuid, effectUuid: effect.uuid, index, ...event};
          if (message.author.isSelf) ran = await runMacro(execution);
          else if (message.author.active) ran = await message.author.query(macroQuery, execution);
          else ui.notifications.warn(sbsI18n("swade-better-effects.UI.TheApplicationmacroneedstobe_8db8fc1412", {p0: (message.author.name)}));
        }
        const seen = new Set();
        for (const recipient of recipients) {
          if (!["request", "effect"].includes(rule.behaviour) || !recipient.actor.isOwner || seen.has(recipient.actor.uuid)) continue;
          seen.add(recipient.actor.uuid);
          if (immune(recipient.actor, recipient.token, context, flags)) continue;
          if (rule.behaviour === "request" && ["character", "npc"].includes(recipient.actor.type)) {
            await postApplicationRequest(buildRollRequest({...rule, flags}), {...recipient, name: effect.name,
              whisper: audience(message, target, recipient)});
            ran = true;
          } else if (rule.behaviour === "effect") {
            const reference = await resolveOutcomeEffect(rule.effectUuid);
            if (!reference?.source.testUserPermission(message.author, "LIMITED")) throw new Error(sbsI18n("swade-better-effects.UI.Thelinkedeffectisunavailable_93b251ef57"));
            const applicable = reference.effects.filter(source => !immune(recipient.actor, recipient.token, context, [...flags, ...documentFlags(source), ...source.statuses]));
            if (!applicable.length) continue;
            const effects = await recipient.actor.createEmbeddedDocuments("ActiveEffect",
              applicable.map(effect => ({...effectApplicationData(effect, reference.source.uuid, sourceBinding(actor, sourceToken)), disabled: false})));
            ran ||= effects.length > 0;
          }
        }
      } catch (error) { log(error); }
      if (ran && rule.removeOnUse) used.add(effect);
    }
    if (notes.length) {
      const escape = foundry.utils.escapeHTML;
      const content = `<section class="sbe-roll-notes"><strong>${escape(target.name)}</strong>${notes.map(({label, text}) =>
        `<div class="sbe-roll-note"><strong class="sbe-roll-note-label">${escape(label)}</strong><p class="sbe-roll-note-body">${escape(text).replace(/\r\n?|\n/g, `<br>`)}</p></div>`).join("")}</section>`;
      const whisper = audience(message, target);
      await CONFIG.ChatMessage.documentClass.create({content, speaker: {alias: sbsI18n("swade-better-effects.UI.Application_e7ad522ea3")}, whisper}, {messageMode: whisper.length ? "gm" : "public"});
    }
  }
  for (const effect of used) promptRemove(message, effect);
}

function successfulAttack(message, context, target) {
  const roll = damageRoll(message);
  if (criticalFailure(roll)) return false;
  const tools = toolsAttackHit?.(message, target);
  if (typeof tools === "boolean") return tools;
  const adjustment = traitAdjustment(context, target).value - (context.traitApplied ?? 0)
    + (Number(message.flags?.["swade-tools"]?.gmmod) || 0);
  const tn = context.roll.includes("melee") ? target.actor.system.stats?.parry?.value ?? 4 : roll.targetNumber ?? 4;
  if (!Number.isFinite(roll.total)) return false;
  const pool = roll.terms[0];
  if (!roll.isValidTraitRoll || !pool?.results?.length) return roll.total + adjustment >= tn;
  const modifier = roll.total - pool.total + adjustment;
  return pool.results.some(result => result.active !== false && !result.discarded && result.result + modifier >= tn);
}

async function onAttack(message) {
  const gm = game.users.activeGM;
  const coordinator = gm && (!message.whisper.length || message.whisper.includes(gm.id)) ? gm : message.author;
  if (game.user.id !== coordinator?.id || !message.isContentVisible || !isTraitMessage(message)) return;
  const context = messageContext(message);
  if (!context.roll.includes("attack") || context.request || context.opposition) return;
  const rules = applicationRules(context, message.author).filter(({rule}) => rule.condition === "attack");
  if (!rules.length) return;
  const events = messageTargets(message, context).filter(target => target.actor && successfulAttack(message, context, target))
    .map(target => ({target, attack: true}));
  await runApplications(message, context, events, rules);
}

async function onDamage({messageUuid, tokenUuid, shaken, wounds, inlineTargetUuid}, {user}) {
  let message = resolve(messageUuid);
  if (inlineTargetUuid && inlineTargetUuid === tokenUuid && message) message = inlineDamageMessage(message, tokenUuid);
  const target = resolve(tokenUuid);
  if (message?.documentName !== "ChatMessage" || target?.documentName !== "Token" || !owns(target.actor, user) || !isDamageMessage(message)) return;
  const context = messageContext(message);
  const rules = applicationRules(context, message.author);
  const event = {target, shaken: shaken === true && target.actor.statuses.has("shaken"),
    wounds: Number.isSafeInteger(wounds) && wounds > 0 && (target.actor.system.wounds.value >= wounds || target.actor.statuses.has("incapacitated")) ? wounds : 0};
  await runApplications(message, context, [event], rules);
}

export async function damageApplied(message, token, {shaken, wounds}) {
  if (!shaken && !wounds) return;
  const gm = game.users.activeGM;
  const event = {messageUuid: message.uuid, tokenUuid: (token.document ?? token).uuid, shaken, wounds, inlineTargetUuid: message.inlineDamageTargetUuid};
  try {
    if (gm && !gm.isSelf) await gm.query(damageQuery, event);
    else await onDamage(event, {user: game.user});
  } catch (error) { log(error); }
}

export function registerApplications() {
  CONFIG.queries[damageQuery] = (data, context) => {
    if (game.user.isGM) return onDamage(data, context);
  };
  CONFIG.queries[removalQuery] = ({effectUuid}, {user}) => {
    if (user.isGM) return askRemove(resolve(effectUuid));
  };
  CONFIG.queries[macroQuery] = (data, {user}) => {
    if (user.isGM) return runMacro(data);
  };
  Hooks.on("createChatMessage", message => { void onAttack(message).catch(log); });
}
