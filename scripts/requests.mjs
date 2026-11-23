import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {catalogFlags, rememberFlags} from "./flags.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";
import {lingeringRollFlags, traitName, traitRequest, validateRequest} from "./request-data.mjs";
import {normalizeFlag} from "./rules.mjs";
import {makeContext, messageContext, setRollContext, traitAdjustment} from "./roll-context.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";
import {opposedResult} from "./opposed-context.mjs";
import {opposedTN} from "./opposed.mjs";
import {openRollRequestLibrary, registerRollRequestSettings, savedRollRequests, saveRollRequest} from "./request-library.mjs";
import {lingeringDamageRoll, openDamageRequest} from "./damage.mjs";
import {lingeringRollAction} from "./lingering.mjs";
import {rollRestricted} from "./restrictions.mjs";

const attributes = () => Object.entries(CONFIG.SWADE.attributes).map(([key, value]) => ({key, name: game.i18n.localize(value.long)}));
const setting = () => game.modules.get("swade-better-setting");
let composer;

export function openRollRequest(template, {fresh = false} = {}) {
  if (!game.user.isGM) { ui.notifications.warn(sbsI18n("swade-better-effects.UI.OnlyaGMorAssistantGM_e48a37e44f")); return; }
  if (composer?.rendered) { if (fresh) composer.reset(); else if (template) composer.load(template); composer.bringToFront(); return composer; }
  composer = new RollRequestComposer(); if (template) composer.load(template, false); composer.render({force: true}); return composer;
}

export function configureRollRequest(values, onSave, {previewTargetNumber} = {}) {
  if (!game.user.isGM) throw new Error(sbsI18n("swade-better-effects.UI.OnlyaGMorAssistantGM_9448c58331"));
  const app = new RollRequestComposer();
  app.onSave = onSave;
  app.previewTargetNumber = previewTargetNumber;
  app.values = {...app.values, ...values};
  app.selected = {kind: values.kind, name: values.trait, attribute: values.attribute};
  return app.render({force: true});
}

export function buildRollRequest(data) {
  const request = traitRequest(data, attributes(), [game.i18n.localize("SWADE.Unskilled")]);
  if (data.allowFormula && isDamageFormula(data.trait)) {
    request.kind = "formula";
    request.formula = data.trait.trim();
  } else if (data.allowFormula && /^(?:[\d(+\-]|d\d)/i.test(data.trait.trim())) {
    throw new Error(sbsI18n("swade-better-effects.UI.Enteravalidrollformulasuch_5ceaf0a56a"));
  }
  request.recipients = data.recipients ?? [];
  return request;
}

class RollRequestComposer extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(...args) { super(...args); this.values = {name: "", trait: "", tn: 4, flags: "", recipients: []}; }
  static DEFAULT_OPTIONS = {tag: "form", classes: ["sbe-app", "sbe-roll-request"], window: {get title() { return sbsI18n("swade-better-effects.UI.Requesttraitroll_251e025142"); }, icon: "fa-solid fa-dice"}, position: {width: 470},
    form: {closeOnSubmit: false, handler: async function (_event, _form, data) { await this.post(data.object); }},
    actions: {saveRequest: async function () { await this.saveTemplate(); }, openLibrary: function () { openRollRequestLibrary(); }, pickTrait: async function () {
      const api = setting()?.active && setting().api;
      if (!api?.openTraitPicker) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.BetterSettingstraitpickeris_8e7ee21eec"));
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
    return {id: this.id, configuring: !!this.onSave, hasTargetNumberPreview: !!this.previewTargetNumber, picker: !!(setting()?.active && setting().api?.openTraitPicker), attributes: attributes(), values: this.values,
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
    bindFlagSuggestions(flags, catalogFlags, {multiple: true, normalize: normalizeFlag});
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
    this.values = {name: entry.name, trait: request.name, tn: request.targetNumber, penalty: request.penalty, description: request.description, flags: request.flags.join(", "), recipients: request.recipients ?? []};
    if (render) this.render();
  }
  read(data = new foundry.applications.ux.FormDataExtended(this.element).object) {
    if (!game.user.isGM) throw new Error(sbsI18n("swade-better-effects.UI.OnlyaGMorAssistantGM_e48a37e44f"));
    const selected = this.selected && traitName(this.selected.name) === traitName(data.trait) ? this.selected : {};
    const request = traitRequest({...selected, trait: data.trait, tn: data.tn, penalty: data.penalty, flags: data.flags, description: data.description}, attributes(), [game.i18n.localize("SWADE.Unskilled")]);
    request.recipients = [...this.element.querySelectorAll('input[name="recipient"]:checked')].map(input => input.value).filter(id => game.users.get(id) && !game.users.get(id).isGM);
    rememberFlags(request.flags);
    this.values = {name: String(data.name ?? "").trim(), trait: data.trait, tn: request.targetNumber, penalty: request.penalty, description: request.description, flags: request.flags.join(", "), recipients: request.recipients};
    return request;
  }
  async saveTemplate() {
    const request = this.read();
    const name = this.values.name || `${request.name} · TN ${request.targetNumber}`;
    const entry = await saveRollRequest({id: this.templateId, name, request});
    this.templateId = entry.id; this.values.name = name; this.render(); ui.notifications.info(sbsI18n("swade-better-effects.UI.SavedtoRollRequests_d293dec0e4", {p0: (name)}));
  }
  async post(data) {
    if (this.onSave) {
      const request = this.read({...data, tn: 4});
      await this.onSave({trait: request.name, kind: request.kind, attribute: request.attribute ?? "", flags: request.flags.join(", "),
        tn: data.tn === "" ? 4 : data.tn, penalty: request.penalty ?? 0, description: request.description ?? "", recipients: request.recipients, name: this.values.name});
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
  const refreshLingering = actor => {
    if (!actor?.isOwner) return;
    const ids = new Set();
    // updateMessage inserts missing rows. Refresh mounted results only so old
    // lingering rolls don't get pulled back into the chat log on every update.
    for (const chat of [ui.chat, ui.chat?.popout]) {
      if (!chat?.rendered) continue;
      for (const row of chat.element.querySelectorAll(".message[data-message-id]:has(.sbe-request-result)")) ids.add(row.dataset.messageId);
    }
    for (const id of ids) {
      const message = game.messages.get(id);
      const request = message?.getFlag(MODULE_ID, "context")?.request;
      if (request?.lingering && request.actorUuid === actor.uuid) void ui.chat.updateMessage(message, {notify: false});
    }
  };
  Hooks.on("updateActor", (actor, changes) => {
    if (changes.system?.bennies || Object.hasOwn(changes, "system.bennies.value")) refreshLingering(actor);
  });
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (changes.flags?.[MODULE_ID]?.lingeringState || Object.hasOwn(changes, `flags.${MODULE_ID}.lingeringState`)) refreshLingering(effect.actor);
  });
  Hooks.on("deleteActiveEffect", effect => refreshLingering(effect.actor));
  Hooks.on("getSceneControlButtons", controls => {
    if (!controls.tokens) return;
    controls.tokens.tools.sbeRollRequest = {name: "sbeRollRequest", title: sbsI18n("swade-better-effects.UI.GenerateRequest_a63efac7d8"), icon: "fa-solid fa-dice", button: true,
      order: Number.MAX_SAFE_INTEGER - 1, visible: game.user.isGM, onChange: () => openRollRequest()};
  });
}

export async function generateRollRequest(request) {
  if (!game.user.isGM || !validateRequest(request)) throw new Error(sbsI18n("swade-better-effects.UI.OnlyaGMorAssistantGM_2d428f84a3"));
  request = structuredClone(request);
  const recipients = (request.recipients ?? []).filter(id => game.users.get(id) && !game.users.get(id).isGM);
  if (request.recipients?.length && !recipients.length) throw new Error(sbsI18n("swade-better-effects.UI.Theselectedplayersnolongerexist_4668d5b255"));
  request.recipients = recipients;
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/roll-request-card.hbs`, {request, flags: request.flags.join(", ")});
  const whisper = recipients.length ? [...new Set([...recipients, game.user.id])] : [];
  return CONFIG.ChatMessage.documentClass.create({content, speaker: {alias: game.user.name}, whisper, flags: {[MODULE_ID]: {rollRequest: request}}}, {messageMode: whisper.length ? "gm" : "public"});
}

export async function postLingeringRequest(request, lingering, {id, name}) {
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/roll-request-card.hbs`,
    {request, flags: request.flags.join(", "), lingering: name, opposing: lingering.opposition});
  return CONFIG.ChatMessage.documentClass.create({_id: id, content, speaker: {alias: name},
    flags: {[MODULE_ID]: {rollRequest: request, lingeringRequest: lingering}}}, {keepId: true, messageMode: "public"});
}

export async function postApplicationRequest(request, {actor, token, name, whisper}) {
  const application = {actorUuid: actor.uuid, tokenUuid: token?.uuid ?? null};
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/roll-request-card.hbs`,
    {request, flags: request.flags.join(", "), application: token?.name ?? actor.name});
  return CONFIG.ChatMessage.documentClass.create({content, speaker: {alias: name}, whisper,
    flags: {[MODULE_ID]: {rollRequest: request, applicationRequest: application}}}, {messageMode: whisper.length ? "gm" : "public"});
}

function applicationRecipient(message) {
  const binding = message.getFlag(MODULE_ID, "applicationRequest");
  if (!binding) return null;
  const actor = foundry.utils.fromUuidSync(binding.actorUuid);
  const token = binding.tokenUuid ? foundry.utils.fromUuidSync(binding.tokenUuid) : null;
  if (["character", "npc"].includes(actor?.type) && (!binding.tokenUuid || token?.actor?.uuid === actor.uuid)
    && (message.author?.isGM || actor.testUserPermission(message.author, "OWNER"))) return {actor, token};
  return null;
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
  if (!message?.visible || message.isContentVisible === false || game.messages.get(message.id) !== message || !validateRequest(request)) throw new Error(sbsI18n("swade-better-effects.UI.Thisrollrequestisnotaccessible_1216327259"));
  if (message.getFlag(MODULE_ID, "applicationRequest")) {
    const recipient = applicationRecipient(message);
    if (!recipient?.actor.isOwner || actorUuid && actorUuid !== recipient.actor.uuid) throw new Error(sbsI18n("swade-better-effects.UI.Thisrollisrequestedfroma_dfe63596ae"));
    return performRequestedTrait(message, request, recipient.actor, recipient.token, false, true);
  }
  if (!message.author?.isGM) throw new Error(sbsI18n("swade-better-effects.UI.Thisrollrequestisnotaccessible_1216327259"));
  const lingering = message.getFlag(MODULE_ID, "lingeringRequest");
  if (lingering) {
    const effect = foundry.utils.fromUuidSync(lingering.effectUuid);
    const state = effect?.getFlag(MODULE_ID, "lingeringState");
    if (!effect?.modifiesActor || !effect.actor?.isOwner || state?.requestId !== message.id || state?.resolved) {
      throw new Error(sbsI18n("swade-better-effects.UI.Thislingeringrollisnolonger_056f51a7cb"));
    }
    const token = lingering.tokenUuid ? foundry.utils.fromUuidSync(lingering.tokenUuid) : null;
    return performRequestedTrait(message, request, effect.actor, token, true);
  }
  const actors = availableActors();
  if (!actors.length) throw new Error(sbsI18n("swade-better-effects.UI.Selectatokenyouownor_b945e86925"));
  if (!actorUuid && actors.length > 1) {
    const content = document.createElement("div"), select = document.createElement("select"); select.name = sbsI18n("swade-better-effects.UI.actor_50c9c4aeb4"); select.setAttribute("aria-label", "Actor");
    for (const entry of actors) select.append(new Option(entry.name, entry.actor.uuid)); content.append(select);
    actorUuid = await foundry.applications.api.DialogV2.prompt({classes: ["sbe-app"], window: {title: sbsI18n("swade-better-effects.UI.Chooseacharacter_ff3e76b6ca")}, content, rejectClose: false,
      ok: {label: sbsI18n("swade-better-effects.UI.Choose_c7f937836f"), callback: (_event, button) => button.form.elements.actor.value}});
    if (!actorUuid) return;
  }
  const choice = actorUuid ? actors.find(entry => entry.actor.uuid === actorUuid) : actors[0];
  if (!choice?.actor.isOwner) throw new Error(sbsI18n("swade-better-effects.UI.Youdonotownthatactor_48196df15a"));
  const {actor, token} = choice;
  return performRequestedTrait(message, request, actor, token);
}

export function performRequestedTrait(message, request, actor, token, lingering = false, application = false) {
  const options = {effectFlags: request.flags, sbeRequest: {...structuredClone(request), messageUuid: message.uuid, tokenUuid: token?.uuid ?? null, whisper: [...message.whisper]},
    title: sbsI18n("swade-better-effects.UI.TN_40a8723f1a", {p0: (request.name), p1: (request.targetNumber)}), flavour: `${foundry.utils.escapeHTML(request.name)} · TN ${request.targetNumber}`};
  if (lingering) {
    options.isRerollable = false;
    options.sbeRequest.lingering = true;
    options.sbeRequest.actorUuid = actor.uuid;
    options.sbeRequest.whisper = [];
  }
  if (application) options.sbeRequest.application = true;
  const opposition = message.getFlag(MODULE_ID, "lingeringRequest")?.opposition;
  if (opposition) {
    options.sbeRequest.opposition = opposition;
    options.effectFlags = [...request.flags, ...opposition.flags, "opposed"];
  }
  if (lingering) {
    options.effectFlags = lingeringRollFlags(options.effectFlags, !!opposition);
    options.sbeRequest.flags = [...options.effectFlags];
  }
  options.additionalMods = request.penalty ? [{label: sbsI18n("swade-better-effects.UI.RequestPenalty_88c60c6efc"), value: request.penalty}] : [];
  if (request.modifier) options.additionalMods.push({label: sbsI18n("swade-better-effects.UI.LingeringModifier_dc603088e0"), value: request.modifier});
  if (request.kind === "formula") {
    if (!isDamageFormula(request.formula)) throw new Error(sbsI18n("swade-better-effects.UI.Thisrequesthasaninvalidformula_8c4d368cda"));
    const roll = new CONFIG.Dice.TraitRoll(request.formula, actor.getRollData());
    const context = makeContext(actor, null, options.effectFlags, {kind: "trait", token});
    context.roll = context.roll.filter(flag => flag !== "attribute");
    context.roll.push("formula");
    context.request = options.sbeRequest;
    context.request.actorUuid = actor.uuid;
    context.targetUuids = [];
    const opponent = opposition?.tokenUuid ? foundry.utils.fromUuidSync(opposition.tokenUuid)
      : opposition?.actorUuid ? {actor: foundry.utils.fromUuidSync(opposition.actorUuid)} : null;
    if (opposition) { context.opposed = opposition.flags; context.rollKinds = ["trait", "opposed"]; }
    if (rollRestricted(actor, context)) return null;
    const modifiers = actor.getTraitRollModifiers({modifier: 0}, {...options,
      additionalMods: [...options.additionalMods, ...(actor.system.stats.globalMods.trait ?? [])]});
    modifiers.push(...traitAdjustment(context, opponent).applied);
    roll.modifiers = modifiers;
    roll.targetNumber = request.targetNumber;
    roll.setRerollable(false);
    setRollContext(roll, context);
    return game.swade.RollDialog.asPromise({roll, mods: modifiers, actor,
      speaker: ChatMessage.getSpeaker({actor, token}), title: options.title, flavor: options.flavour});
  }
  if (request.kind === "attribute") {
    if (!attributes().some(entry => entry.key === request.trait)) throw new Error(sbsI18n("swade-better-effects.UI.Thisrequesthasaninvalidattribute_28ae34d047"));
    return actor.rollAttribute(request.trait, options);
  }
  if (request.kind === "untrained") return actor.makeUnskilledAttempt({...options, effectFlags: [...options.effectFlags, "untrained"]});
  const skill = actor.items.find(item => item.type === "skill" && traitName(item.name) === traitName(request.trait));
  if (skill) return actor.rollSkill(skill.id, options);
  // Use the native temporary-skill path: no item is added to the actor.
  const temporary = new CONFIG.Item.documentClass({name: request.name, type: "skill", system: {swid: "unskilled-attempt", attribute: request.attribute ?? "agility", die: {sides: 4, modifier: 0}, "wild-die": {sides: 6}}});
  options.effectFlags = [...options.effectFlags, "untrained"];
  options.additionalMods.push({label: game.i18n.localize("SWADE.Unskilled"), value: -2});
  return actor.rollSkill(null, options, temporary);
}

export function renderRollRequest(message, html) {
  if (message.isContentVisible === false) return;
  const request = message.getFlag(MODULE_ID, "rollRequest");
  const application = message.getFlag(MODULE_ID, "applicationRequest");
  const recipient = application && applicationRecipient(message);
  if (request && (application ? recipient : message.author?.isGM) && validateRequest(request)) {
    const lingering = message.getFlag(MODULE_ID, "lingeringRequest");
    for (const button of html.querySelectorAll(".sbe-request-roll")) {
      const effect = lingering && foundry.utils.fromUuidSync(lingering.effectUuid);
      const state = effect?.getFlag(MODULE_ID, "lingeringState");
      button.disabled = application ? !recipient.actor.isOwner
        : lingering ? !!lingering.resolved || !(effect?.modifiesActor && effect.actor?.isOwner && state?.requestId === message.id && !state.resolved)
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
    summary.textContent = sbsI18n("swade-better-effects.UI.RequestedrollTN_fc4d54a3b8", {p0: (context.request.targetNumber), p1: (result.outcome), p2: (result.raises ? ` · ${result.raises} raise${result.raises === 1 ? "" : "s"}` : "")});
    (html.querySelector(".message-content") ?? html).append(summary);
    renderLingeringResult(message, summary);
    if (context.request.lingering) renderLingeringControls(message, summary, context);
  }
}

function renderLingeringControls(message, summary, context) {
  const request = foundry.utils.fromUuidSync(context.request.messageUuid);
  const binding = request?.getFlag(MODULE_ID, "lingeringRequest");
  const effect = binding && foundry.utils.fromUuidSync(binding.effectUuid);
  const actor = effect?.actor;
  const state = effect?.getFlag(MODULE_ID, "lingeringState");
  if (!actor?.isOwner || !effect.modifiesActor || state?.resultUuid !== message.uuid) return;
  const controls = document.createElement("div");
  controls.className = "sbe-lingering-controls flexrow";
  let busy = false;
  const refresh = () => {
    const latest = effect.getFlag(MODULE_ID, "lingeringState");
    for (const button of controls.children) button.disabled = busy || latest?.rerollPending
      || latest?.resultUuid !== message.uuid;
  };
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = sbsI18n("swade-better-effects.UI.Reroll_18363dbee3");
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true; refresh();
    let claimed = false;
    let spent = false;
    try {
      const bennies = actor.system.bennies?.value ?? 0;
      const choice = await foundry.applications.api.DialogV2.wait({
        window: {title: sbsI18n("swade-better-effects.UI.RerollLingeringRoll_2a313184f6")}, classes: ["sbe-app"], rejectClose: false,
        content: `<p>${sbsI18n("swade-better-effects.UI.Benniesavailable_6674832359")} <strong>${Number(bennies)}</strong></p>`,
        render: (_event, dialog) => {
          dialog.element.querySelector('[data-action="benny"]').disabled = !(actor.system.bennies?.value > 0);
        },
        buttons: [
          {action: "benny", label: sbsI18n("swade-better-effects.UI.Benny_0fac655825"), disabled: bennies <= 0},
          {action: "free", label: sbsI18n("swade-better-effects.UI.Free_f411a1fb62")},
          {action: "cancel", label: sbsI18n("swade-better-effects.UI.Cancel_19766ed6cc"), default: true}
        ]
      });
      if (!["benny", "free"].includes(choice)) return;
      if (choice === "benny" && !(actor.system.bennies?.value > 0)) throw new Error(sbsI18n("swade-better-effects.UI.NoBenniesavailable_e7fdb2f94c"));
      claimed = await lingeringRollAction(message, "reroll");
      if (!claimed) return;
      if (choice === "benny") {
        if (!(actor.system.bennies?.value > 0)) throw new Error(sbsI18n("swade-better-effects.UI.NoBenniesavailable_e7fdb2f94c"));
        await actor.spendBenny(); spent = true;
      }
      const token = binding.tokenUuid ? foundry.utils.fromUuidSync(binding.tokenUuid) : null;
      const roll = await performRequestedTrait(request, request.getFlag(MODULE_ID, "rollRequest"), actor, token, true);
      if (!roll) {
        if (spent) { await actor.getBenny(); spent = false; }
        await lingeringRollAction(message, "cancel");
      }
    } catch (error) {
      if (claimed) await lingeringRollAction(message, "cancel").catch(() => {});
      ui.notifications.error(error.message, {console: true});
    } finally { busy = false; refresh(); }
  });
  controls.append(button);
  refresh();
  summary.after(controls);
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
    heading.textContent = sbsI18n("swade-better-effects.UI.Damage_66110c44ae", {p0: (damage.roll.total), p1: (damage.roll.formula)});
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
      button.textContent = sbsI18n("swade-better-effects.UI.ResolveDamage_4fca3904bf");
      button.addEventListener("click", () => openDamageRequest({messageUuid: message.uuid, tokenUuid})
        .catch(error => ui.notifications.error(error.message, {console: true})));
      note.append(button);
    }
  }
  if (note.childElementCount) summary.after(note);
}
