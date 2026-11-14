import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {wrapMethod} from "./effects.mjs";
import {damageRoll, isDamageMessage, messageContext, messageSources, setRollContext, snapshotRollNotes} from "./roll-context.mjs";
import {opposedResult} from "./opposed-context.mjs";
import {normalizeFlags} from "./rules.mjs";

const choosers = new Map();
const clean = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

export function opposedTN(message) {
  const total = damageRoll(message)?.total;
  const adjustment = Number(message.flags?.["swade-tools"]?.gmmod ?? 0);
  return Number.isFinite(total) && Number.isFinite(adjustment) ? total + adjustment : null;
}

function ownedTargets(message) {
  return messageTargets(message, messageContext(message)).filter(token => token.actor?.isOwner);
}

function checkMessage(message) {
  if (!message || message.visible === false || message.isContentVisible === false || game.messages.get(message.id) !== message) throw new Error("The original roll is no longer accessible.");
  if (isDamageMessage(message)) throw new Error("Damage rolls cannot be opposed.");
  if (opposedTN(message) === null) throw new Error("This message has no completed roll to oppose.");
}

function oppositionData(message, defender) {
  const context = messageContext(message), {actor} = messageSources(message);
  return {messageUuid: message.uuid, targetNumber: opposedTN(message), flags: normalizeFlags(context.roll),
    actorUuid: context.actorUuid ?? actor?.uuid ?? null, tokenUuid: context.tokenUuid ?? null,
    defenderUuid: defender.uuid, whisper: [...message.whisper], blind: !!message.blind};
}

export async function openOpposedRoll(message) {
  checkMessage(message);
  const targets = ownedTargets(message);
  if (!targets.length) throw new Error("You need ownership of a target to make its opposed roll.");
  const existing = choosers.get(message.uuid);
  if (existing) { existing.bringToFront(); return existing; }
  const app = new OpposedRollChooser(message, targets);
  choosers.set(message.uuid, app);
  await app.render({force: true}); return app;
}

class OpposedRollChooser extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(message, targets) { super(); this.message = message; this.targetUuid = targets[0].uuid; this.query = ""; }
  static DEFAULT_OPTIONS = {classes: ["sbe-app", "sbe-opposed-chooser"], window: {title: "Oppose roll", icon: "fa-solid fa-dice"}, position: {width: 440},
    actions: {choose: async function (_event, target) {
      try { await this.choose(target.dataset.kind, target.dataset.trait); } catch (error) { ui.notifications.error(error.message, {console: true}); }
    }}};
  static PARTS = {choices: {template: `${TEMPLATE}/opposed-chooser.hbs`}};
  async _prepareContext() {
    const targets = ownedTargets(this.message);
    if (!targets.some(token => token.uuid === this.targetUuid)) this.targetUuid = targets[0]?.uuid;
    const token = targets.find(token => token.uuid === this.targetUuid), actor = token?.actor;
    const die = data => `d${data?.sides ?? 4}${data?.modifier ? Number(data.modifier) > 0 ? ` +${data.modifier}` : ` ${data.modifier}` : ""}`;
    const attributes = Object.entries(CONFIG.SWADE.attributes).filter(([key]) => actor?.system.attributes?.[key]?.die)
      .map(([key, data]) => ({key, name: game.i18n.localize(data.long), die: die(actor.system.attributes[key].die)}));
    const skills = ["character", "npc"].includes(actor?.type) ? actor.items.filter(item => item.type === "skill")
      .map(item => ({key: item.id, name: item.name, die: die(item.system.die)})).sort((a,b) => a.name.localeCompare(b.name)) : [];
    return {rootId: this.id, targets: targets.map(target => ({uuid: target.uuid, name: target.name})), multiple: targets.length > 1,
      selected: this.targetUuid, name: token?.name ?? "Target unavailable", tn: opposedTN(this.message), attributes, skills, query: this.query};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector('input[type="search"]');
    const filter = () => {
      this.query = search.value; const query = clean(this.query).trim();
      const choices = [...this.element.querySelectorAll(".sbe-trait-choice")];
      for (const choice of choices) choice.hidden = !clean(choice.dataset.name).includes(query);
      for (const group of this.element.querySelectorAll(".sbe-trait-group")) group.hidden = !group.querySelector(".sbe-trait-choice:not([hidden])");
      this.element.querySelector(".sbe-no-traits").hidden = choices.some(choice => !choice.hidden);
    };
    search.addEventListener("input", filter); filter();
    this.element.querySelector('select[name="target"]')?.addEventListener("change", event => { this.targetUuid = event.target.value; this.render(); });
    if (!this.focused) { search.focus(); this.focused = true; }
  }
  async choose(kind, key) {
    checkMessage(this.message);
    const token = ownedTargets(this.message).find(target => target.uuid === this.targetUuid);
    if (!token) throw new Error("You no longer own this target.");
    const actor = token.actor;
    const skill = kind === "skill" ? actor.items.get(key) : null;
    if (kind === "skill" ? skill?.type !== "skill" : kind !== "attribute" || !actor.system.attributes?.[key]?.die) throw new Error("This trait is no longer available.");
    const sbeOpposition = oppositionData(this.message, token);
    const name = skill?.name ?? game.i18n.localize(CONFIG.SWADE.attributes[key].long);
    const options = {sbeOpposition, title: `${name} — opposed roll (TN ${sbeOpposition.targetNumber})`,
      flavour: `${foundry.utils.escapeHTML(name)} — opposed roll (TN ${sbeOpposition.targetNumber})`};
    await this.close();
    return kind === "skill" ? actor.rollSkill(key, options) : actor.rollAttribute(key, options);
  }
  async _onClose(options) { choosers.delete(this.message.uuid); await super._onClose(options); }
}

export function renderOpposedRoll(message, html, context) {
  if (isDamageMessage(message)) return;
  const content = html.querySelector(".message-content") ?? html;
  if (context.opposition && Number.isFinite(opposedTN(message)) && Number.isFinite(context.opposition.targetNumber)) {
    const opposition = context.opposition, total = opposedTN(message);
    const result = opposedResult(total, opposition.targetNumber, !!damageRoll(message).isCritfail);
    const summary = document.createElement("p"); summary.className = "sbe-opposed-result";
    summary.textContent = `Opposed roll · TN ${opposition.targetNumber}: ${result.outcome}${result.raises ? ` · ${result.raises} raise${result.raises === 1 ? "" : "s"}` : ""}`;
    content.append(summary);
  }
  if (opposedTN(message) === null || !messageTargets(message, context).some(token => token.actor)) return;
  const button = document.createElement("button"); button.type = "button"; button.className = "sbe-oppose-roll";
  button.textContent = "Oppose roll"; button.disabled = !ownedTargets(message).length;
  if (button.disabled) button.title = "A target's owner or a GM can make its opposed roll.";
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    openOpposedRoll(message).catch(error => ui.notifications.error(error.message, {console: true}));
  });
  content.append(button);
}

export function installOpposedRolls() {
  // Native dialogs reconstruct Roll.options from the terms. Restore the TN at
  // serialization, including native and Tools rerolls, before the card is saved.
  wrapMethod(CONFIG.Dice.SwadeRoll.prototype, "toMessage", function (original, messageData = {}, options = {}) {
    const source = {...messageData, significantRoll: this, getFlag: (scope, key) => messageData.flags?.[scope]?.[key]};
    const context = messageContext(source);
    const opposition = context.opposition;
    if (opposition) {
      this.options.targetNumber = opposition.targetNumber;
      const defender = foundry.utils.fromUuidSync(opposition.defenderUuid);
      if (defender?.actor) messageData.speaker = ChatMessage.getSpeaker({actor: defender.actor, token: defender, scene: defender.parent});
    }
    if (context.request) {
      this.options.targetNumber = context.request.targetNumber;
      const token = context.request.tokenUuid ? foundry.utils.fromUuidSync(context.request.tokenUuid) : null;
      if (token?.actor) messageData.speaker = ChatMessage.getSpeaker({actor: token.actor, token, scene: token.parent});
    }
    setRollContext(this, snapshotRollNotes(context, source));
    return original(messageData, context.request?.lingering ? {...options, messageMode: "public"} : options);
  });
  Hooks.on("renderRollDialog", app => {
    if (!app.ctx?.roll) return;
    const context = messageContext({significantRoll: app.ctx.roll, getFlag: () => undefined});
    const opposition = context.opposition;
    const request = context.request;
    if (!opposition && !request) return;
    app.element.querySelector(".sbe-opposed-tn")?.remove();
    const label = document.createElement("p"); label.className = "sbe-opposed-tn";
    label.textContent = `${opposition ? "Opposed roll" : "Requested roll"} · Target number: ${(opposition ?? request).targetNumber}`;
    (app.element.querySelector(".window-content") ?? app.element).prepend(label);
    const visibility = opposition ?? request;
    if (visibility?.lingering || visibility?.whisper?.length) {
      const mode = app.element.querySelector("#messageMode");
      mode.value = visibility.lingering ? "public" : visibility.blind ? "blind" : "gm";
      mode.disabled = true; mode.title = opposition ? "Visibility follows the original roll." : "Visibility follows the roll request.";
    }
  });
}
