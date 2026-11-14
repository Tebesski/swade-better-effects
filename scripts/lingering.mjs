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

const pending = new Map();
const stateKey = "lingeringState";
const markerKey = "lingeringProgress";

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
      const stored = effect.getFlag(MODULE_ID, stateKey);
      const state = stored?.effectUuid === effect.uuid ? stored : null;
      if (state?.turnKey === turnKey || (state?.requestId && !state.resolved && game.messages.has(state.requestId))) return;
      const request = buildRollRequest({trait: config.trait, tn: config.tn, flags: documentFlags(effect)});
      const requestId = foundry.utils.randomID();
      await effect.setFlag(MODULE_ID, stateKey, {effectUuid: effect.uuid, requestId, turnKey, resolved: false, progress: state?.progress ?? 0});
      const token = combatant.token;
      const progress = config.required > 1 ? ` · ${state?.progress ?? 0}/${config.required} successes` : "";
      const name = `${token?.name ?? actor.name} · ${effect.name}${progress}`;
      try {
        const posted = await postLingeringRequest(request, {effectUuid: effect.uuid, tokenUuid: token?.uuid ?? null},
          {id: requestId, name});
        if (!posted) throw new Error("The lingering request was not created.");
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
  const progress = state.progress + outcome.progress;
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

  await effect.setFlag(MODULE_ID, stateKey, {...state, resolved: true, progress});
  await request.update({[`flags.${MODULE_ID}.lingeringRequest.resolved`]: true}).catch(error => console.error(`${MODULE_ID} | Lingering request card`, error));
  if (ended) {
    await removeProgress(effect);
    if (effect.parent === actor) await effect.delete();
    else await effect.update({disabled: true, [`flags.${MODULE_ID}.-=${stateKey}`]: null});
  } else if (config.required > 1 && outcome.progress) await progressMarker(effect, progress, config.required);

  if (outcome.effectUuid) {
    try {
      const reference = await resolveOutcomeEffect(outcome.effectUuid);
      if (!reference) throw new Error("The linked effect is unavailable.");
      // Apply a fresh copy, including duration and flags, even if the source was disabled.
      const applied = await actor.createEmbeddedDocuments("ActiveEffect", reference.effects.map(source => (
        {...effectApplicationData(source, reference.source.uuid), disabled: false}
      )));
      if (!applied.length) throw new Error("No linked effects were created.");
      summary.applied = applied.map(effect => effect.name);
    } catch (error) {
      summary.effectError = "The linked effect could not be applied.";
      console.error(`${MODULE_ID} | Lingering outcome effect`, error);
    }
  }
  await message.update({[`flags.${MODULE_ID}.lingeringResult`]: summary});
}

export function registerLingeringEffects() {
  const combat = CONFIG.Combat.documentClass.prototype;
  for (const [method, timing] of [["_onStartTurn", "start"], ["_onEndTurn", "end"]]) {
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
    void enqueue(data.effectUuid, () => resolveRequest(message, context, request, data));
  }
  Hooks.on("createChatMessage", evaluateRequest);
  Hooks.on("updateChatMessage", (message, changes) => { if (changes.rolls) evaluateRequest(message); });
  Hooks.on("deleteActiveEffect", effect => {
    if (game.user.isActiveGM && effect.getFlag(MODULE_ID, "lingering")?.enabled) void enqueue(effect.uuid, () => removeProgress(effect));
  });
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (!game.user.isActiveGM || !effect.getFlag(MODULE_ID, stateKey)) return;
    if (changes.disabled === true || !effect.getFlag(MODULE_ID, "lingering")?.enabled) {
      void enqueue(effect.uuid, async () => {
        await removeProgress(effect);
        if (effect.getFlag(MODULE_ID, stateKey)) await effect.unsetFlag(MODULE_ID, stateKey);
      });
    }
  });
  Hooks.on("deleteItem", item => {
    if (!game.user.isActiveGM) return;
    for (const effect of item.effects) if (effect.getFlag(MODULE_ID, stateKey)) void enqueue(effect.uuid, () => removeProgress(effect));
  });
}
