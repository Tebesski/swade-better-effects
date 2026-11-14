import {TEMPLATE} from "./constants.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";
import {buildRollRequest} from "./requests.mjs";

export async function resolveOutcomeEffect(uuid) {
  if (!uuid) return null;
  const source = await foundry.utils.fromUuid(uuid).catch(() => null);
  if (!source?.visible) return null;
  const effects = source.documentName === "ActiveEffect" ? [source]
    : source.documentName === "Item" ? source.effects.contents : [];
  return effects.length ? {source, effects} : null;
}

function mountOutcomeEffect(row, fieldset) {
  const field = row.querySelector(".sbe-outcome-effect");
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
    hint.textContent = input.value ? "Effect unavailable" : "Drop an effect or an item containing effects";
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
    if (!reference) return ui.notifications.warn("Drop an accessible Active Effect or an item containing effects.");
    input.value = reference.source.uuid;
    await refresh();
  });
  clear.addEventListener("click", () => { input.value = ""; void refresh(); });
  void refresh();
}

export function lingeringConfig(data = {}) {
  return {
    enabled: !!data.enabled, timing: data.timing === "start" ? "start" : "end",
    trait: data.trait ?? "vigor", tn: data.tn ?? 4, required: data.required ?? 1,
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
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} must be a whole number of at least ${minimum}.`);
  return number;
}

function readConfig(form) {
  const enabled = form.elements.enabled.checked;
  const read = (row, minimum) => {
    const field = name => row.querySelector(`[data-field="${name}"]`).value.trim();
    const damage = field("damage");
    if (enabled && damage && !isDamageFormula(damage)) throw new Error("Enter a valid damage formula, such as 1d6x+2.");
    const progress = enabled ? wholeNumber(field("progress"), 0, "Progress") : Number(field("progress"));
    return {progress, damage, message: field("message"), effectUuid: field("effect"),
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
  if (enabled && new Set(raises.map(row => row.threshold)).size !== raises.length) throw new Error("Set a different threshold for each raise outcome.");
  const trait = form.elements.trait.value.trim();
  const tn = form.elements.tn.value;
  if (enabled) buildRollRequest({trait, tn});
  return {enabled, timing: form.elements.timing.value, trait, tn: tn === "" ? 4 : Number(tn),
    required: enabled ? wholeNumber(form.elements.required.value, 1, "Successes needed") : Number(form.elements.required.value), outcomes, raises};
}

export async function configureLingering(data, actor) {
  const config = lingeringConfig(data);
  const traits = [...Object.entries(CONFIG.SWADE.attributes).map(([key, attribute]) => ({value: key, label: game.i18n.localize(attribute.long)})),
    ...(actor?.items?.filter(item => item.type === "skill").map(item => ({value: item.name, label: item.name})) ?? [])];
  const view = (key, label, value) => ({key, label, ...value, raise: key === "raise", optional: ["critical", "raise"].includes(key)});
  const rows = [view("fail", "Failure", config.outcomes.fail), view("success", "Success", config.outcomes.success)];
  if (config.outcomes.critical) rows.unshift(view("critical", "Critical Failure", config.outcomes.critical));
  rows.push(...config.raises.map(outcome => view("raise", "Raise", outcome)));
  const render = foundry.applications.handlebars.renderTemplate;
  const renderOutcome = row => render(`${TEMPLATE}/lingering-outcome.hbs`, row);
  const [criticalRow, raiseRow, ...savedRows] = await Promise.all([
    view("critical", "Critical Failure", config.outcomes.fail), view("raise", "Raise", {threshold: 1, ...config.outcomes.success}), ...rows
  ].map(renderOutcome));
  const content = await render(`${TEMPLATE}/lingering-config.hbs`, {config, start: config.timing === "start", traits, rows: savedRows});
  return foundry.applications.api.DialogV2.prompt({
    window: {title: "Lingering Effect"}, classes: ["sbe-app", "sbe-lingering-dialog"], position: {width: 510}, content, rejectClose: false,
    render: (_event, app) => {
      const form = app.element.querySelector("form");
      const fieldset = form.querySelector(".sbe-lingering-options");
      const rows = form.querySelector(".sbe-lingering-outcomes");
      const criticalButton = form.querySelector("[data-add-outcome='critical']");
      for (const row of rows.querySelectorAll("[data-outcome]")) mountOutcomeEffect(row, fieldset);
      const refresh = () => { criticalButton.hidden = !!rows.querySelector("[data-outcome='critical']"); };
      const toggle = () => { fieldset.disabled = !form.elements.enabled.checked; };
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
          event.target.closest("details").querySelector("summary").textContent = `Raise (at least ${event.target.value})`;
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
            row.querySelector("summary").textContent = `Raise (at least ${threshold})`;
          }
          rows.append(row);
          mountOutcomeEffect(row, fieldset);
        }
        event.target.closest("[data-remove-outcome]")?.closest("[data-outcome]").remove();
        refresh();
      });
      toggle(); refresh();
    },
    ok: {label: "Save", callback: (_event, button) => readConfig(button.form)}
  });
}
