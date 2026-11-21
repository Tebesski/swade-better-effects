import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {wrapMethod} from "./effects.mjs";
import {damageRoll, isDamageMessage, messageContext, messageSources, setRollContext, snapshotRollNotes} from "./roll-context.mjs";
import {opposedResult} from "./opposed-context.mjs";
import {normalizeFlags} from "./rules.mjs";
import {usesTargetRows, shakeOffAction} from "../../swade-better-setting/scripts/chat-target-data.mjs";

const choosers = new Map();
const RESULT_QUERY = `${MODULE_ID}.targetResult`;
const saving = new Map();

async function saveTargetResult({messageId, targetUuid, result}, {user}) {
  const message = game.messages.get(messageId), token = foundry.utils.fromUuidSync(targetUuid);
  if (!message || !token?.actor?.testUserPermission(user, "OWNER") || !messageTargets(message, messageContext(message)).some(t => t.uuid === targetUuid)) throw new Error(sbsI18n("swade-better-effects.UI.Youcannotupdatethistargets_86e86126ca"));
  if (!user.isGM && (message.blind || message.whisper.length && !message.whisper.includes(user.id) && message.author.id !== user.id)) throw new Error(sbsI18n("swade-better-effects.UI.Thisrollisprivate_3e88e26503"));
  if (!Number.isFinite(result.total) || !["opposed", sbsI18n("swade-better-effects.UI.shakeOff_ac7a1903f8")].includes(result.mode)) throw new Error(sbsI18n("swade-better-effects.UI.Invalidtargetrollresult_65e80e749d"));
  const key = `${messageId}:${token.actor.uuid}`;
  const task = (saving.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (result.payBenny) {
      if (token.actor.bennies < 1) throw new Error(sbsI18n("swade-better-effects.UI.NoBenniesremaining_7d9904a481"));
      await token.actor.update({"system.bennies.value": token.actor.bennies - 1});
      if (game.settings.get("swade", "hardChoices")) game.swade.sockets.giveBenny(game.users.filter(u => u.isGM && u.active).map(u => u.id));
      Hooks.callAll("swadeSpendBenny", token.actor);
    }
    const path = `targetResults.${token.id}.${result.mode}`;
    const previous = message.getFlag(MODULE_ID, path);
    await message.setFlag(MODULE_ID, path, {...result, previous: previous ? [previous.total, ...(previous.previous ?? [])].slice(0, 10) : []});
  });
  saving.set(key, task);
  try { await task; } finally { if (saving.get(key) === task) saving.delete(key); }
}

async function rerollChoice(token) {
  const count = () => Math.max(0, Number(token.actor.bennies ?? token.actor.system?.bennies?.value ?? 0) || 0);
  let dialog;
  const refresh = () => {
    const root = dialog?.element;
    const button = root?.querySelector('[data-action="benny"]');
    if (button) button.disabled = count() < 1;
    const value = root?.querySelector("[data-benny-count]");
    if (value) value.textContent = count();
  };
  const hook = Hooks.on("updateActor", refresh);
  try {
    return await foundry.applications.api.DialogV2.wait({window: {title: sbsI18n("swade-better-effects.UI.Reroll_a2c7482c1c", {p0: (token.name)})}, classes: ["sbe-app", "sbe-target-reroll"],
      render: (_event, app) => { dialog = app; refresh(); },
      content: `<p>${sbsI18n("swade-better-effects.UI.Benniesavailable_6674832359")} <strong data-benny-count>${count()}</strong></p>`, rejectClose: false,
      buttons: [{action: "free", label: sbsI18n("swade-better-effects.UI.Free_f411a1fb62")}, {action: "benny", label: sbsI18n("swade-better-effects.UI.Benny_0fac655825"), disabled: count() < 1,
        callback: () => count() > 0 ? "benny" : null}]});
  } finally { Hooks.off("updateActor", hook); }
}
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
  if (!message || message.visible === false || message.isContentVisible === false || game.messages.get(message.id) !== message) throw new Error(sbsI18n("swade-better-effects.UI.Theoriginalrollisnolonger_653ea0c74b"));
  if (isDamageMessage(message)) throw new Error(sbsI18n("swade-better-effects.UI.Damagerollscannotbeopposed_7f7ee2769f"));
  if (opposedTN(message) === null) throw new Error(sbsI18n("swade-better-effects.UI.Thismessagehasnocompletedroll_9d8f362b7d"));
}

function oppositionData(message, defender) {
  const context = messageContext(message), {actor} = messageSources(message);
  return {messageUuid: message.uuid, targetNumber: opposedTN(message), flags: normalizeFlags(context.roll),
    actorUuid: context.actorUuid ?? actor?.uuid ?? null, tokenUuid: context.tokenUuid ?? null,
    defenderUuid: defender.uuid, whisper: [...message.whisper], blind: !!message.blind};
}

export async function openOpposedRoll(message, {targetUuid} = {}) {
  checkMessage(message);
  const targets = ownedTargets(message).filter(token => !targetUuid || token.uuid === targetUuid);
  if (!targets.length) throw new Error(sbsI18n("swade-better-effects.UI.Youneedownershipofatarget_47268d7a99"));
  const chooserKey = `${message.uuid}:${targetUuid ?? "all"}`;
  const existing = choosers.get(chooserKey);
  if (existing) { existing.bringToFront(); return existing; }
  const app = new OpposedRollChooser(message, targets, targetUuid, chooserKey);
  choosers.set(chooserKey, app);
  await app.render({force: true}); return app;
}

class OpposedRollChooser extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(message, targets, fixedTarget, chooserKey) { super(); this.message = message; this.targetUuid = targets[0].uuid; this.fixedTarget = fixedTarget; this.chooserKey = chooserKey; this.query = ""; }
  static DEFAULT_OPTIONS = {classes: ["sbe-app", "sbe-opposed-chooser"], window: {get title() { return sbsI18n("swade-better-effects.UI.Opposeroll_e316eb5c3f"); }, icon: "fa-solid fa-dice"}, position: {width: 440},
    actions: {choose: async function (_event, target) {
      try { await this.choose(target.dataset.kind, target.dataset.trait); } catch (error) { ui.notifications.error(error.message, {console: true}); }
    }}};
  static PARTS = {choices: {template: `${TEMPLATE}/opposed-chooser.hbs`}};
  async _prepareContext() {
    const targets = ownedTargets(this.message).filter(token => !this.fixedTarget || token.uuid === this.fixedTarget);
    if (!targets.some(token => token.uuid === this.targetUuid)) this.targetUuid = targets[0]?.uuid;
    const token = targets.find(token => token.uuid === this.targetUuid), actor = token?.actor;
    const die = data => `d${data?.sides ?? 4}${data?.modifier ? Number(data.modifier) > 0 ? ` +${data.modifier}` : ` ${data.modifier}` : ""}`;
    const attributes = Object.entries(CONFIG.SWADE.attributes).filter(([key]) => actor?.system.attributes?.[key]?.die)
      .map(([key, data]) => ({key, name: game.i18n.localize(data.long), die: die(actor.system.attributes[key].die)}));
    const skills = ["character", "npc"].includes(actor?.type) ? actor.items.filter(item => item.type === "skill")
      .map(item => ({key: item.id, name: item.name, die: die(item.system.die)})).sort((a,b) => a.name.localeCompare(b.name)) : [];
    return {rootId: this.id, targets: targets.map(target => ({uuid: target.uuid, name: target.name})), multiple: targets.length > 1,
      selected: this.targetUuid, name: token?.name ?? sbsI18n("swade-better-effects.UI.Targetunavailable_06c6e81f76"), tn: opposedTN(this.message), attributes, skills, query: this.query};
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
    await this.close();
    return rollTargetOpposition(this.message, this.targetUuid, kind, key);
  }
  async _onClose(options) { choosers.delete(this.chooserKey); await super._onClose(options); }
}

export async function rollTargetOpposition(message, targetUuid, kind, key, payBenny = false) {
  checkMessage(message);
  const token = ownedTargets(message).find(target => target.uuid === targetUuid);
  if (!token) throw new Error(sbsI18n("swade-better-effects.UI.Younolongerownthistarget_920bd490d1"));
  const actor = token.actor, skill = kind === "skill" ? actor.items.get(key) : null;
  if (kind === "skill" ? skill?.type !== "skill" : kind !== "attribute" || !actor.system.attributes?.[key]?.die) throw new Error(sbsI18n("swade-better-effects.UI.Thistraitisnolongeravailable_7ce5a73b4b"));
  const name = skill?.name ?? game.i18n.localize(CONFIG.SWADE.attributes[key].long);
  const sbeOpposition = {...oppositionData(message, token), inline: true, payBenny, trait: {kind, key, name}};
  const options = {sbeOpposition, sbsResistance: true, title: sbsI18n("swade-better-effects.UI.opposedrollTN_76a1ff5147", {p0: (name), p1: (sbeOpposition.targetNumber)}),
    flavour: `${foundry.utils.escapeHTML(name)} — opposed roll (TN ${sbeOpposition.targetNumber})`};
  return kind === "skill" ? actor.rollSkill(key, options) : actor.rollAttribute(key, options);
}

function sourceItem(message, context = messageContext(message)) {
  return (context.itemUuid ? foundry.utils.fromUuidSync(context.itemUuid) : null) ?? messageSources(message).item;
}

export async function rollTargetShakeOff(message, targetUuid, strong = false, payBenny = false) {
  checkMessage(message);
  const token = ownedTargets(message).find(target => target.uuid === targetUuid);
  if (!token) throw new Error(sbsI18n("swade-better-effects.UI.Younolongerownthistarget_920bd490d1"));
  const item = sourceItem(message);
  const selected = shakeOffAction(item?.system.actions?.additional, strong);
  if (!selected) throw new Error(strong ? sbsI18n("swade-better-effects.UI.NoStrongShakeOffactionis_20b9cdc9cf") : sbsI18n("swade-better-effects.UI.NoShakeOffactionisdefined_57136f8ad2"));
  const [id, action] = selected, actor = token.actor;
  const name = action.override || item.system.actions.trait;
  const attribute = Object.entries(CONFIG.SWADE.attributes).find(([key, data]) =>
    [key, game.i18n.localize(data.long)].some(label => clean(label) === clean(name)))?.[0];
  const skill = !attribute && actor.items.find(skill => skill.type === "skill" && [skill.name, skill.system.swid].some(label => clean(label) === clean(name)));
  const response = {...oppositionData(message, token), inline: true, payBenny, targetNumber: 4, mode: "shakeOff", strong,
    trait: {kind: attribute ? "attribute" : "skill", key: attribute ?? skill?.id ?? null, name: action.name}, action: id};
  const options = {item, sbsResistance: true, sbsTargetingAction: id, sbeResponse: response,
    additionalMods: [...(item.traitModifiers ?? []), ...(action.modifier ? [{label: action.name, value: action.modifier}] : [])],
    rof: action.dice ?? 1, title: `${token.name}: ${action.name}`, flavour: action.name};
  return attribute ? actor.rollAttribute(attribute, options) : actor.rollSkill(skill?.id ?? null, options);
}

function targetRows(message, context) {
  const section = document.createElement("section");
  section.className = "sbe-target-responses";
  section.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Targetresistancerolls_69521eff69"));
  for (const token of messageTargets(message, context)) {
    if (!token.actor || (token.hidden && !game.user.isGM && !token.isOwner)) continue;
    const row = document.createElement("details"); row.className = "sbe-target-row";
    row.dataset.tokenUuid = token.uuid;
    const heading = document.createElement("summary"); heading.className = "sbe-target-heading";
    const name = document.createElement("span"); name.className = "sbe-target-name";
    const image = document.createElement("img"); image.src = token.texture.src; image.alt = "";
    image.className = "sbe-target-portrait";
    name.textContent = token.name;
    const controls = document.createElement("span"); controls.className = "sbe-target-controls";
    const button = (action, icon, label, callback, disabled = false) => {
      const a = document.createElement("a"); a.dataset.action = action;
      a.tabIndex = disabled ? -1 : 0; a.setAttribute("role", "button"); a.setAttribute("aria-label", label);
      a.dataset.tooltipText = label; a.setAttribute("aria-disabled", String(disabled));
      const glyph = document.createElement("i"); glyph.className = icon; a.append(glyph);
      const run = async event => {
        event.preventDefault(); event.stopPropagation();
        if (disabled || a.dataset.busy) return;
        a.dataset.busy = "true";
        try { await callback(event); } catch (error) { ui.notifications.error(error.message, {console: true}); }
        finally { delete a.dataset.busy; }
      };
      a.addEventListener("click", run);
      a.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) void run(event); });
      controls.append(a); return a;
    };
    for (const mode of ["opposed", sbsI18n("swade-better-effects.UI.shakeOff_ac7a1903f8")]) {
      const saved = message.getFlag(MODULE_ID, `targetResults.${token.id}.${mode}`);
      const hasAction = mode === "opposed" || !!shakeOffAction(sourceItem(message, context)?.system.actions?.additional);
      const label = mode === "opposed" ? sbsI18n("swade-better-effects.UI.OpposedRoll_e6332e73de") : sbsI18n("swade-better-effects.UI.ShakeOffShiftclickStrongShake_cb6d71c3bd");
      const rerun = async event => {
        if (saved) {
          const choice = await rerollChoice(token);
          if (!choice) return;
          if (mode === "opposed") return rollTargetOpposition(message, token.uuid, saved.trait.kind, saved.trait.key, choice === "benny");
          return rollTargetShakeOff(message, token.uuid, event.shiftKey || saved.strong, choice === "benny");
        }
        return mode === "opposed" ? openOpposedRoll(message, {targetUuid: token.uuid}) : rollTargetShakeOff(message, token.uuid, event.shiftKey);
      };
      const control = button(mode === "opposed" ? "opposed-roll" : "shake-off", mode === "opposed" ? "fa-solid fa-dice" : "fa-solid fa-person-running", label, rerun, !token.actor.isOwner || !hasAction);
      const box = document.createElement("span"); box.className = "sbe-target-roll-box";
      control.before(box); box.append(control);
      if (!saved) continue;
      const tn = mode === "opposed" ? opposedTN(message) : saved.targetNumber;
      const outcome = opposedResult(saved.total, tn, saved.criticalFailure);
      const badge = button("reroll-" + mode, "", sbsI18n("swade-better-effects.UI.Reroll_25fe6ffc61", {p0: (saved.trait.name)}), rerun, !token.actor.isOwner);
      badge.className = "sbe-target-result " + (outcome.outcome === "Success" ? outcome.raises ? "raise" : "success" : "failure");
      badge.textContent = saved.total; box.append(badge);
      const tooltip = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = sbsI18n("swade-better-effects.UI.TN_40a8723f1a", {p0: (saved.trait.name), p1: (tn)}); tooltip.append(title);
      for (const text of [`Result: ${saved.total} · ${outcome.outcome}${outcome.raises ? ` · ${outcome.raises} raises` : ""}`, saved.dice,
        (saved.modifiers ?? []).map(mod => `${mod.label}: ${mod.value}`).join("\n"), saved.previous?.length ? "Previous rolls: " + saved.previous.join(", ") : ""]) {
        if (!text) continue;
        tooltip.append(document.createElement("hr")); const section = document.createElement("div"); section.textContent = text; tooltip.append(section);
      }
      delete badge.dataset.tooltipText;
      badge.dataset.tooltipHtml = tooltip.outerHTML; badge.dataset.tooltipClass = "sbe-resistance-tooltip";
    }
    button("ping-target", "fa-solid fa-signal-stream", sbsI18n("swade-better-effects.UI.Pingtoken_28b35faa5d"), () => {
      if (!canvas.ready || token.parent.id !== canvas.scene.id || !token.object?.visible) throw new Error(sbsI18n("swade-better-effects.UI.Thistargetisnotvisibleon_0a78971b2e"));
      return canvas.ping(token.object.center);
    });
    heading.append(image, name, controls);
    const flags = document.createElement("div"); flags.className = "sbe-target-flags";
    if (!game.user.isGM) heading.addEventListener("click", event => event.preventDefault());
    row.append(heading, flags); section.append(row);
  }
  return section;
}

export function renderOpposedRoll(message, html, context) {
  if (isDamageMessage(message)) return;
  const content = html.querySelector(".message-content") ?? html;
  if (context.opposition && Number.isFinite(opposedTN(message)) && Number.isFinite(context.opposition.targetNumber)) {
    const opposition = context.opposition, total = opposedTN(message);
    const result = opposedResult(total, opposition.targetNumber, !!damageRoll(message).isCritfail);
    const summary = document.createElement("p"); summary.className = "sbe-opposed-result";
    summary.textContent = sbsI18n("swade-better-effects.UI.OpposedrollTN_91ddc08d86", {p0: (opposition.targetNumber), p1: (result.outcome), p2: (result.raises ? ` · ${result.raises} raise${result.raises === 1 ? "" : "s"}` : "")});
    content.append(summary);
  }
  if (!usesTargetRows({item: sourceItem(message, context), context, damage: isDamageMessage(message)})) return;
  if (opposedTN(message) === null || !messageTargets(message, context).some(token => token.actor)) return;
  content.querySelector(".sbe-target-responses")?.remove();
  content.append(targetRows(message, context));
}

export function installOpposedRolls() {
  CONFIG.queries[RESULT_QUERY] = (request, context) => {
    if (!game.user.isGM) throw new Error(sbsI18n("swade-better-effects.UI.OnlyaGMmayhandleremote_8f4db2cf4d"));
    return saveTargetResult(request, context);
  };
  // Native dialogs reconstruct Roll.options from the terms. Restore the TN at
  // serialization, including native and Tools rerolls, before the card is saved.
  wrapMethod(CONFIG.Dice.SwadeRoll.prototype, "toMessage", async function (original, messageData = {}, options = {}) {
    const source = {...messageData, significantRoll: this, getFlag: (scope, key) => messageData.flags?.[scope]?.[key]};
    const context = messageContext(source);
    const opposition = context.opposition ?? context.response;
    if (opposition) {
      opposition.modifiers = (this.modifiers ?? []).filter(mod => !mod.ignore).map(mod => ({label: game.i18n.localize(mod.label), value: String(mod.value)}));
      this.options.targetNumber = opposition.targetNumber;
      const defender = foundry.utils.fromUuidSync(opposition.defenderUuid);
      if (defender?.actor) messageData.speaker = ChatMessage.getSpeaker({actor: defender.actor, token: defender, scene: defender.parent});
    }
    if (context.request) {
      this.options.targetNumber = context.request.targetNumber;
      const token = context.request.tokenUuid ? foundry.utils.fromUuidSync(context.request.tokenUuid) : null;
      if (token?.actor) messageData.speaker = ChatMessage.getSpeaker({actor: token.actor, token, scene: token.parent});
    }
    if (opposition?.inline) {
      const parent = foundry.utils.fromUuidSync(opposition.messageUuid);
      const request = {messageId: parent?.id, targetUuid: opposition.defenderUuid, result: {
        mode: context.response ? sbsI18n("swade-better-effects.UI.shakeOff_ac7a1903f8") : "opposed", total: this.total, criticalFailure: !!this.isCritfail,
        targetNumber: opposition.targetNumber, trait: opposition.trait, strong: !!opposition.strong,
        payBenny: !!opposition.payBenny, modifiers: opposition.modifiers,
        dice: (this.dice ?? []).map(die => `d${die.faces}: ${(die.results ?? []).filter(r => r.active !== false).map(r => r.result).join(" + ")}`).join("; ")
      }};
      if (game.user.isGM || parent?.isOwner) await saveTargetResult(request, {user: game.user});
      else if (game.users.activeGM) await game.users.activeGM.query(RESULT_QUERY, request);
      else throw new Error(sbsI18n("swade-better-effects.UI.AnactiveGMisrequiredto_13be4fb2d3"));
      return null;
    }
    setRollContext(this, snapshotRollNotes(context, source));
    return original(messageData, context.request?.lingering ? {...options, messageMode: "public"} : options);
  });
  const refreshParent = message => {
    const context = messageContext(message);
    const uuid = (context.opposition ?? context.response)?.messageUuid;
    if (!uuid) return;
    const parent = game.messages.contents.find(entry => entry.uuid === uuid);
    if (parent && parent.visible !== false && parent.isContentVisible !== false) void ui.chat.updateMessage(parent, {notify: false});
  };
  for (const hook of [sbsI18n("swade-better-effects.UI.createChatMessage_427fbd0a60"), sbsI18n("swade-better-effects.UI.updateChatMessage_9891c76b1d"), sbsI18n("swade-better-effects.UI.deleteChatMessage_5328027508")]) Hooks.on(hook, refreshParent);
  Hooks.on("deleteChatMessage", message => {
    for (const [key, app] of choosers) if (key.startsWith(message.uuid + ":")) void app.close();
  });
  Hooks.on("renderRollDialog", app => {
    if (!app.ctx?.roll) return;
    const context = messageContext({significantRoll: app.ctx.roll, getFlag: () => undefined});
    const opposition = context.opposition ?? context.response;
    const request = context.request;
    if (!opposition && !request) return;
    app.element.querySelector(".sbe-opposed-tn")?.remove();
    const label = document.createElement("p"); label.className = "sbe-opposed-tn";
    label.textContent = sbsI18n("swade-better-effects.UI.Targetnumber_b76c6ec6d7", {p0: (context.response ? context.response.trait?.name ?? sbsI18n("swade-better-effects.UI.ShakeOff_c3e5866333") : opposition ? sbsI18n("swade-better-effects.UI.Opposedroll_6e1d1956ac") : sbsI18n("swade-better-effects.UI.Requestedroll_ba12d64e14")), p1: ((opposition ?? request).targetNumber)});
    (app.element.querySelector(".window-content") ?? app.element).prepend(label);
    const visibility = opposition ?? request;
    if (visibility?.lingering || visibility?.whisper?.length) {
      const mode = app.element.querySelector("#messageMode");
      mode.value = visibility.lingering ? "public" : visibility.blind ? "blind" : "gm";
      mode.disabled = true; mode.title = opposition ? sbsI18n("swade-better-effects.UI.Visibilityfollowstheoriginalroll_cc4a54417d") : sbsI18n("swade-better-effects.UI.Visibilityfollowstherollrequest_963f3f38c0");
    }
  });
}
