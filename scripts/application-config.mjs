import {t as sbsI18n} from "./i18n.mjs";
import {TEMPLATE} from "./constants.mjs";
import {APPLICATION_BEHAVIOURS, APPLICATION_CONDITIONS, APPLICATION_RECIPIENTS} from "./application-data.mjs";
import {catalogFlags} from "./flags.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";
import {mountOutcomeEffect, resolveOutcomeEffect} from "./lingering-config.mjs";
import {buildRollRequest} from "./requests.mjs";
import {normalizeFlag, normalizeFlags} from "./rules.mjs";

export async function resolveApplicationMacro(uuid) {
  if (typeof uuid !== "string" || !uuid.trim()) return null;
  const macro = await foundry.utils.fromUuid(uuid.trim()).catch(() => null);
  return macro?.documentName === "Macro" && macro.canExecute ? macro : null;
}

function mountMacroField(form) {
  const drop = form.querySelector('[data-behaviour="macro"]');
  const input = form.elements.macroUuid;
  const link = drop.querySelector("button");
  const refresh = async () => {
    const uuid = input.value;
    const macro = await resolveApplicationMacro(uuid);
    if (!drop.isConnected || uuid !== input.value) return;
    link.hidden = !macro;
    if (!macro) return;
    link.querySelector("img").src = macro.img;
    link.querySelector("span").textContent = macro.name;
    link.onclick = () => macro.sheet.render({force: true});
  };
  drop.addEventListener("dragover", event => event.preventDefault());
  drop.addEventListener("drop", async event => {
    event.preventDefault(); event.stopPropagation();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const macro = data.type === "Macro" ? await resolveApplicationMacro(data.uuid) : null;
    if (!macro) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Dropamacroyoucanexecute_2d961bf042"));
    input.value = macro.uuid;
    await refresh();
  });
  input.addEventListener("change", refresh);
  void refresh();
}

export async function configureApplication(data, actor) {
  const rule = {behaviour: "note", recipient: "target", condition: "attack", wounds: 1, trait: "vigor", tn: 4, ...data};
  const traits = [...Object.values(CONFIG.SWADE.attributes).map(attribute => game.i18n.localize(attribute.long)),
    ...(actor?.items?.filter(item => item.type === "skill").map(item => item.name) ?? [])];
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/application-rule.hbs`, {
    rule, traits, flags: normalizeFlags(rule.flags).join(", "), effectUuid: rule.effectUuid,
    behaviours: APPLICATION_BEHAVIOURS, recipients: APPLICATION_RECIPIENTS, conditions: APPLICATION_CONDITIONS
  });
  return foundry.applications.api.DialogV2.prompt({
    window: {title: sbsI18n("swade-better-effects.UI.Application_e7ad522ea3")}, classes: ["sbe-app"], position: {width: 480}, content, rejectClose: false,
    render: (_event, app) => {
      const form = app.element.querySelector("form");
      const fields = form.elements;
      const refresh = () => {
        for (const group of form.querySelectorAll("[data-behaviour]")) group.hidden = group.dataset.behaviour !== fields.behaviour.value;
        const recipients = ["request", "effect"].includes(fields.behaviour.value);
        form.querySelector("[data-recipient]").hidden = !recipients;
        form.querySelector("[data-wounds]").hidden = fields.condition.value !== "wounds";
        fields.wounds.disabled = fields.condition.value !== "wounds";
        fields.wounds.required = fields.condition.value === "wounds";
        fields.note.required = fields.behaviour.value === "note";
        fields.trait.required = fields.behaviour.value === "request";
        fields.tn.disabled = fields.behaviour.value !== "request";
        fields.macroUuid.required = fields.behaviour.value === "macro";
      };
      fields.behaviour.addEventListener("change", refresh);
      fields.condition.addEventListener("change", refresh);
      bindFlagSuggestions(fields.flags, catalogFlags, {multiple: true, normalize: normalizeFlag});
      mountOutcomeEffect(form, form);
      mountMacroField(form);
      refresh();
    },
    ok: {label: sbsI18n("swade-better-effects.UI.SaveApplication_168097d17a"), callback: (_event, button) => {
      const form = button.form;
      const {behaviour, recipient, condition, wounds, note, trait, tn, flags, removeOnUse, macroUuid} = form.elements;
      const result = {behaviour: behaviour.value, recipient: recipient.value, condition: condition.value,
        flags: normalizeFlags(flags.value), removeOnUse: removeOnUse.checked};
      if (condition.value === "wounds") result.wounds = Number(wounds.value);
      if (behaviour.value === "note") result.note = note.value.trim();
      else if (behaviour.value === "request") {
        buildRollRequest({trait: trait.value, tn: tn.value});
        result.trait = trait.value.trim();
        result.tn = tn.value === "" ? 4 : Number(tn.value);
      } else if (behaviour.value === "effect") result.effectUuid = form.querySelector('[data-field="effect"]').value;
      else result.macroUuid = macroUuid.value.trim();
      return result;
    }}
  });
}

export async function validateApplication(rule) {
  if (!Object.hasOwn(APPLICATION_BEHAVIOURS, rule?.behaviour) || !Object.hasOwn(APPLICATION_CONDITIONS, rule?.condition)
    || !Object.hasOwn(APPLICATION_RECIPIENTS, rule?.recipient)) throw new Error(sbsI18n("swade-better-effects.UI.ConfigureeachApplicationrulebeforesaving_ad2ee88ddd"));
  if (rule.condition === "wounds" && (!Number.isSafeInteger(rule.wounds) || rule.wounds < 1)) throw new Error(sbsI18n("swade-better-effects.UI.Enterapositivewholenumberof_3588200df1"));
  if (rule.behaviour === "note" && !rule.note?.trim()) throw new Error(sbsI18n("swade-better-effects.UI.EnteranApplicationnote_96626ef6ed"));
  if (rule.behaviour === "request") buildRollRequest(rule);
  if (rule.behaviour === "effect" && !await resolveOutcomeEffect(rule.effectUuid)) throw new Error(sbsI18n("swade-better-effects.UI.Linkanaccessibleeffecttothe_55226f9ce7"));
  if (rule.behaviour === "macro" && !await resolveApplicationMacro(rule.macroUuid)) throw new Error(sbsI18n("swade-better-effects.UI.Linkamacroyoucanexecute_106300c507"));
}
