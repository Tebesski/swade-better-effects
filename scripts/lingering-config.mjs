import {t as sbsI18n} from "./i18n.mjs";
import {TEMPLATE} from "./constants.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";
import {buildRollRequest} from "./requests.mjs";
import {outcomeEffects} from "./lingering-effects.mjs";

export async function resolveOutcomeEffect(uuid) {
  if (!uuid) return null;
  const source = await foundry.utils.fromUuid(uuid).catch(() => null);
  if (!source?.visible) return null;
  const effects = source.documentName === "ActiveEffect" ? [source]
    : source.documentName === "Item" ? source.effects.contents : [];
  return effects.length ? {source, effects} : null;
}

export function mountOutcomeEffect(row, fieldset, onChange = () => {}) {
  const field = row.matches(".sbe-outcome-effect") ? row : row.querySelector(".sbe-outcome-effect");
  const input = field.querySelector('[data-field="effect"]');
  const link = field.querySelector(".sbe-outcome-effect-link");
  const clear = field.querySelector(".sbe-outcome-effect-clear");
  const hint = field.querySelector(".sbe-outcome-effect-hint");
  let revision = 0;
  const refresh = async () => {
    const version = ++revision;
    const reference = await resolveOutcomeEffect(input.value);
    if (!field.isConnected || revision !== version) return;
    link.hidden = !reference;
    clear.hidden = !input.value;
    hint.hidden = !!reference;
    const list = field.closest(".sbe-outcome-effects");
    if (list) {
      const populated = [...list.querySelectorAll('[data-field="effect"]')].some(entry => entry.value);
      for (const heading of list.querySelectorAll("strong")) heading.hidden = populated;
    } else field.querySelector("strong").hidden = !!input.value;
    const removal = field.querySelector(".sbe-remove-with-parent");
    if (removal) removal.hidden = !input.value;
    hint.textContent = input.value ? sbsI18n("swade-better-effects.UI.Effectunavailable_74ddafacf0") : sbsI18n("swade-better-effects.UI.Dropaneffectoranitem_a0378c9b24");
    if (!reference) return;
    const {source} = reference;
    link.querySelector("img").src = source.img;
    link.querySelector("span").textContent = source.name;
    link.onclick = () => source.sheet?.render({force: true});
  };
  field.addEventListener("dragover", event => { if (!fieldset.disabled) event.preventDefault(); });
  field.addEventListener("drop", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (fieldset.disabled) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const reference = ["ActiveEffect", "Item"].includes(data.type) ? await resolveOutcomeEffect(data.uuid) : null;
    if (!reference) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.DropanaccessibleActiveEffector_1271ff1384"));
    input.value = reference.source.uuid;
    onChange(field);
    await refresh();
  });
  clear.addEventListener("click", () => { input.value = ""; onChange(field); void refresh(); });
  void refresh();
}

function mountOutcomeEffects(row, fieldset) {
  const list = row.querySelector(".sbe-outcome-effects");
  const empty = list.lastElementChild.cloneNode(true);
  const changed = field => {
    if (!field.querySelector('[data-field="effect"]').value) {
      if (list.children.length > 1) field.remove();
      return;
    }
    // Keep an empty drop area available after the selected effects.
    if ([...list.children].every(entry => entry.querySelector('[data-field="effect"]').value)) {
      const next = empty.cloneNode(true);
      list.append(next);
      mountOutcomeEffect(next, fieldset, changed);
    }
  };
  for (const field of list.children) mountOutcomeEffect(field, fieldset, changed);
}

export function lingeringConfig(data = {}) {
  return {
    enabled: !!data.enabled, timing: data.timing === "start" ? "start" : "end",
    trait: data.trait ?? "vigor", tn: data.tn ?? 4, required: data.required ?? 1, followingTurns: data.followingTurns !== false,
    modifier: data.modifier ?? 0, tnMode: data.tnMode === "opposed" ? "opposed" : "value",
    opposedTraits: data.opposedTraits ?? "",
    outcomes: {
      fail: data.outcomes?.fail ?? {progress: 0, damage: "", message: ""},
      success: data.outcomes?.success ?? {progress: 1, damage: "", message: ""},
      ...(data.outcomes?.critical ? {critical: data.outcomes.critical} : {})
    },
    raises: data.raises ?? []
  };
}

export function lingeringOutcome(config, result) {
  if (result.outcome === "Critical failure") return config.outcomes.critical ?? config.outcomes.fail;
  if (result.outcome === "Failure") return config.outcomes.fail;
  const matched = config.raises.findLast(row => row.threshold <= result.raises);
  return matched ?? config.outcomes.success;
}

function wholeNumber(value, minimum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(sbsI18n("swade-better-effects.UI.mustbeawholenumberof_06d27866ae", {p0: (label), p1: (minimum)}));
  return number;
}

function readConfig(form) {
  const enabled = form.elements.enabled.checked;
  const read = (row, minimum) => {
    const field = name => row.querySelector(`[data-field="${name}"]`).value.trim();
    const damage = field("damage");
    if (enabled && damage && !isDamageFormula(damage)) throw new Error(sbsI18n("swade-better-effects.UI.Enteravaliddamageformulasuch_fab5161a95"));
    const progress = enabled ? wholeNumber(field("progress"), 0, "Progress") : Number(field("progress"));
    const effects = [...row.querySelectorAll(".sbe-outcome-effect")].map(entry => ({
      uuid: entry.querySelector('[data-field="effect"]').value,
      removeWithParent: entry.querySelector('[data-field="removeWithParent"]').checked
    }));
    return {progress, damage, message: field("message"), effects: outcomeEffects({effects}),
      ...(minimum ? {threshold: enabled ? wholeNumber(field("threshold"), minimum, "Raises") : Number(field("threshold"))} : {})};
  };
  const outcomes = {};
  const raises = [];
  for (const row of form.querySelectorAll("[data-outcome]")) {
    const kind = row.dataset.outcome;
    const outcome = read(row, kind === "raise" ? 1 : 0);
    if (kind === "raise") raises.push(outcome);
    else outcomes[kind] = outcome;
  }
  raises.sort((a, b) => a.threshold - b.threshold);
  if (enabled && new Set(raises.map(row => row.threshold)).size !== raises.length) throw new Error(sbsI18n("swade-better-effects.UI.Setadifferentthresholdforeach_ab446cebfc"));
  const trait = form.elements.trait.value.trim();
  const tn = form.elements.tn.value;
  const modifier = Number(form.elements.modifier.value);
  const tnMode = form.elements.tnMode.value;
  const opposedTraits = form.elements.opposedTraits.value.trim();
  if (enabled) {
    buildRollRequest({trait, tn: tnMode === "value" ? tn : 4, modifier, allowFormula: true});
    if (tnMode === "opposed" && !opposedTraits.split(",").some(entry => entry.trim())) throw new Error(sbsI18n("swade-better-effects.UI.Chooseatleastoneopposingsource_8309941d31"));
  }
  return {enabled, timing: form.elements.timing.value, followingTurns: form.elements.followingTurns.checked, trait, tn: tn === "" ? 4 : Number(tn),
    modifier, tnMode, opposedTraits,
    required: enabled ? wholeNumber(form.elements.required.value, 1, sbsI18n("swade-better-effects.UI.Successesneeded_8eb23cdb59")) : Number(form.elements.required.value), outcomes, raises};
}

export async function configureLingering(data, actor) {
  const config = lingeringConfig(data);
  const traits = [...Object.entries(CONFIG.SWADE.attributes).map(([key, attribute]) => ({value: key, label: game.i18n.localize(attribute.long)})),
    ...(actor?.items?.filter(item => item.type === "skill").map(item => ({value: item.name, label: item.name})) ?? [])];
  const view = (key, label, value) => ({key, label, ...value, effects: outcomeEffects(value),
    raise: key === "raise", optional: ["critical", "raise"].includes(key)});
  const rows = [view("fail", "Failure", config.outcomes.fail), view("success", "Success", config.outcomes.success)];
  if (config.outcomes.critical) rows.unshift(view("critical", sbsI18n("swade-better-effects.UI.CriticalFailure_e551e13767"), config.outcomes.critical));
  rows.push(...config.raises.map(outcome => view("raise", "Raise", outcome)));
  const render = foundry.applications.handlebars.renderTemplate;
  const renderOutcome = row => render(`${TEMPLATE}/lingering-outcome.hbs`, row);
  const [criticalRow, raiseRow, ...savedRows] = await Promise.all([
    view("critical", sbsI18n("swade-better-effects.UI.CriticalFailure_e551e13767"), config.outcomes.fail), view("raise", "Raise", {threshold: 1, ...config.outcomes.success}), ...rows
  ].map(renderOutcome));
  const content = await render(`${TEMPLATE}/lingering-config.hbs`, {config, opposed: config.tnMode === "opposed", start: config.timing === "start", traits, rows: savedRows});
  return foundry.applications.api.DialogV2.prompt({
    window: {title: sbsI18n("swade-better-effects.UI.LingeringEffect_366f9570e8")}, classes: ["sbe-app", "sbe-lingering-dialog"], position: {width: 510}, content, rejectClose: false,
    render: (_event, app) => {
      const form = app.element.querySelector("form");
      const fieldset = form.querySelector(".sbe-lingering-options");
      const rows = form.querySelector(".sbe-lingering-outcomes");
      const criticalButton = form.querySelector("[data-add-outcome='critical']");
      const updateTN = () => {
        const opposed = form.elements.tnMode.value === "opposed";
        form.querySelector("[data-tn-value]").hidden = opposed;
        form.querySelector("[data-tn-opposed]").hidden = !opposed;
      };
      form.elements.tnMode.addEventListener("change", updateTN);
      updateTN();
      for (const button of form.querySelectorAll("[data-pick-lingering]")) {
        button.addEventListener("click", () => {
          const api = game.modules.get("swade-better-setting")?.api;
          if (!api?.openTraitPicker) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.BetterSettingstraitpickeris_8e7ee21eec"));
          api.openTraitPicker((value, entry) => {
            if (!form.isConnected) return;
            const name = entry.kind === "attribute" ? game.i18n.localize(CONFIG.SWADE.attributes[value].long) : value;
            const input = form.elements[button.dataset.pickLingering];
            input.value = button.dataset.pickLingering === "trait" ? name
              : [...new Set([...input.value.split(",").map(value => value.trim()).filter(Boolean), name])].join(", ");
          }, {classes: ["sbe-app"]});
        });
      }
      for (const row of rows.querySelectorAll("[data-outcome]")) mountOutcomeEffects(row, fieldset);
      const refresh = () => { criticalButton.hidden = !!rows.querySelector("[data-outcome='critical']"); };
      const toggle = () => {
        const disabled = !form.elements.enabled.checked;
        fieldset.disabled = disabled;
        fieldset.inert = disabled;
        fieldset.setAttribute("aria-disabled", String(disabled));
      };
      form.elements.enabled.addEventListener("change", toggle);
      const validate = event => {
        try { readConfig(form); }
        catch (error) {
          event.preventDefault();
          event.stopImmediatePropagation();
          ui.notifications.warn(error.message);
        }
      };
      form.addEventListener("submit", validate, {capture: true});
      form.querySelector("button[type='submit']").addEventListener("click", validate, {capture: true});
      rows.addEventListener("input", event => {
        if (event.target.dataset.field === "threshold") {
          event.target.closest("details").querySelector("summary").textContent = sbsI18n("swade-better-effects.UI.Raiseatleast_360c4924a8", {p0: (event.target.value)});
        }
      });
      fieldset.addEventListener("click", event => {
        const kind = event.target.closest("[data-add-outcome]")?.dataset.addOutcome;
        if (kind) {
          const row = foundry.utils.parseHTML(kind === "raise" ? raiseRow : criticalRow);
          row.open = true;
          if (kind === "raise") {
            const used = [...rows.querySelectorAll('[data-field="threshold"]')].map(input => Number(input.value));
            const threshold = Math.max(0, ...used) + 1;
            row.querySelector('[data-field="threshold"]').value = threshold;
            row.querySelector("summary").textContent = sbsI18n("swade-better-effects.UI.Raiseatleast_360c4924a8", {p0: (threshold)});
          }
          rows.append(row);
          mountOutcomeEffects(row, fieldset);
        }
        event.target.closest("[data-remove-outcome]")?.closest("[data-outcome]").remove();
        refresh();
      });
      toggle(); refresh();
    },
    ok: {label: sbsI18n("swade-better-effects.UI.Save_1509f561f2"), callback: (_event, button) => readConfig(button.form)}
  });
}
