import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {catalogFlags, rememberFlags} from "./flags.mjs";
import {traitName, traitRequest, validateRequest} from "./request-data.mjs";
import {messageContext} from "./roll-context.mjs";
import {opposedResult} from "./opposed-context.mjs";
import {opposedTN} from "./opposed.mjs";
import {openRollRequestLibrary, registerRollRequestSettings, savedRollRequests, saveRollRequest} from "./request-library.mjs";
import {lingeringDamageRoll, openDamageRequest} from "./damage.mjs";

const attributes = () => Object.entries(CONFIG.SWADE.attributes).map(([key, value]) => ({key, name: game.i18n.localize(value.long)}));
const setting = () => game.modules.get("swade-better-setting");
let composer;

export function openRollRequest(template, {fresh = false} = {}) {
  if (!game.user.isGM) { ui.notifications.warn("Only a GM or Assistant GM can request a trait roll."); return; }
  if (composer?.rendered) { if (fresh) composer.reset(); else if (template) composer.load(template); composer.bringToFront(); return composer; }
  composer = new RollRequestComposer(); if (template) composer.load(template, false); composer.render({force: true}); return composer;
}

export function configureRollRequest(values, onSave, {previewTargetNumber} = {}) {
  if (!game.user.isGM) throw new Error("Only a GM or Assistant GM can configure a roll request.");
  const app = new RollRequestComposer();
  app.onSave = onSave;
  app.previewTargetNumber = previewTargetNumber;
  app.values = {...app.values, ...values};
  app.selected = {kind: values.kind, name: values.trait, attribute: values.attribute};
  return app.render({force: true});
}

export function buildRollRequest(data) {
  const request = traitRequest(data, attributes(), [game.i18n.localize("SWADE.Unskilled")]);
  request.recipients = data.recipients ?? [];
  return request;
}

class RollRequestComposer extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(...args) { super(...args); this.values = {name: "", trait: "", tn: 4, flags: "", recipients: []}; }
  static DEFAULT_OPTIONS = {tag: "form", classes: ["sbe-app", "sbe-roll-request"], window: {title: "Request trait roll", icon: "fa-solid fa-dice"}, position: {width: 470},
    form: {closeOnSubmit: false, handler: async function (_event, _form, data) { await this.post(data.object); }},
    actions: {saveRequest: async function () { await this.saveTemplate(); }, openLibrary: function () { openRollRequestLibrary(); }, pickTrait: async function () {
      const api = setting()?.active && setting().api;
      if (!api?.openTraitPicker) return ui.notifications.warn("Better Setting's trait picker is unavailable.");
      api.openTraitPicker(async (value, entry) => {
        if (!this.rendered) return;
        const input = this.element.querySelector('[name="trait"]');
        this.selected = {kind: entry.kind, name: entry.kind === "attribute" ? game.i18n.localize(CONFIG.SWADE.attributes[value].long) : value};
        input.value = this.selected.name;
        if (entry.kind === "skill") {
          const skill = await game.packs.get("world.better-setting-skills")?.getDocument(entry.key);
          this.selected.attribute = skill?.system.attribute;
        }
      }, {classes: ["sbe-app"]});
    }}};
  static PARTS = {form: {template: `${TEMPLATE}/roll-request.hbs`}};
  async _prepareContext() {
    const templates = savedRollRequests().sort((a,b) => a.name.localeCompare(b.name));
    return {id: this.id, configuring: !!this.onSave, hasTargetNumberPreview: !!this.previewTargetNumber, picker: !!(setting()?.active && setting().api?.openTraitPicker), attributes: attributes(), flags: catalogFlags(), values: this.values,
      templates: templates.map(entry => ({id: entry.id, name: entry.name, selected: entry.id === this.templateId})),
      players: game.users.filter(user => !user.isGM).sort((a,b) => a.name.localeCompare(b.name)).map(user => ({id: user.id, name: user.name, selected: this.values.recipients.includes(user.id)})),
      untrained: game.i18n.localize("SWADE.Unskilled")};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector('[name="trait"]'); input.focus();
    if (this.previewTargetNumber) {
      const target = this.element.querySelector('[name="tn"]');
      const result = target.nextElementSibling;
      const refresh = () => {
        result.value = this.previewTargetNumber(target.value);
        result.hidden = !result.value;
      };
      target.addEventListener("input", refresh);
      refresh();
    }
    const flags = this.element.querySelector('[name="flags"]');
    const list = this.element.querySelector(".sbe-request-flags");
    const suggestions = () => {
      const parts = flags.value.split(","); parts.pop(); const prefix = parts.map(part => part.trim()).filter(Boolean).join(", ");
      list.replaceChildren(...catalogFlags().map(flag => new Option(flag, prefix ? `${prefix}, ${flag}` : flag)));
    };
    flags.addEventListener("input", suggestions); suggestions();
    this.element.querySelector('[name="template"]').addEventListener("change", async event => {
      const entry = savedRollRequests().find(entry => entry.id === event.target.value);
      if (entry) this.load(entry); else this.reset();
    });
  }
  reset() { this.templateId = null; this.selected = null; this.values = {name: "", trait: "", tn: 4, flags: "", recipients: []}; this.render(); }
  load(entry, render = true) {
    const request = entry.request;
    if (!validateRequest(request)) return;
    this.templateId = entry.id;
    this.selected = {kind: request.kind, name: request.name, attribute: request.attribute};
    this.values = {name: entry.name, trait: request.name, tn: request.targetNumber, penalty: request.penalty, flags: request.flags.join(", "), recipients: request.recipients ?? []};
    if (render) this.render();
  }
  read(data = new foundry.applications.ux.FormDataExtended(this.element).object) {
    if (!game.user.isGM) throw new Error("Only a GM or Assistant GM can request a trait roll.");
    const selected = this.selected && traitName(this.selected.name) === traitName(data.trait) ? this.selected : {};
    const request = traitRequest({...selected, trait: data.trait, tn: data.tn, penalty: data.penalty, flags: data.flags}, attributes(), [game.i18n.localize("SWADE.Unskilled")]);
    request.recipients = [...this.element.querySelectorAll('input[name="recipient"]:checked')].map(input => input.value).filter(id => game.users.get(id) && !game.users.get(id).isGM);
    rememberFlags(request.flags);
    this.values = {name: String(data.name ?? "").trim(), trait: data.trait, tn: request.targetNumber, penalty: request.penalty, flags: request.flags.join(", "), recipients: request.recipients};
    return request;
  }
  async saveTemplate() {
    const request = this.read();
    const name = this.values.name || `${request.name} · TN ${request.targetNumber}`;
    const entry = await saveRollRequest({id: this.templateId, name, request});
    this.templateId = entry.id; this.values.name = name; this.render(); ui.notifications.info(`Saved “${name}” to Roll Requests.`);
  }
  async post(data) {
    if (this.onSave) {
      const request = this.read({...data, tn: 4});
      await this.onSave({trait: request.name, kind: request.kind, attribute: request.attribute ?? "", flags: request.flags.join(", "),
        tn: data.tn === "" ? 4 : data.tn, penalty: request.penalty ?? 0, recipients: request.recipients, name: this.values.name});
      await this.close();
      return;
    }
    const request = this.read(data);
    await generateRollRequest(request);
    await this.close();
  }
  async _onClose(options) { if (composer === this) composer = undefined; await super._onClose(options); }
}

export function installRollRequests() {
  registerRollRequestSettings({open: openRollRequest, generate: generateRollRequest});
  Hooks.on("getSceneControlButtons", controls => {
    if (!controls.tokens) return;
    controls.tokens.tools.sbeRollRequest = {name: "sbeRollRequest", title: "Generate Request", icon: "fa-solid fa-dice", button: true,
      order: Object.keys(controls.tokens.tools).length + 10, visible: game.user.isGM, onChange: () => openRollRequest()};
  });
}

export async function generateRollRequest(request) {
  if (!game.user.isGM || !validateRequest(request)) throw new Error("Only a GM or Assistant GM can generate a valid roll request.");
  request = structuredClone(request);
  const recipients = (request.recipients ?? []).filter(id => game.users.get(id) && !game.users.get(id).isGM);
  if (request.recipients?.length && !recipients.length) throw new Error("The selected players no longer exist. Edit the request before generating it.");
  request.recipients = recipients;
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/roll-request-card.hbs`, {request, flags: request.flags.join(", ")});
  const whisper = recipients.length ? [...new Set([...recipients, game.user.id])] : [];
  return CONFIG.ChatMessage.documentClass.create({content, speaker: {alias: game.user.name}, whisper, flags: {[MODULE_ID]: {rollRequest: request}}}, {messageMode: whisper.length ? "gm" : "public"});
}

export async function postLingeringRequest(request, lingering, {id, name}) {
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/roll-request-card.hbs`,
    {request, flags: request.flags.join(", "), lingering: name});
  return CONFIG.ChatMessage.documentClass.create({_id: id, content, speaker: {alias: name},
    flags: {[MODULE_ID]: {rollRequest: request, lingeringRequest: lingering}}}, {keepId: true, messageMode: "public"});
}

function availableActors() {
  const choices = new Map();
  const add = (actor, token) => {
    if (!actor?.isOwner || !["character", "npc"].includes(actor.type) || choices.has(actor.uuid)) return;
    choices.set(actor.uuid, {actor, token, name: token?.name ?? actor.name});
  };
  for (const token of canvas.tokens?.controlled ?? []) add(token.actor, token.document);
  add(game.user.character);
  for (const actor of game.actors) add(actor);
  for (const token of canvas.scene?.tokens ?? []) add(token.actor, token);
  return [...choices.values()];
}

export async function rollRequestedTrait(message, actorUuid) {
  const request = message?.getFlag(MODULE_ID, "rollRequest");
  if (!message?.visible || message.isContentVisible === false || game.messages.get(message.id) !== message || !message.author?.isGM || !validateRequest(request)) throw new Error("This roll request is not accessible.");
  const lingering = message.getFlag(MODULE_ID, "lingeringRequest");
  if (lingering) {
    const effect = foundry.utils.fromUuidSync(lingering.effectUuid);
    const state = effect?.getFlag(MODULE_ID, "lingeringState");
    if (!effect?.modifiesActor || !effect.actor?.isOwner || state?.requestId !== message.id || state?.resolved) {
      throw new Error("This lingering roll is no longer available.");
    }
    const token = lingering.tokenUuid ? foundry.utils.fromUuidSync(lingering.tokenUuid) : null;
    return performRequestedTrait(message, request, effect.actor, token, true);
  }
  const actors = availableActors();
  if (!actors.length) throw new Error("Select a token you own or assign a character first.");
  if (!actorUuid && actors.length > 1) {
    const content = document.createElement("div"), select = document.createElement("select"); select.name = "actor"; select.setAttribute("aria-label", "Actor");
    for (const entry of actors) select.append(new Option(entry.name, entry.actor.uuid)); content.append(select);
    actorUuid = await foundry.applications.api.DialogV2.prompt({classes: ["sbe-app"], window: {title: "Choose a character"}, content, rejectClose: false,
      ok: {label: "Choose", callback: (_event, button) => button.form.elements.actor.value}});
    if (!actorUuid) return;
  }
  const choice = actorUuid ? actors.find(entry => entry.actor.uuid === actorUuid) : actors[0];
  if (!choice?.actor.isOwner) throw new Error("You do not own that actor.");
  const {actor, token} = choice;
  return performRequestedTrait(message, request, actor, token);
}

function performRequestedTrait(message, request, actor, token, lingering = false) {
  const options = {effectFlags: request.flags, sbeRequest: {...structuredClone(request), messageUuid: message.uuid, tokenUuid: token?.uuid ?? null, whisper: [...message.whisper]},
    title: `${request.name} · TN ${request.targetNumber}`, flavour: `${foundry.utils.escapeHTML(request.name)} · TN ${request.targetNumber}`};
  if (lingering) {
    options.isRerollable = false;
    options.sbeRequest.lingering = true;
    options.sbeRequest.actorUuid = actor.uuid;
    options.sbeRequest.whisper = [];
  }
  options.additionalMods = request.penalty ? [{label: "Request Penalty", value: request.penalty}] : [];
  if (request.kind === "attribute") {
    if (!attributes().some(entry => entry.key === request.trait)) throw new Error("This request has an invalid attribute.");
    return actor.rollAttribute(request.trait, options);
  }
  if (request.kind === "untrained") return actor.makeUnskilledAttempt({...options, effectFlags: [...request.flags, "untrained"]});
  const skill = actor.items.find(item => item.type === "skill" && traitName(item.name) === traitName(request.trait));
  if (skill) return actor.rollSkill(skill.id, options);
  // Use the native temporary-skill path: no item is added to the actor.
  const temporary = new CONFIG.Item.documentClass({name: request.name, type: "skill", system: {swid: "unskilled-attempt", attribute: request.attribute ?? "agility", die: {sides: 4, modifier: 0}, "wild-die": {sides: 6}}});
  options.effectFlags = [...request.flags, "untrained"];
  options.additionalMods.push({label: game.i18n.localize("SWADE.Unskilled"), value: -2});
  return actor.rollSkill(null, options, temporary);
}

export function renderRollRequest(message, html) {
  if (message.isContentVisible === false) return;
  const request = message.getFlag(MODULE_ID, "rollRequest");
  if (request && message.author?.isGM && validateRequest(request)) {
    const lingering = message.getFlag(MODULE_ID, "lingeringRequest");
    for (const button of html.querySelectorAll(".sbe-request-roll")) {
      const effect = lingering && foundry.utils.fromUuidSync(lingering.effectUuid);
      const state = effect?.getFlag(MODULE_ID, "lingeringState");
      button.disabled = lingering ? !!lingering.resolved || !(effect?.modifiesActor && effect.actor?.isOwner && state?.requestId === message.id && !state.resolved)
        : !availableActors().length;
      button.addEventListener("click", async event => {
        event.preventDefault(); event.stopPropagation();
        if (lingering) button.disabled = true;
        try { await rollRequestedTrait(message); }
        catch (error) { ui.notifications.error(error.message, {console: true}); }
        finally {
          if (lingering) {
            const latest = effect?.getFlag(MODULE_ID, "lingeringState");
            button.disabled = !(effect?.modifiesActor && latest?.requestId === message.id && !latest.resolved);
          }
        }
      });
    }
  }
  if (!message.isRoll) return;
  const context = messageContext(message);
  if (context.request && Number.isFinite(context.request.targetNumber) && Number.isFinite(opposedTN(message))) {
    const result = message.getFlag(MODULE_ID, "lingeringResult")?.result
      ?? opposedResult(opposedTN(message), context.request.targetNumber, !!message.significantRoll?.isCritfail);
    const summary = document.createElement("p"); summary.className = "sbe-request-result";
    summary.textContent = `Requested roll · TN ${context.request.targetNumber}: ${result.outcome}${result.raises ? ` · ${result.raises} raise${result.raises === 1 ? "" : "s"}` : ""}`;
    (html.querySelector(".message-content") ?? html).append(summary);
    renderLingeringResult(message, summary);
  }
}

function renderLingeringResult(message, summary) {
  const result = message.getFlag(MODULE_ID, "lingeringResult");
  if (!result) return;
  const note = document.createElement("section");
  note.className = "sbe-roll-notes sbe-lingering-result";
  for (const text of [result.text, result.ended, result.applied?.length ? `Applied: ${result.applied.join(", ")}` : "", result.effectError]) {
    if (!text) continue;
    const line = document.createElement("p");
    line.textContent = text;
    note.append(line);
  }
  const damage = lingeringDamageRoll(message);
  if (damage) {
    const details = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = `Damage: ${damage.roll.total} (${damage.roll.formula})`;
    details.append(heading);
    details.addEventListener("toggle", async () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = "true";
      details.insertAdjacentHTML("beforeend", await damage.roll.getTooltip());
    });
    note.append(details);
    const tokenUuid = damage.context.targetUuids[0];
    const token = tokenUuid ? foundry.utils.fromUuidSync(tokenUuid) : null;
    if (token?.actor?.isOwner) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Resolve Damage";
      button.addEventListener("click", () => openDamageRequest({messageUuid: message.uuid, tokenUuid})
        .catch(error => ui.notifications.error(error.message, {console: true})));
      note.append(button);
    }
  }
  if (note.childElementCount) summary.after(note);
}
