import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID} from "./constants.mjs";
import {documentFlags} from "./flags.mjs";
import {buildRollRequest} from "./requests.mjs";
import {messageContext, setRollContext} from "./roll-context.mjs";
import {traitRollScore} from "./trait-score.mjs";

export function sourceBinding(actor, token) {
  const document = token?.document ?? token ?? actor?.token;
  return {actorUuid: actor?.uuid ?? null, tokenUuid: document?.actor?.uuid === actor?.uuid ? document.uuid : null};
}

export function inferLingeringSource(effect) {
  const saved = effect.getFlag(MODULE_ID, "lingeringSource");
  if (saved?.actorUuid) return saved;
  const origin = effect.origin ? foundry.utils.fromUuidSync(effect.origin) : null;
  const actor = origin?.documentName === "Actor" ? origin : origin?.actor;
  if (actor) return sourceBinding(actor);
  if (effect.parent?.documentName === "Item" && effect.actor) return sourceBinding(effect.actor);
  return null;
}

async function resolveSource(effect) {
  let binding = inferLingeringSource(effect);
  let actor = binding?.actorUuid ? await foundry.utils.fromUuid(binding.actorUuid).catch(() => null) : null;
  if (!actor?.isOwner || !actor.system.attributes) {
    const choices = new Map();
    for (const token of canvas.tokens?.placeables ?? []) {
      if (token.actor?.isOwner && token.actor.system.attributes) choices.set(token.actor.uuid, {actor: token.actor, token: token.document});
    }
    for (const actor of game.actors) if (actor.isOwner && actor.system.attributes && !choices.has(actor.uuid)) choices.set(actor.uuid, {actor});
    const content = document.createElement("div");
    const label = document.createElement("label"); label.textContent = sbsI18n("swade-better-effects.UI.Sourceof_d70f7ca424", {p0: (effect.name)});
    const select = document.createElement("select"); select.name = sbsI18n("swade-better-effects.UI.source_41cf6794ba");
    for (const [uuid, entry] of choices) select.append(new Option(entry.actor.name, uuid));
    label.append(select); content.append(label);
    const uuid = await foundry.applications.api.DialogV2.prompt({window: {title: sbsI18n("swade-better-effects.UI.Chooselingeringeffectsource_ddf8a6bb28")}, content, rejectClose: false,
      ok: {label: sbsI18n("swade-better-effects.UI.Choose_c7f937836f"), callback: (_event, button) => button.form.elements.source.value}});
    if (!uuid) return null;
    const choice = choices.get(uuid);
    if (!choice) return null;
    actor = choice.actor;
    binding = sourceBinding(actor, choice.token);
    await effect.setFlag(MODULE_ID, "lingeringSource", binding);
  }
  const token = binding.tokenUuid ? await foundry.utils.fromUuid(binding.tokenUuid).catch(() => null) : null;
  return {actor, token: token?.actor?.uuid === actor.uuid ? token : null};
}

export async function rollLingeringOpposition(effect, config, victimToken) {
  const source = await resolveSource(effect);
  if (!source) return null;
  const {actor, token} = source;
  const names = [...new Set(config.opposedTraits.split(",").map(name => name.trim()).filter(Boolean))];
  const flags = [...documentFlags(effect), "opposed", "opposed-roll"];
  let best;
  for (const name of names) {
    const request = buildRollRequest({trait: name});
    const options = {suppressChat: true, isRerollable: false, effectFlags: flags,
      sbeLingeringSource: {tokenUuid: token?.uuid, targetUuid: victimToken?.uuid, targetActorUuid: effect.actor.uuid}};
    let roll;
    if (request.kind === "attribute") roll = await actor.rollAttribute(request.trait, options);
    else {
      const skill = actor.items.find(item => item.type === "skill" && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!skill && request.kind !== "untrained") continue;
      roll = skill ? await actor.rollSkill(skill.id, options) : await actor.makeUnskilledAttempt(options);
    }
    if (!roll) continue;
    // SWADE's suppressChat path parses the leading modifier independently.
    // A leading unary "+" can disappear, leaving adjacent operand terms.
    const terms = [];
    for (const term of roll.terms) {
      const previous = terms.at(-1);
      if (previous && !previous.operator && !term.operator) terms.push(new foundry.dice.terms.OperatorTerm({operator: "+"}));
      terms.push(term);
    }
    roll = roll.constructor.fromTerms(terms);
    roll.setRerollable(false);
    const score = traitRollScore(roll);
    if (!best || score > best.score) best = {roll, score, name: request.name};
  }
  if (!best) throw new Error(sbsI18n("swade-better-effects.UI.hasnoneoftheconfiguredopposing_dff95c9d46", {p0: (actor.name)}));
  const context = messageContext({significantRoll: best.roll, getFlag: () => undefined});
  context.lingeringSourceRoll = true;
  setRollContext(best.roll, context);
  await best.roll.evaluate();
  const message = await best.roll.toMessage({speaker: ChatMessage.getSpeaker({actor, token}),
    flavor: `${foundry.utils.escapeHTML(effect.name)} · Opposing ${foundry.utils.escapeHTML(best.name)}`}, {messageMode: "public"});
  if (!message || !Number.isFinite(best.roll.total)) throw new Error(sbsI18n("swade-better-effects.UI.Theopposingrollcouldnotbe_c106c61bb6"));
  return {...sourceBinding(actor, token), name: actor.name, trait: best.name, messageUuid: message.uuid,
    total: best.roll.total, flags: messageContext(message).roll};
}
