import {EFFECT_TYPE, ICON, MAP_KEY, MODULE_ID, OPERATIONS, TEMPLATE} from "./constants.mjs";
import {changeSignature, conditionFor, emptyPredicate, hasCondition, normalizeFlag, selectorForKey, validatePredicate} from "./rules.mjs";
import {mountPredicate} from "./predicate-ui.mjs";
import {changeGroups} from "./change-presets.mjs";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";
import {catalogFlags} from "./flags.mjs";
import {effectiveFlags, flagInputData} from "./default-flags.mjs";
import {NOTE_PREFIX, noteBaseKey, noteChangeKey, noteSelectorForKey} from "./note-rules.mjs";
import {cleanRollNote} from "./roll-notes.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";

let Wizard;
const openEditors = new Map();
const valueText = value => value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");

export function initializeWizard() {
  const Base = game.swade.apps.ActiveEffectWizard;
  Wizard = class BetterEffectWizard extends Base {
    constructor({document, effect}) {
      super({document});
      this.effect = effect;
      this.draft = effect?.toObject() ?? {name: document.name, img: document.img || ICON, type: "base", system: {changes: []}, duration: {value: null, units: "rounds", expiry: null}, transfer: document.documentName === "Item" && document.type !== "power"};
      const data = this.draft.flags?.[MODULE_ID] ?? {};
      this.rows = (this.draft.system.changes ?? []).map((change, index) => ({...change,
        ...(change.key.startsWith(NOTE_PREFIX) ? {key: noteBaseKey(change.key) ?? "", type: "note"} : {}), label: change.key,
        predicate: structuredClone(conditionFor(change, index, data.conditions) ?? data.conditions?.[index]?.predicate ?? emptyPredicate())}));
      this.editorKey = effect?.uuid ?? document.uuid;
      this.presetStates = {attribute: false, skill: false, derived: false, globalMod: false, other: false};
    }

    static DEFAULT_OPTIONS = {
      classes: ["sbe-aegis"],
      position: {width: 680, height: 660},
      form: {handler: async function () { await this.save(); }, closeOnSubmit: false},
      actions: {
        addChange: function (_event, target) { this.addPreset(target); },
        deleteChange: function (_event, target) { this.capture(); this.rows.splice(Number(target.closest("[data-index]").dataset.index), 1); this.render(); },
        generateFlag: function (_event, target) {
          this.capture();
          const flag = normalizeFlag(this.draft.name);
          if (!flag) return ui.notifications.warn("Enter an effect name that can generate a flag.");
          const row = target.closest(".sbe-flag-change");
          this.rows[Number(row.dataset.index)].value = flag;
          row.querySelector('[data-field="value"]').value = flag;
        },
        clickIcon: function () { new CONFIG.ux.FilePicker({type: "image", current: this.draft.img, callback: path => { this.capture(); this.draft.img = path; this.render(); }}).render({force: true}); },
        standardEditor: async function () { await this.openStandardEditor(); },
        editNote: async function (_event, target) { await this.editNote(Number(target.closest("[data-index]").dataset.index)); }
      }
    };
    static PARTS = {
      ...Base.PARTS,
      form: {...Base.PARTS.form, scrollable: [...(Base.PARTS.form.scrollable ?? []), ".preview"]}
    };

    _getHeaderControls() {
      return [...super._getHeaderControls(), {action: "standardEditor", icon: "fa-solid fa-sliders", label: "Standard Active Effect editor", onClick: () => this.openStandardEditor()}];
    }

    async openStandardEditor() {
      if (await this.save(false)) { await this.close(); this.effect.sheet.render({force: true}); }
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (!this.effect && !this.nativeDefaultsApplied) {
        this.draft.name = context.effect.name;
        this.draft.img = context.effect.img;
        this.nativeDefaultsApplied = true;
      }
      const labels = new Map([...context.derivedPresets, ...context.globalModPresets, ...context.otherPresets, {key: MODIFY_FLAG_KEY, label: "Modify flag"}, {key: MAP_KEY, label: "Modify MAP"}].map(p => [p.key, p.label]));
      this.changeGroups = changeGroups(context);
      const changeLabel = row => {
        if (labels.has(row.key)) return labels.get(row.key);
        const attribute = row.key.match(/^system\.attributes\.([^.]+)\.(.+)$/);
        const suffixes = {"die.sides": "SWADE.DieSides", "wild-die.sides": "SWADE.WildDieSides", "die.modifier": "SWADE.Modifier"};
        const suffix = key => suffixes[key] ? game.i18n.localize(suffixes[key]) : key;
        if (attribute && context.attributes[attribute[1]]) return `${game.i18n.localize(context.attributes[attribute[1]])} ${suffix(attribute[2])}`;
        const skill = row.key.match(/^@Skill\{(.+)\}\[system\.(.+)\]$/);
        return skill ? `${skill[1]} ${suffix(skill[2])}` : row.label === row.key ? "Custom change" : row.label;
      };
      const changeTypes = {...context.changeTypes};
      for (const row of this.rows) if (row.type !== "note") changeTypes[row.type] ??= foundry.documents.ActiveEffect.CHANGE_TYPES[row.type]?.label ?? row.type;
      return {...context, effect: {...this.draft, duration: {...this.draft.duration, rounds: this.draft.duration.units === "rounds" ? this.draft.duration.value : null}},
        changes: this.rows.map(row => ({...row, label: changeLabel(row), value: valueText(row.value)})), changeTypes,
        globalModPresets: this.changeGroups.global.map(g => ({key: g.options[0].key, label: g.label})),
        otherPresets: this.changeGroups.other.map(g => ({key: g.options[0].key, label: g.label})),
        collapsibleStates: {...context.collapsibleStates, ...this.presetStates},
        buttons: this.effect ? [{...context.buttons[0], icon: "fa-solid fa-save", label: "Save Effect"}] : context.buttons};
    }

    _onChangeForm(_config, event) {
      if (event.target.closest(".sbe-condition")) return;
      this.capture();
      if (event.target.matches(".target")) this[event.target.name] = event.target.value;
      if (event.target.matches(".sbe-change select.type")) this.render();
    }

    capture() {
      if (!this.element) return;
      const value = name => this.element.querySelector(`[name="${name}"]`)?.value;
      const tags = value("sbe.effectTags");
      if (tags !== undefined && tags !== this.displayedFlags) {
        const next = flagInputData({...this.draft, documentName: "ActiveEffect"}, tags);
        this.draft.flags ??= {};
        this.draft.flags[MODULE_ID] = {...this.draft.flags[MODULE_ID], ...next};
      }
      this.draft.name = value("name") ?? this.draft.name;
      const duration = value("duration.value");
      if (duration !== undefined) this.draft.duration = {...this.draft.duration, value: duration === "" ? null : Number(duration), units: value("duration.units") ?? this.draft.duration.units};
      const expiry = value("duration.expiry");
      if (expiry !== undefined) this.draft.duration.expiry = expiry || null;
      const conditional = this.element.querySelector('[name="system.conditionalEffect"]');
      if (conditional) this.draft.system.conditionalEffect = conditional.checked;
      this.element.querySelectorAll(".sbe-change[data-index]").forEach(row => {
        const draft = this.rows[Number(row.dataset.index)];
        const type = row.querySelector("select.type").value;
        draft.conditionsOpen = row.querySelector(".sbe-condition-details")?.open ?? false;
        const rawValue = row.querySelector('[data-field="value"]').value;
        if (type !== draft.type && (type === "note" || draft.type === "note")) {
          draft[draft.type === "note" ? "noteText" : "numericValue"] = rawValue;
          draft.value = draft[type === "note" ? "noteText" : "numericValue"] ?? "";
        } else if (rawValue !== valueText(draft.value)) draft.value = draft.value !== null && typeof draft.value === "object" ? JSON.parse(rawValue) : rawValue;
        draft.type = type;
      });
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const basics = this.element.querySelector(".effect-basics");
      basics.querySelector(".sbe-effect-flags")?.remove();
      const group = document.createElement("div"); group.className = "form-group sbe-effect-flags";
      const label = document.createElement("label"); label.textContent = "Flags";
      const fields = document.createElement("span"); fields.className = "form-fields";
      const flagsInput = document.createElement("input"); flagsInput.type = "text"; flagsInput.name = "sbe.effectTags";
      flagsInput.id = `${this.id}-effect-flags`; label.htmlFor = flagsInput.id;
      flagsInput.setAttribute("aria-label", "Effect flags"); flagsInput.placeholder = "fire, silver";
      const list = document.createElement("datalist"); list.id = `${this.id}-effect-flags-list`; flagsInput.setAttribute("list", list.id);
      const suggestions = () => {
        const parts = flagsInput.value.split(","); parts.pop(); const prefix = parts.map(part => part.trim()).filter(Boolean).join(", ");
        list.replaceChildren(...catalogFlags().map(flag => new Option(flag, prefix ? `${prefix}, ${flag}` : flag)));
      };
      const refreshFlags = () => {
        flagsInput.value = effectiveFlags({...this.draft, documentName: "ActiveEffect"}).join(", ");
        this.displayedFlags = flagsInput.value; suggestions();
      };
      refreshFlags(); flagsInput.addEventListener("input", suggestions);
      flagsInput.addEventListener("change", () => { this.capture(); refreshFlags(); });
      basics.querySelector('[name="name"]').addEventListener("input", () => { this.capture(); refreshFlags(); });
      fields.append(flagsInput, list); group.append(label, fields); basics.querySelector(".name").after(group);
      const durationInput = basics.querySelector('[name="duration.rounds"], [name="duration.value"]');
      durationInput.name = "duration.value"; durationInput.value = this.draft.duration.value ?? ""; durationInput.min = "0"; durationInput.step = "1";
      basics.querySelector(".turns label").textContent = "Duration";
      basics.querySelector('[name="duration.units"]')?.remove();
      const units = document.createElement("select"); units.name = "duration.units"; units.setAttribute("aria-label", "Duration unit");
      const durationUnits = {rounds: "Rounds", minutes: "Minutes", hours: "Hours"};
      const currentUnit = this.draft.duration.units ?? "rounds";
      if (!(currentUnit in durationUnits)) durationUnits[currentUnit] = game.i18n.localize(`EFFECT.DURATION.UNITS.${currentUnit}`);
      for (const [unit, text] of Object.entries(durationUnits)) units.append(new Option(text, unit, false, unit === currentUnit));
      durationInput.after(units);
      // Native A.E.G.I.S. installs animated click handlers on summary elements.
      // Replace only those summaries, keeping the same details and native markup.
      this.element.querySelectorAll(".presets details").forEach(details => {
        const previous = details.querySelector(":scope > summary");
        previous.replaceWith(previous.cloneNode(true));
        details.addEventListener("toggle", () => { this.presetStates[details.dataset.category] = details.open; });
      });
      this.element.querySelectorAll('input[type="checkbox"], select[name="duration.expiry"]').forEach((input, index) => {
        input.id = `${this.id}-option-${index}`;
        const label = input.closest(".form-group")?.querySelector("label");
        if (label) label.htmlFor = input.id;
      });
      for (const button of this.element.querySelectorAll('.button-list button:nth-child(3)')) {
        const siblings = [...button.parentElement.querySelectorAll("button")];
        // The same three native component choices move into the preview dropdown.
        if (siblings.length === 3) { siblings[0].textContent = "Add"; siblings.slice(1).forEach(b => b.remove()); }
      }
      for (const button of this.element.querySelectorAll('.other-presets [data-action="addChange"]')) {
        const names = {[MODIFY_FLAG_KEY]: "Add flag rule", [MAP_KEY]: "Add MAP modifier", "sbe.targetRoll.trait": "Add targeting modifier"};
        button.textContent = names[button.dataset.key] ?? `Add ${button.textContent.trim()}`;
      }
      const preview = this.element.querySelector(".preview");
      preview.querySelectorAll(".changes-list > li[data-index]").forEach(row => {
        if (row.classList.contains("sbe-change")) return;
        const draft = this.rows[Number(row.dataset.index)];
        row.classList.add("sbe-change");
        row.querySelector("select.type").dataset.field = "type";
        const value = row.querySelector("input.value");
        value.dataset.field = "value";
        value.setAttribute("aria-label", "Change value");
        if (noteSelectorForKey(draft.key)) {
          const type = row.querySelector("select.type");
          type.append(new Option("Note", "note")); type.value = draft.type;
        }
        if (draft.type === "note") {
          row.classList.add("sbe-note-change");
          value.type = "hidden"; value.classList.remove("value");
          const edit = document.createElement("button"); edit.type = "button"; edit.className = "value sbe-edit-note";
          edit.dataset.action = "editNote"; edit.setAttribute("aria-label", "Edit note"); edit.title = "Edit formatted note";
          edit.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>';
          value.after(edit);
          const preview = document.createElement("div"); preview.className = "sbe-note-preview";
          preview.innerHTML = cleanRollNote(draft.value);
          if (!preview.textContent.trim() && !preview.querySelector("img")) preview.textContent = "Click the pen to write a note.";
          row.append(preview);
        }
        if (draft.key === MODIFY_FLAG_KEY) {
          row.classList.add("sbe-flag-change");
          const type = row.querySelector("select.type");
          type.replaceChildren(new Option("Add", "add"), new Option("Suppress", "subtract"));
          type.value = draft.type;
          value.setAttribute("aria-label", "Flag name");
          value.placeholder = "aggressive-stance";
          const list = document.createElement("datalist"); list.id = `${this.id}-flag-${row.dataset.index}`;
          list.replaceChildren(...catalogFlags().map(flag => new Option(flag, flag)));
          value.setAttribute("list", list.id); row.append(list);
          value.addEventListener("change", () => { draft.value = normalizeFlag(value.value); value.value = draft.value; });
        }
        const group = this.changeGroups.all.find(group => group.options.some(p => p.key === draft.key));
        let choices = group?.options;
        const component = draft.key.match(/^(system\.attributes\.[^.]+\.|@Skill\{.+\}\[system\.)(.+?)(\]?)$/);
        const attributeNote = draft.type === "note" && draft.key.startsWith("system.attributes.");
        if (component && ["die.sides", "wild-die.sides", "die.modifier"].includes(component[2])) choices = [
          ["die.sides", "Die Sides"], ["wild-die.sides", "Wild Die Sides"], ["die.modifier", "Modifier"]
        ].map(([key, label]) => ({key: `${component[1]}${key}${component[3]}`, label}));
        if (choices?.length > 1) {
          const label = row.querySelector(".label");
          label.replaceChildren();
          if (group?.id === "targeting" || component) {
            const title = document.createElement("small");
            const attribute = draft.key.match(/^system\.attributes\.([^.]+)\./)?.[1];
            title.textContent = group?.id === "targeting" ? "Modify targeting roll"
              : attribute ? game.i18n.localize(context.attributes[attribute]) : draft.key.match(/^@Skill\{(.+)\}/)?.[1];
            label.append(title);
          }
          const select = document.createElement("select"); select.className = "sbe-change-selector"; select.setAttribute("aria-label", "Change");
          for (const option of choices) { const entry = new Option(option.label, option.key); entry.selected = option.key === draft.key; select.append(entry); }
          select.addEventListener("change", event => { event.stopPropagation(); this.capture(); draft.key = select.value; draft.label = select.selectedOptions[0].textContent; });
          label.append(select);
        }
        if (attributeNote) {
          row.classList.add("sbe-attribute-note");
          row.querySelector(".label").hidden = true;
          const attribute = draft.key.match(/^system\.attributes\.([^.]+)\./)?.[1];
          const name = game.i18n.localize(context.attributes[attribute]);
          row.setAttribute("aria-label", `${name} note`);
          const scope = document.createElement("strong"); scope.className = "sbe-note-scope"; scope.textContent = name;
          row.querySelector(".sbe-note-preview").prepend(scope);
        }
        const trash = row.querySelector('[data-action="deleteChange"]');
        const link = document.createElement("a"); link.className = "delete-change sbe-trash"; link.dataset.action = "deleteChange"; link.role = "button"; link.tabIndex = 0;
        link.setAttribute("aria-label", "Remove change"); link.title = "Remove change"; link.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
        link.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); link.click(); } });
        trash.replaceWith(link);
        if (draft.key === MODIFY_FLAG_KEY) {
          const generate = document.createElement("a"); generate.className = "sbe-generate-flag"; generate.dataset.action = "generateFlag"; generate.role = "button"; generate.tabIndex = 0;
          generate.setAttribute("aria-label", "Generate flag from name"); generate.title = "Generate flag from name";
          generate.innerHTML = '<i class="fa-solid fa-asterisk" aria-hidden="true"></i>';
          generate.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); generate.click(); } });
          link.before(generate);
          return;
        }
        const details = document.createElement("details"); details.className = "sbe-condition-details"; details.open = draft.conditionsOpen ?? false;
        const summary = document.createElement("summary"); summary.textContent = "Conditions";
        const container = document.createElement("div"); container.className = "sbe-condition";
        details.append(summary, container); row.append(details);
        mountPredicate(container, draft.predicate);
      });
      preview.classList.toggle("sbe-attribute-notes-only", !!this.rows.length && this.rows.every(row => row.type === "note" && row.key.startsWith("system.attributes.")));
    }

    addPreset(target) {
      this.capture();
      const details = target.closest("details"); const category = details?.dataset.category;
      const selected = details?.querySelector(".target")?.value;
      let key = target.dataset.key;
      let label = target.textContent.trim();
      if (category === "skill") {
        if (!selected?.trim()) return ui.notifications.warn("Enter a skill name first.");
        key = `@Skill{${selected.trim()}}[system.${key}]`; label = `${selected} ${label}`;
      } else if (category === "attribute") { key = `system.attributes.${selected}.${key}`; label = `${selected} ${label}`; }
      this.rows.push({key, label, type: "add", value: "", phase: "initial", priority: null, predicate: emptyPredicate()});
      this.render();
    }

    async editNote(index) {
      this.capture(); const row = this.rows[index];
      if (row?.type !== "note") return;
      const content = document.createElement("div");
      const editor = foundry.applications.elements.HTMLProseMirrorElement.create({name: "note", value: cleanRollNote(row.value),
        height: 260, documentUUID: this.document.uuid});
      content.append(editor);
      const value = await foundry.applications.api.DialogV2.prompt({window: {title: "Edit roll note", icon: "fa-solid fa-note-sticky"},
        classes: ["sbe-app", "sbe-note-editor"], position: {width: 560}, modal: true, content, rejectClose: false,
        ok: {label: "Save note", callback: (_event, _button, dialog) => dialog.element.querySelector("prose-mirror").value}});
      if (value === null) return;
      row.value = cleanRollNote(value); this.render();
    }

    async save(close = true) {
      if (!this.document.isOwner || (this.effect && !this.effect.isOwner)) return false;
      this.capture();
      if (!this.draft.name.trim()) throw new Error("Enter an effect name.");
      if (this.draft.duration.value !== null && (!Number.isInteger(this.draft.duration.value) || this.draft.duration.value < 0)) throw new Error("Duration must be a non-negative whole number or left blank.");
      for (const row of this.rows) {
        if (!row.key?.trim()) throw new Error("Each change needs a data path.");
        if (row.key === MODIFY_FLAG_KEY) {
          row.value = normalizeFlag(row.value);
          if (!row.value || !["add", "subtract"].includes(row.type)) throw new Error("Choose Add or Suppress and enter a flag name.");
          row.predicate = emptyPredicate();
        }
        if (!validatePredicate(row.predicate)) throw new Error("Complete every condition: choose a flag or remove the empty condition.");
        if (row.type === "note") {
          if (!noteSelectorForKey(row.key)) throw new Error("Choose a roll change for this note.");
          row.value = cleanRollNote(row.value);
          if (!row.value.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(row.value)) throw new Error("Enter some text for each note.");
          continue;
        }
        if (hasCondition(row.predicate) || row.key.startsWith("sbe.targetRoll.") || row.key.startsWith("sbe.powerRoll.") || row.key === MAP_KEY) {
          const selector = selectorForKey(row.key);
          if (!selector || !Object.hasOwn(OPERATIONS, row.type)) throw new Error("This change does not support automatic conditions.");
          if (!Number.isFinite(Number(row.value))) {
            if (selector !== "outgoing-damage") throw new Error("Enter a finite number for this change.");
            if (!isDamageFormula(row.value)) throw new Error("Enter a valid Damage formula, such as 1d6x+2.");
          }
        }
      }
      const changes = this.rows.map(({label, predicate, conditionsOpen, numericValue, noteText, ...change}) => ({...change,
        ...(change.type === "note" ? {key: noteChangeKey(change.key), type: "add"} : {}),
        phase: change.phase ?? "initial", priority: change.priority ?? null}));
      const conditions = changes.map((change, index) => ({signature: changeSignature(change), predicate: this.rows[index].predicate}));
      const flags = {...this.draft.flags, [MODULE_ID]: {...this.draft.flags?.[MODULE_ID], nameFlag: normalizeFlag(this.draft.name), conditions}};
      const data = {name: this.draft.name, img: this.draft.img, duration: this.draft.duration, system: {...this.draft.system, changes}, flags};
      if (this.effect) await this.effect.update(data);
      else {
        const [created] = await this.document.createEmbeddedDocuments("ActiveEffect", [{...data, type: this.draft.type, transfer: this.draft.transfer, start: null}]);
        this.effect = created;
      }
      if (this.document.type === EFFECT_TYPE) await this.document.update({name: data.name, img: data.img});
      if (close) await this.close();
      return true;
    }

    async _onClose(options) { openEditors.delete(this.editorKey); await super._onClose(options); }
  };
  return Wizard;
}

export function openAegis(document, effect) {
  if (!document?.isOwner || effect && !effect.isOwner) return ui.notifications.warn("You need ownership to edit this effect.");
  const key = effect?.uuid ?? document.uuid;
  const existing = openEditors.get(key);
  if (existing) { existing.render({force: true}); existing.bringToFront(); return existing; }
  const app = new Wizard({document, effect}); openEditors.set(key, app); app.render({force: true}); return app;
}

export async function editEffectSource(source, name) {
  const scratch = await Item.create({name, type: "gear", img: ICON, effects: source ? [source] : [],
    flags: {[MODULE_ID]: {scratch: true}}, ownership: {[game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER}});
  if (!scratch) return null;
  let app;
  try { app = openAegis(scratch, scratch.effects.contents[0]); }
  catch (error) { await scratch.delete(); throw error; }
  if (!app) { await scratch.delete(); return null; }
  return new Promise((resolve, reject) => {
    const hook = Hooks.on("closeApplicationV2", async closed => {
      if (closed !== app) return;
      Hooks.off("closeApplicationV2", hook);
      const effect = scratch.effects.contents[0]?.toObject();
      if (effect) { delete effect._id; delete effect._stats; }
      try { await scratch.delete(); resolve(effect ?? null); }
      catch (error) { reject(error); }
    });
  });
}

export async function chooseEditor(effect) {
  if (!effect?.isOwner) return effect?.sheet.render({force: true});
  return foundry.applications.api.DialogV2.wait({classes: ["sbe-app"], window: {title: `Edit Effect: ${effect.name}`, icon: "fa-solid fa-person-rays"}, buttons: [
    {action: "aegis", label: "Effect builder", icon: "fa-solid fa-shield-quartered", callback: () => openAegis(effect.parent, effect)},
    {action: "standard", label: "Manual edit", icon: "fa-solid fa-sliders", callback: () => effect.sheet.render({force: true})}
  ], rejectClose: false});
}

export class EffectItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.DocumentSheetV2) {
  static DEFAULT_OPTIONS = {classes: ["sbe-app", "sbe-effect-chooser"], position: {width: 360}, window: {icon: "fa-solid fa-person-rays"},
    actions: {
      aegis: async function () { await this.editEffect("aegis"); },
      standard: async function () { await this.editEffect("standard"); }
    }};
  static PARTS = {form: {template: `${TEMPLATE}/effect-item.hbs`}};
  async _prepareContext(options) {
    return {...await super._prepareContext(options), item: this.document, editable: this.document.isOwner};
  }
  async editEffect(editor) {
    if (editor === "aegis" && !this.document.isOwner) return;
    const effects = this.document.effects.contents;
    await this.close();
    let effect = effects[0];
    // Imported templates may contain several effects. Keep them all accessible
    // without repeating the editor buttons in the compact chooser.
    if (effects.length > 1) {
      const select = document.createElement("select");
      select.name = "effectId";
      select.setAttribute("aria-label", "Effect");
      for (const entry of effects) select.append(new Option(entry.name, entry.id));
      const id = await foundry.applications.api.DialogV2.prompt({classes: ["sbe-app"], window: {title: this.document.name}, content: select.outerHTML,
        ok: {label: editor === "aegis" ? "Effect builder" : "Manual edit",
          callback: (_event, button) => button.form.elements.effectId.value}, rejectClose: false});
      if (!id) return;
      effect = this.document.effects.get(id);
    }
    if (editor === "aegis") return openAegis(this.document, effect);
    return effect?.sheet.render({force: true});
  }
  async render(options, ...args) {
    if (!this.document.effects.size && this.isEditable) return openAegis(this.document);
    return super.render(options, ...args);
  }
}

export function injectEditorButtons(app, html) {
  const doc = app.document;
  if (!doc) return;
  if (["Actor", "Item"].includes(doc.documentName)) {
    html.addEventListener("click", event => {
      const button = event.target.closest('[data-action="openEffect"], [data-action="editEffect"], .effect-edit');
      const row = button?.closest("[data-effect-uuid], [data-effect-id]");
      if (!row) return;
      const {effectUuid, effectId, parentId} = row.dataset;
      // The actor's Effects tab also lists effects owned by its embedded items.
      const parent = parentId && parentId !== doc.id ? doc.items?.get(parentId) : doc;
      const effect = effectUuid ? foundry.utils.fromUuid(effectUuid) : parent?.effects.get(effectId);
      if (!effect) return;
      event.preventDefault(); event.stopImmediatePropagation();
      Promise.resolve(effect).then(chooseEditor).catch(error => ui.notifications.error(error.message));
    }, {capture: true});
  } else if (doc.documentName === "ActiveEffect" && doc.isOwner && !html.querySelector(".sbe-open-aegis")) {
    const button = document.createElement("button"); button.type = "button"; button.className = "sbe-open-aegis"; button.textContent = "Edit in A.E.G.I.S. (conditions)";
    button.addEventListener("click", async event => {
      event.stopPropagation();
      // The standard sheet retains ownership of its fields until it has submitted them.
      await app.submit(); await app.close(); openAegis(doc.parent, doc);
    });
    (html.querySelector(".window-content") ?? html).prepend(button);
    const conditions = doc.getFlag(MODULE_ID, "conditions") ?? [];
    if (conditions.some(c => hasCondition(c?.predicate))) {
      const hint = document.createElement("p"); hint.className = "hint sbe-rule-warning";
      hint.textContent = "This effect has automatic conditions. Use A.E.G.I.S. to edit conditioned changes; changing their path, value, order, or operation here invalidates their conditions.";
      button.after(hint);
    }
  }
}
