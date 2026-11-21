import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID} from "./constants.mjs";
import {documentFlags} from "./flags.mjs";
import {effectApplicationData, wrapMethod} from "./effects.mjs";
import {buildRollRequest, postLingeringRequest} from "./requests.mjs";
import {damageRoll, isTraitMessage, makeContext, messageContext} from "./roll-context.mjs";
import {opposedResult} from "./opposed-context.mjs";
import {criticalFailure} from "./roll-outcomes.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";
import {lingeringConfig, lingeringOutcome, resolveOutcomeEffect} from "./lingering-config.mjs";
import {normalizeFlag} from "./rules.mjs";
import {LINGERING_APPLIED_TURN, LINGERING_PARENT, isApplicationTurn, outcomeEffects} from "./lingering-effects.mjs";
import {inferLingeringSource, rollLingeringOpposition} from "./lingering-opposition.mjs";

const pending = new Map();
const stateKey = "lingeringState";
const markerKey = "lingeringProgress";
const resultQuery = `${MODULE_ID}.lingeringResult`;

export async function lingeringRollAction(message, action) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error(sbsI18n("swade-better-effects.UI.AconnectedGMisneededto_052ba0a3c7"));
  const data = {messageUuid: message.uuid, action};
  return gm.isSelf ? handleRollAction(data, {user: game.user}) : gm.query(resultQuery, data);
}

async function handleRollAction({messageUuid, action}, {user}) {
  if (!game.user.isActiveGM) return;
  const message = foundry.utils.fromUuidSync(messageUuid);
  if (!message || !isTraitMessage(message)) throw new Error(sbsI18n("swade-better-effects.UI.Thislingeringrollisunavailable_c2973dcb60"));
  const context = messageContext(message);
  const request = foundry.utils.fromUuidSync(context.request?.messageUuid ?? "");
  const data = request?.getFlag(MODULE_ID, "lingeringRequest");
  if (!context.request?.lingering || !data || !request.author?.isGM) throw new Error(sbsI18n("swade-better-effects.UI.Invalidlingeringrequest_5247db74cf"));
  return enqueue(data.effectUuid, async () => {
    const effect = foundry.utils.fromUuidSync(data.effectUuid);
    const state = effect?.getFlag(MODULE_ID, stateKey);
    if (!effect?.modifiesActor || !effect.actor.testUserPermission(user, "OWNER")
      || state?.requestId !== request.id || state.resultUuid !== message.uuid) throw new Error(sbsI18n("swade-better-effects.UI.Thislingeringresultisnolonger_ca45cdd036"));
    if (action === "apply" && !state.rerollPending && !state.resolved) {
      await resolveRequest(message, context, request, data);
      return true;
    }
    if (action === "reroll" && !state.rerollPending) {
      await effect.setFlag(MODULE_ID, stateKey, {...state, rerollPending: true});
      return true;
    }
    if (action === "cancel" && state.rerollPending) {
      await effect.setFlag(MODULE_ID, stateKey, {...state, rerollPending: false});
      return true;
    }
    throw new Error(sbsI18n("swade-better-effects.UI.Thislingeringresultisbusy_f8fc30d4f9"));
  });
}

function enqueue(effectUuid, work) {
  const task = (pending.get(effectUuid) ?? Promise.resolve()).then(work)
    .catch(error => console.error(`${MODULE_ID} | Lingering effect`, error))
    .finally(() => { if (pending.get(effectUuid) === task) pending.delete(effectUuid); });
  pending.set(effectUuid, task);
  return task;
}

async function requestAtTurn(combat, combatant, timing, turn) {
  if (!combatant?.actor || combatant.isDefeated || turn?.skipped || !turn?.round) return;
  const actor = combatant.actor;
  if (!actor.system.attributes) return;
  const turnKey = `${combat.id}:${combatant.id}:${turn.round}:${turn.turn}:${timing}`;
  for (const candidate of [...actor.allApplicableEffects()]) {
    if (!candidate.modifiesActor || !candidate.getFlag(MODULE_ID, "lingering")?.enabled) continue;
    await enqueue(candidate.uuid, async () => {
      const effect = foundry.utils.fromUuidSync(candidate.uuid);
      if (!effect?.modifiesActor) return;
      const config = lingeringConfig(effect.getFlag(MODULE_ID, "lingering"));
      if (!config.enabled || config.timing !== timing) return;
      // Only skip the turn during which this actor received the effect.
      // An effect applied during another actor's turn may request on the next
      // turn of its owner, including later in the same round.
      const applied = effect.getFlag(MODULE_ID, LINGERING_APPLIED_TURN) ?? effect.start;
      if (config.followingTurns && isApplicationTurn(applied, combat, combatant, turn)) return;
      const stored = effect.getFlag(MODULE_ID, stateKey);
      const state = stored?.effectUuid === effect.uuid ? stored : null;
      if (state?.turnKey === turnKey || state?.rerollPending || (state?.requestId && !state.resolved && game.messages.has(state.requestId))) return;
      const opposition = config.tnMode === "opposed" ? await rollLingeringOpposition(effect, config, combatant.token) : null;
      if (config.tnMode === "opposed" && !opposition) return;
      // The source roll may take time. Recheck that the parent still applies.
      if (!foundry.utils.fromUuidSync(effect.uuid)?.modifiesActor) return;
      const request = buildRollRequest({trait: config.trait, tn: opposition?.total ?? config.tn,
        modifier: config.modifier, flags: documentFlags(effect), allowFormula: true});
      const requestId = foundry.utils.randomID();
      await effect.setFlag(MODULE_ID, stateKey, {effectUuid: effect.uuid, requestId, turnKey, resolved: false,
        resultUuid: null, rerollPending: false, appliedUuids: [], attemptProgress: state?.progress ?? 0,
        progress: state?.progress ?? 0});
      const token = combatant.token;
      const progress = config.required > 1 ? ` · ${state?.progress ?? 0}/${config.required} successes` : "";
      const name = `${token?.name ?? actor.name} · ${effect.name}${progress}`;
      try {
        const posted = await postLingeringRequest(request, {effectUuid: effect.uuid, tokenUuid: token?.uuid ?? null, opposition},
          {id: requestId, name});
        if (!posted) throw new Error(sbsI18n("swade-better-effects.UI.Thelingeringrequestwasnotcreated_50dca9174e"));
      } catch (error) {
        if (state) await effect.setFlag(MODULE_ID, stateKey, state);
        else await effect.unsetFlag(MODULE_ID, stateKey);
        throw error;
      }
    });
  }
}

async function progressMarker(effect, progress, required) {
  const actor = effect.actor;
  const existing = actor.effects.find(marker => marker.getFlag(MODULE_ID, markerKey) === effect.uuid);
  const name = `${effect.name} · ${progress}/${required} successes`;
  const excludedTags = [normalizeFlag(name)];
  if (existing) return existing.update({name, [`flags.${MODULE_ID}.excludedTags`]: excludedTags});
  return actor.createEmbeddedDocuments("ActiveEffect", [{name, img: effect.img, origin: effect.uuid,
    transfer: false, flags: {[MODULE_ID]: {[markerKey]: effect.uuid, excludedTags}}}]);
}

async function removeProgress(effect) {
  const actor = effect.actor;
  const markers = actor?.effects.filter(marker => marker.getFlag(MODULE_ID, markerKey) === effect.uuid);
  if (markers?.length) await actor.deleteEmbeddedDocuments("ActiveEffect", markers.map(marker => marker.id));
}

async function removeDependentEffects(effect) {
  const actor = effect.actor;
  const children = actor?.effects.filter(child => child.getFlag(MODULE_ID, LINGERING_PARENT) === effect.uuid);
  if (children?.length) await actor.deleteEmbeddedDocuments("ActiveEffect", children.map(child => child.id));
}

async function resolveRequest(message, context, request, data) {
  const effect = foundry.utils.fromUuidSync(data.effectUuid);
  const actor = effect?.actor;
  const state = effect?.getFlag(MODULE_ID, stateKey);
  if (!effect?.modifiesActor || state?.requestId !== request.id || state.resolved ||
    context.request.actorUuid !== actor.uuid || context.actorUuid !== actor.uuid ||
    !message.author || !actor.testUserPermission(message.author, "OWNER")) return;
  const config = lingeringConfig(effect.getFlag(MODULE_ID, "lingering"));
  if (!config.enabled) return;
  const roll = damageRoll(message);
  const total = roll?.total;
  if (!Number.isFinite(total)) return;
  let critical = criticalFailure(roll);
  // An Extra's single die showing 1 requires SWADE's confirmation roll.
  if (critical && roll.isValidTraitRoll && !actor.isWildcard && !roll.groupRoll && roll.terms[0].dice.length === 1) {
    const confirmation = message.rolls.find(die => die.isCritFailConfirmationRoll);
    if (!confirmation) return;
    critical = confirmation.total === 1;
  }
  const result = opposedResult(total, request.getFlag(MODULE_ID, "rollRequest").targetNumber, critical);
  const outcome = lingeringOutcome(config, result);
  const progress = (state.attemptProgress ?? state.progress) + outcome.progress;
  const ended = progress >= config.required;
  const token = data.tokenUuid ? foundry.utils.fromUuidSync(data.tokenUuid) : null;
  const summary = {result, text: outcome.message, ended: ended ? `${effect.name} ends on ${token?.name ?? actor.name}.` : ""};
  if (outcome.damage && isDamageFormula(outcome.damage)) {
    const damage = new CONFIG.Dice.DamageRoll(outcome.damage, {}, {rerollable: false, ap: 0});
    await damage.evaluate();
    const targetUuids = token ? [token.uuid] : [];
    const flags = request.getFlag(MODULE_ID, "rollRequest").flags;
    summary.damage = {roll: damage.toJSON(), context: {...makeContext(null, null, flags), targetUuids}};
  }

  // A reroll replaces this turn's outcome, including any effects it granted.
  const previousEffects = (state.appliedUuids ?? []).map(uuid => foundry.utils.fromUuidSync(uuid)).filter(Boolean);
  for (const previous of previousEffects) await previous.delete();
  const appliedUuids = [];
  await effect.setFlag(MODULE_ID, stateKey, {...state, resolved: true, progress, appliedUuids});
  await request.update({[`flags.${MODULE_ID}.lingeringRequest.resolved`]: true}).catch(error => console.error(`${MODULE_ID} | Lingering request card`, error));
  for (const entry of outcomeEffects(outcome)) {
    try {
      const reference = await resolveOutcomeEffect(entry.uuid);
      if (!reference) throw new Error(sbsI18n("swade-better-effects.UI.Thelinkedeffectisunavailable_93b251ef57"));
      // Apply a fresh copy, including duration and flags, even if the source was disabled.
      const applied = await actor.createEmbeddedDocuments("ActiveEffect", reference.effects.map(source => {
        const data = {...effectApplicationData(source, reference.source.uuid), disabled: false};
        const binding = inferLingeringSource(effect);
        if (binding) data.flags[MODULE_ID].lingeringSource = binding;
        // Copies must never inherit a dependency belonging to the source.
        delete data.flags[MODULE_ID][LINGERING_PARENT];
        if (entry.removeWithParent) data.flags[MODULE_ID][LINGERING_PARENT] = effect.uuid;
        return data;
      }));
      if (!applied.length) throw new Error(sbsI18n("swade-better-effects.UI.Nolinkedeffectswerecreated_dee8e541bf"));
      appliedUuids.push(...applied.map(effect => effect.uuid));
      summary.applied = [...(summary.applied ?? []), ...applied.map(effect => effect.name)];
      if (entry.removeWithParent && !foundry.utils.fromUuidSync(effect.uuid)?.modifiesActor) await removeDependentEffects(effect);
    } catch (error) {
      summary.effectError = "The linked effect could not be applied.";
      console.error(`${MODULE_ID} | Lingering outcome effect`, error);
    }
  }
  await effect.setFlag(MODULE_ID, `${stateKey}.appliedUuids`, appliedUuids);
  if (ended) {
    await removeProgress(effect);
    await removeDependentEffects(effect);
    if (effect.parent === actor) await effect.delete();
    else await effect.update({disabled: true, [`flags.${MODULE_ID}.-=${stateKey}`]: null});
  } else if (config.required > 1) {
    if (progress) await progressMarker(effect, progress, config.required);
    else await removeProgress(effect);
  }
  await message.update({[`flags.${MODULE_ID}.lingeringResult`]: summary});
}

export function registerLingeringEffects() {
  CONFIG.queries[resultQuery] = handleRollAction;
  const appliedTurn = () => CONFIG.ActiveEffect.documentClass.getEffectStart();
  Hooks.on("preCreateActiveEffect", effect => {
    if (effect.actor) {
      const source = inferLingeringSource(effect);
      effect.updateSource({[`flags.${MODULE_ID}.${LINGERING_APPLIED_TURN}`]: appliedTurn(),
        ...(source ? {[`flags.${MODULE_ID}.lingeringSource`]: source} : {})});
    }
  });
  Hooks.on("preCreateItem", item => {
    if (!item.actor) return;
    const turn = appliedTurn();
    item.updateSource({effects: item.toObject().effects.map(effect => ({
      ...effect, flags: {...effect.flags, [MODULE_ID]: {...effect.flags?.[MODULE_ID], [LINGERING_APPLIED_TURN]: turn}}
    }))});
  });
  Hooks.on("preUpdateActiveEffect", (effect, changes) => {
    if (effect.actor && effect.disabled && changes.disabled === false) {
      foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${LINGERING_APPLIED_TURN}`, appliedTurn());
    }
  });
  const combat = CONFIG.Combat.documentClass.prototype;
  for (const [method, timing] of [[sbsI18n("swade-better-effects.UI.onStartTurn_8f03cb50a2"), "start"], [sbsI18n("swade-better-effects.UI.onEndTurn_c409272c74"), "end"]]) {
    wrapMethod(combat, method, async function (original, combatant, turn) {
      await original(combatant, turn);
      void requestAtTurn(this, combatant, timing, turn)
        .catch(error => console.error(`${MODULE_ID} | Lingering turn request`, error));
    });
  }
  function evaluateRequest(message) {
    if (!game.user.isActiveGM || !isTraitMessage(message) || !message.isContentVisible) return;
    const context = messageContext(message);
    if (!context.request?.lingering) return;
    const request = foundry.utils.fromUuidSync(context.request.messageUuid);
    const data = request?.getFlag(MODULE_ID, "lingeringRequest");
    if (!data || !request.author?.isGM || !request.getFlag(MODULE_ID, "rollRequest")) return;
    void enqueue(data.effectUuid, async () => {
      const effect = foundry.utils.fromUuidSync(data.effectUuid);
      const state = effect?.getFlag(MODULE_ID, stateKey);
      if (!effect?.modifiesActor || state?.requestId !== request.id || (state.resolved && !state.rerollPending)
        || context.actorUuid !== effect.actor.uuid || context.request.actorUuid !== effect.actor.uuid
        || !effect.actor.testUserPermission(message.author, "OWNER")) return;
      if (state.resultUuid && state.resultUuid !== message.uuid && !state.rerollPending) return;
      await effect.setFlag(MODULE_ID, stateKey, {...state, resultUuid: message.uuid, rerollPending: false, resolved: false});
      // Refresh the result card after the GM accepts it as the current attempt.
      await message.setFlag(MODULE_ID, "lingeringReady", true);
      await resolveRequest(message, context, request, data);
    });
  }
  Hooks.on("createChatMessage", evaluateRequest);
  Hooks.on("updateChatMessage", (message, changes) => { if (changes.rolls) evaluateRequest(message); });
  Hooks.on("deleteActiveEffect", effect => {
    if (game.user.isActiveGM) void enqueue(effect.uuid, async () => {
      await removeProgress(effect);
      await removeDependentEffects(effect);
    });
  });
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (!game.user.isActiveGM) return;
    if (changes.disabled === true || changes.duration?.expired === true || changes["duration.expired"] === true
      || effect.getFlag(MODULE_ID, stateKey) && !effect.getFlag(MODULE_ID, "lingering")?.enabled) {
      void enqueue(effect.uuid, async () => {
        await removeProgress(effect);
        await removeDependentEffects(effect);
        if (effect.getFlag(MODULE_ID, stateKey)) await effect.unsetFlag(MODULE_ID, stateKey);
      });
    }
  });
  Hooks.on("deleteItem", item => {
    if (!game.user.isActiveGM) return;
    for (const effect of item.effects) void enqueue(effect.uuid, async () => {
      await removeProgress(effect);
      await removeDependentEffects(effect);
    });
  });
}
