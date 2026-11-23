import {t} from "./i18n.mjs";
import {restrictionData, validateRestriction} from "./restriction-data.mjs";
import {catalogFlags} from "./flags.mjs";
import {normalizePattern} from "./rules.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";

export function configureRestriction(value) {
  const rule = restrictionData(value);
  const content = document.createElement("div");
  const field = (title, name, text) => {
    const group = document.createElement("div"); group.className = "form-group";
    const label = document.createElement("label"); label.textContent = title;
    const fields = document.createElement("div"); fields.className = "form-fields";
    const input = document.createElement("input"); input.type = "text"; input.name = name; input.setAttribute("value", text);
    input.id = `sbe-${name}-${foundry.utils.randomID()}`; label.htmlFor = input.id;
    fields.append(input); group.append(label, fields); content.append(group); return input;
  };
  const traits = field(t("swade-better-effects.UI.RestrictedTraits"), "restrictedTraits", rule.traits.join(", "));
  const picker = document.createElement("button"); picker.type = "button"; picker.dataset.pickRestriction = ""; picker.textContent = t("swade-better-effects.UI.ChooseTrait");
  traits.before(picker);
  const all = document.createElement("button"); all.type = "button"; all.dataset.allTraits = ""; all.textContent = t("swade-better-effects.UI.AllTraits"); content.append(all);
  const linked = document.createElement("small"); linked.dataset.linkedSkills = ""; linked.textContent = rule.linkedAttributes.join(", "); content.append(linked);
  field(t("swade-better-effects.UI.RestrictedRollFlags"), "restrictedFlags", rule.rollFlags.join(", "));
  return foundry.applications.api.DialogV2.prompt({window: {title: t("swade-better-effects.UI.Restrict")},
    classes: ["sbe-app", "sbe-restriction-dialog"], position: {width: 460}, content, rejectClose: false,
    render: (_event, app) => {
      const root = app.element;
      const traits = root.querySelector('[name="restrictedTraits"]'), flags = root.querySelector('[name="restrictedFlags"]');
      const linked = root.querySelector("[data-linked-skills]");
      root.querySelector("[data-pick-restriction]").addEventListener("click", () => game.modules.get("swade-better-setting").api.openTraitPicker((value, entry) => {
        const current = restrictionData({traits: traits.value}).traits;
        traits.value = [...new Set([...current, value])].join(", ");
        rule.linkedAttributes = rule.linkedAttributes.filter(attr => attr !== value);
        if (entry.linkedSkills) rule.linkedAttributes.push(value);
        linked.textContent = rule.linkedAttributes.join(", ");
      }, {includeLinkedSkills: true, linkedAttributes: rule.linkedAttributes}));
      root.querySelector("[data-all-traits]").addEventListener("click", () => { traits.value = "*"; rule.linkedAttributes = []; linked.textContent = ""; });
      bindFlagSuggestions(flags, catalogFlags, {multiple: true, normalize: normalizePattern});
    },
    ok: {label: t("swade-better-effects.UI.SaveRestriction"), callback: (_event, button) => validateRestriction({
      traits: button.form.elements.restrictedTraits.value, rollFlags: button.form.elements.restrictedFlags.value, linkedAttributes: rule.linkedAttributes})}});
}
