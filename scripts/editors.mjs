import {t as sbsI18n} from "./i18n.mjs";
import {ADD_ITEM_KEY, APPLICATION_KEY, DEFENSES, EFFECT_TYPE, ICON, MAP_KEY, MODULE_ID, OPERATIONS, RESTRICT_KEY, SUPPRESS_KEY, TEMPLATE} from "./constants.mjs";
import {changeSignature, conditionFor, customChangeName, emptyPredicate, hasCondition, isOwnerCondition, normalizeFlag, normalizeFlags, normalizePattern, selectorForKey, validatePredicate} from "./rules.mjs";
import {mountPredicate} from "./predicate-ui.mjs";
import {changeGroups} from "./change-presets.mjs";
import {MODIFY_FLAG_KEY, suppressionFlags} from "./flag-changes.mjs";
import {catalogFlags} from "./flags.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";
import {effectiveFlags, flagInputData} from "./default-flags.mjs";
import {NOTE_PREFIX, noteBaseKey, noteChangeKey, noteSelectorForKey} from "./note-rules.mjs";
import {cleanRollNote} from "./roll-notes.mjs";
import {isDamageFormula} from "./damage-formulas.mjs";
import {grantEquipOptions, isItemEffect, readItemGrant, resolveGrantItem} from "./item-effects.mjs";
import {configureLingering} from "./lingering-config.mjs";
import {configureRestriction} from "./restriction-config.mjs";
import {validateRestriction} from "./restriction-data.mjs";
import {configureApplication, validateApplication} from "./application-config.mjs";
import {APPLICATION_BEHAVIOURS, APPLICATION_CONDITIONS} from "./application-data.mjs";

let Wizard;
const openEditors = new Map();
const valueText = value => value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");

export function initializeWizard() {
  const Base = game.swade.apps.ActiveEffectWizard;
  Wizard = class BetterEffectWizard extends Base {
    constructor({document, effect, itemEffect}) {
      super({document});
      this.effect = effect;
      this.draft = effect?.toObject() ?? {name: document.name, img: document.img || ICON, type: "base", system: {changes: []}, duration: {value: null, units: "rounds", expiry: null}, transfer: document.documentName === "Item" && document.type !== "power"};
      // The Item owns the template name, including copies made before name sync.
      if (document.type === EFFECT_TYPE && document.effects.size === 1) this.draft.name = document.name;
      if (!this.draft.duration?.units || this.draft.duration.units === "seconds") {
        this.draft.duration = {...this.draft.duration, units: "rounds"};
      }
      const data = this.draft.flags?.[MODULE_ID] ?? {};
      this.itemEffect = document.documentName === "Item" && document.type !== EFFECT_TYPE && (itemEffect || !!data.itemEffect);
      if (this.itemEffect) {
        this.draft.duration = {value: null, units: "rounds", expiry: null};
        this.draft.transfer = true;
      }
      this.rows = (this.draft.system.changes ?? []).map((change, index) => ({...change,
        customName: customChangeName(change, index, data.conditions),
        ...(change.key === ADD_ITEM_KEY ? {grant: readItemGrant(change.value)} : {}),
        ...(change.key.startsWith(NOTE_PREFIX) ? {key: noteBaseKey(change.key) ?? "", type: "note"} : {}), label: change.key,
        predicate: structuredClone(conditionFor(change, index, data.conditions) ?? data.conditions?.[index]?.predicate ?? emptyPredicate())}));
      this.editorKey = effect?.uuid ?? document.uuid;
      this.presetStates = {attribute: false, skill: false, derived: false, globalMod: false, other: false, better: false};
    }

    static DEFAULT_OPTIONS = {
      classes: ["sbe-aegis"],
      position: {width: 680, height: 660},
      form: {handler: async function () { await this.save(); }, closeOnSubmit: false},
      actions: {
        addChange: async function (_event, target) { await this.addPreset(target); },
        editRestriction: async function (_event, target) {
          this.capture();
          const row = this.rows[Number(target.closest("[data-index]").dataset.index)];
          const value = await configureRestriction(row.value);
          if (value) { row.value = value; this.render(); }
        },
        editApplication: async function (_event, target) {
          this.capture();
          const row = this.rows[Number(target.closest("[data-index]").dataset.index)];
          const rule = await this.configureApplication(row.value);
          if (rule) { row.value = rule; this.render(); }
        },
        deleteChange: function (_event, target) { this.capture(); this.rows.splice(Number(target.closest("[data-index]").dataset.index), 1); this.render(); },
        generateFlag: function (_event, target) {
          this.capture();
          const flag = normalizeFlag(this.draft.name);
          if (!flag) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Enteraneffectnamethatcan_fb984aaed5"));
          const row = target.closest(".sbe-flag-change");
          const change = this.rows[Number(row.dataset.index)];
          change.value = normalizeFlags([...normalizeFlags(change.value), flag]).join(", ");
          row.querySelector('[data-field="value"]').value = change.value;
        },
        clickIcon: function () { new CONFIG.ux.FilePicker({type: "image", current: this.draft.img, callback: path => { this.capture(); this.draft.img = path; this.render(); }}).render({force: true}); },
        standardEditor: async function () { await this.openStandardEditor(); },
        lingering: async function () {
          this.capture();
          const actor = this.document.documentName === "Actor" ? this.document : this.document.actor;
          const config = await configureLingering(this.draft.flags?.[MODULE_ID]?.lingering, actor);
          if (!config) return;
          this.capture();
          this.draft.flags ??= {};
          (this.draft.flags[MODULE_ID] ??= {}).lingering = config;
          this.render();
        },
        editNote: async function (_event, target) { await this.editNote(Number(target.closest("[data-index]").dataset.index)); }
      }
    };
    static PARTS = {
      ...Base.PARTS,
      form: {...Base.PARTS.form, scrollable: [...(Base.PARTS.form.scrollable ?? []), ".preview"]}
    };

    _getHeaderControls() {
      const controls = super._getHeaderControls();
      if (this.itemEffect) return controls;
      return [...controls, {action: "standardEditor", icon: "fa-solid fa-sliders", label: sbsI18n("swade-better-effects.UI.StandardActiveEffecteditor_adb04c27f7"), onClick: () => this.openStandardEditor()}];
    }

    async openStandardEditor() {
      if (await this.save(false)) { await this.close(); this.effect.sheet.render({force: true}); }
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (!this.effect && !this.nativeDefaultsApplied) {
        if (!this.itemEffect) {
          this.draft.name = context.effect.name;
          this.draft.img = context.effect.img;
        }
        this.nativeDefaultsApplied = true;
      }
      this.changeGroups = changeGroups(context);
      const labels = new Map([...context.derivedPresets, ...this.changeGroups.all.flatMap(group => group.options)].map(p => [p.key, p.label]));
      const changeLabel = row => {
        if (labels.has(row.key)) return labels.get(row.key);
        const attribute = row.key.match(/^system\.attributes\.([^.]+)\.(.+)$/);
        const suffixes = {"die.sides": "SWADE.DieSides", "wild-die.sides": "SWADE.WildDieSides", "die.modifier": "SWADE.Modifier"};
        const suffix = key => suffixes[key] ? game.i18n.localize(suffixes[key]) : key;
        if (attribute && context.attributes[attribute[1]]) return `${game.i18n.localize(context.attributes[attribute[1]])} ${suffix(attribute[2])}`;
        const skill = row.key.match(/^@Skill\{(.+)\}\[system\.(.+)\]$/);
        return skill ? `${skill[1]} ${suffix(skill[2])}` : row.label === row.key ? sbsI18n("swade-better-effects.UI.Customchange_c496f73c9a") : row.label;
      };
      const changeTypes = {...context.changeTypes};
      for (const row of this.rows) if (row.type !== "note") changeTypes[row.type] ??= foundry.documents.ActiveEffect.CHANGE_TYPES[row.type]?.label ?? row.type;
      return {...context, effect: {...this.draft, duration: {...this.draft.duration, rounds: this.draft.duration.units === "rounds" ? this.draft.duration.value : null}},
        changes: this.rows.map(row => ({...row, label: changeLabel(row), value: valueText(row.value)})), changeTypes,
        globalModPresets: this.changeGroups.global.map(g => ({key: g.options[0].key, label: g.label})),
        otherPresets: this.changeGroups.other.map(g => ({key: g.options[0].key, label: g.label})),
        collapsibleStates: {...context.collapsibleStates, ...this.presetStates},
        buttons: this.effect ? [{...context.buttons[0], icon: "fa-solid fa-save", label: sbsI18n("swade-better-effects.UI.SaveEffect_f59a37f10c")}]
          : this.itemEffect ? [{...context.buttons[0], label: sbsI18n("swade-better-effects.UI.AddEffect_86e0214437")}] : context.buttons};
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
      const visibility = value("sbe.visibility");
      if (visibility !== undefined) {
        this.draft.showIcon = visibility === "both" ? CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS : CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER;
        this.draft.flags ??= {};
        this.draft.flags["swade-hud"] = {...this.draft.flags["swade-hud"], showInEffectPanels: visibility === "panel"};
      }
      const duration = value("duration.value");
      if (duration !== undefined) this.draft.duration = {...this.draft.duration, value: duration === "" ? null : Number(duration), units: value("duration.units") ?? this.draft.duration.units};
      const expiry = value("duration.expiry");
      if (expiry !== undefined) this.draft.duration.expiry = expiry || null;
      const conditional = this.element.querySelector('[name="system.conditionalEffect"]');
      if (conditional) this.draft.system.conditionalEffect = conditional.checked;
      this.element.querySelectorAll(".sbe-change[data-index]").forEach(row => {
        const draft = this.rows[Number(row.dataset.index)];
        draft.customName = row.querySelector(".sbe-change-name input")?.value ?? draft.customName ?? "";
        const type = row.querySelector("select.type").value;
        draft.conditionsOpen = row.querySelector(".sbe-condition-details")?.open ?? false;
        const rawValue = row.querySelector('[data-field="value"]').value;
        if ([APPLICATION_KEY, RESTRICT_KEY].includes(draft.key)) return;
        if (draft.key === ADD_ITEM_KEY) {
          draft.grant.uuid = rawValue;
          const equip = row.querySelector(".sbe-grant-equip");
          if (!equip.hidden) draft.grant.equipStatus = equip.value === "" ? undefined : Number(equip.value);
          const hand = row.querySelector(".sbe-grant-hand");
          if (!hand.hidden) draft.grant.hand = hand.value;
          return;
        }
        if (type !== draft.type && (type === "note" || draft.type === "note")) {
          draft[draft.type === "note" ? sbsI18n("swade-better-effects.UI.noteText_976c3dbadc") : sbsI18n("swade-better-effects.UI.numericValue_e1a962e212")] = rawValue;
          draft.value = draft[type === "note" ? sbsI18n("swade-better-effects.UI.noteText_976c3dbadc") : sbsI18n("swade-better-effects.UI.numericValue_e1a962e212")] ?? "";
        } else if (rawValue !== valueText(draft.value)) draft.value = draft.value !== null && typeof draft.value === "object" ? JSON.parse(rawValue) : rawValue;
        draft.type = type;
      });
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const basics = this.element.querySelector(".effect-basics");
      basics.classList.toggle("sbe-passive-basics", this.itemEffect);
      basics.querySelector(".sbe-effect-flags")?.remove();
      const group = document.createElement("div"); group.className = "form-group sbe-effect-flags";
      const label = document.createElement("label"); label.textContent = sbsI18n("swade-better-effects.UI.Flags_f38d9950af");
      const fields = document.createElement("span"); fields.className = "form-fields";
      const flagsInput = document.createElement("input"); flagsInput.type = "text"; flagsInput.name = "sbe.effectTags";
      flagsInput.id = `${this.id}-effect-flags`; label.htmlFor = flagsInput.id;
      flagsInput.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Effectflags_828e8dd930")); flagsInput.placeholder = sbsI18n("swade-better-effects.UI.firesilver_8578cc40fc");
      const refreshFlags = () => {
        flagsInput.value = effectiveFlags({...this.draft, documentName: "ActiveEffect"}).join(", ");
        this.displayedFlags = flagsInput.value;
      };
      refreshFlags();
      flagsInput.addEventListener("change", () => { this.capture(); refreshFlags(); });
      basics.querySelector('[name="name"]').addEventListener("input", () => {
        this.capture(); refreshFlags();
        for (const input of this.element.querySelectorAll(".sbe-change-name input")) input.placeholder = this.draft.name;
      });
      fields.append(flagsInput); group.append(label, fields); basics.querySelector(".name").after(group);
      bindFlagSuggestions(flagsInput, catalogFlags, {multiple: true, normalize: normalizeFlag});
      if (this.itemEffect) {
        basics.querySelector(".turns")?.remove();
        basics.querySelector(".behavior")?.remove();
      } else {
        const durationInput = basics.querySelector('[name="duration.rounds"], [name="duration.value"]');
        durationInput.name = "duration.value"; durationInput.value = this.draft.duration.value ?? ""; durationInput.min = "0"; durationInput.step = "1";
        basics.querySelector(".turns label").textContent = sbsI18n("swade-better-effects.UI.Duration_4fc52a3c4c");
        basics.querySelector('[name="duration.units"]')?.remove();
        const units = document.createElement("select"); units.name = "duration.units"; units.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Durationunit_7ba318feac"));
        const durationUnits = {rounds: sbsI18n("swade-better-effects.UI.Rounds_e9af9cdec8"), minutes: sbsI18n("swade-better-effects.UI.Minutes_4f846a84e7"), hours: sbsI18n("swade-better-effects.UI.Hours_21e8492938")};
        const currentUnit = this.draft.duration.units ?? "rounds";
        for (const [unit, text] of Object.entries(durationUnits)) units.append(new Option(text, unit, false, unit === currentUnit));
        durationInput.after(units);
      }
      basics.querySelector(".sbe-lingering-button")?.remove();
      const lingering = document.createElement("button");
      lingering.type = "button";
      lingering.className = "sbe-lingering-button";
      lingering.dataset.action = "lingering";
      const enabled = !!this.draft.flags?.[MODULE_ID]?.lingering?.enabled;
      lingering.textContent = enabled ? sbsI18n("swade-better-effects.UI.Lingering_28e3953ee2") : sbsI18n("swade-better-effects.UI.Lingering_3481546dac");
      basics.append(lingering);
      const presets = this.element.querySelector(".presets");
      if (!presets.querySelector('[data-category="better"]')) {
        const details = document.createElement("details");
        details.dataset.category = "better";
        details.open = this.presetStates.better;
        const heading = document.createElement("summary"); heading.textContent = sbsI18n("swade-better-effects.UI.BetterEffects_1fa2054421");
        const list = document.createElement("ul"); list.className = "unmarked-list other-presets";
        for (const group of this.changeGroups.better) {
          const entry = document.createElement("li");
          const button = document.createElement("button"); button.type = "button";
          button.dataset.action = "addChange"; button.dataset.key = group.options[0].key; button.textContent = group.label;
          entry.append(button); list.append(entry);
        }
        details.append(heading, list); presets.append(details);
      }
      // Native A.E.G.I.S. installs animated click handlers on summary elements.
      // Replace only those summaries, keeping the same details and native markup.
      this.element.querySelectorAll(".presets details").forEach(details => {
        const previous = details.querySelector(":scope > summary");
        previous.replaceWith(previous.cloneNode(true));
        details.addEventListener("toggle", () => { if (!this.changeQuery?.trim()) this.presetStates[details.dataset.category] = details.open; });
      });
      this.element.querySelectorAll('input[type="checkbox"], select[name="duration.expiry"]').forEach((input, index) => {
        input.id = `${this.id}-option-${index}`;
        const label = input.closest(".form-group")?.querySelector("label");
        if (label) label.htmlFor = input.id;
      });
      for (const button of this.element.querySelectorAll('.button-list button:nth-child(3)')) {
        const siblings = [...button.parentElement.querySelectorAll("button")];
        // The same three native component choices move into the preview dropdown.
        if (siblings.length === 3) {
          siblings[0].textContent = game.i18n.localize(button.closest("details").dataset.category === "skill" ? "TYPES.Item.skill" : "SWADE.Attribute");
          siblings.slice(1).forEach(b => b.remove());
        }
      }
      this.mountChangeSearch(presets, context);
      const preview = this.element.querySelector(".preview");
      if (!preview.querySelector(".sbe-preview-header")) {
        const heading = preview.querySelector(":scope > h2");
        const header = document.createElement("div"); header.className = "sbe-preview-header";
        const visibility = document.createElement("select"); visibility.name = "sbe.visibility";
        visibility.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.EffectVisibility"));
        for (const [value, key] of [["hidden", "HideCompletely"], ["panel", "HideOnToken"], ["both", "ShowEverywhere"]]) {
          visibility.add(new Option(sbsI18n(`swade-better-effects.UI.${key}`), value));
        }
        visibility.value = this.draft.showIcon === CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER
          ? (this.draft.flags?.["swade-hud"]?.showInEffectPanels === true ? "panel" : "hidden") : "both";
        heading.before(header); header.append(heading, visibility);
      }
      preview.querySelectorAll(".changes-list > li[data-index]").forEach(row => {
        if (row.classList.contains("sbe-change")) return;
        const draft = this.rows[Number(row.dataset.index)];
        row.classList.add("sbe-change");
        const nameField = document.createElement("div"); nameField.className = "sbe-change-name";
        const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.value = draft.customName ?? "";
        nameInput.placeholder = this.draft.name;
        nameInput.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.CustomBehaviourName"));
        nameField.append(nameInput); row.append(nameField);
        row.querySelector("select.type").dataset.field = "type";
        const value = row.querySelector("input.value");
        value.dataset.field = "value";
        value.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Changevalue_c34cd224d9"));
        const defense = Object.hasOwn(DEFENSES, draft.key) ? DEFENSES[draft.key] : null;
        if (defense || [ADD_ITEM_KEY, APPLICATION_KEY, RESTRICT_KEY].includes(draft.key)) {
          const type = row.querySelector("select.type");
          type.replaceChildren(new Option(defense ? {add: "+ Damage", subtract: "− Damage", override: sbsI18n("swade-better-effects.UI.Nodamage_061999eff3")}[defense.type] : sbsI18n("swade-better-effects.UI.Grant_78b7d0379d"), defense?.type ?? "add"));
          type.hidden = true;
          row.classList.add("sbe-special-change");
          if (draft.key === ADD_ITEM_KEY) this.mountItemReference(value, draft.grant);
          else if (draft.key === RESTRICT_KEY) {
            value.type = "hidden"; value.classList.remove("value");
            const edit = document.createElement("button"); edit.type = "button"; edit.className = "value";
            edit.dataset.action = "editRestriction";
            edit.textContent = [...(draft.value?.traits ?? []), ...(draft.value?.rollFlags ?? [])].join(", ") || sbsI18n("swade-better-effects.UI.Restrict");
            value.after(edit);
          }
          else if (draft.key === APPLICATION_KEY) {
            value.type = "hidden";
            value.classList.remove("value");
            const edit = document.createElement("button");
            edit.type = "button"; edit.className = "value"; edit.dataset.action = "editApplication";
            const {behaviour, condition} = draft.value ?? {};
            edit.textContent = behaviour && condition
              ? `${APPLICATION_BEHAVIOURS[behaviour]} · ${APPLICATION_CONDITIONS[condition]}` : sbsI18n("swade-better-effects.UI.ConfigureApplication_37ccdd4e95");
            value.after(edit);
          }
          else if (defense.selector === "immunity") value.type = "hidden";
          else {
            value.type = "number"; value.min = "0"; value.step = "any"; value.placeholder = sbsI18n("swade-better-effects.UI.Damage_0c874f581a");
            value.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.amount_fefff9d082", {p0: (defense.label)}));
          }
        }
        if (noteSelectorForKey(draft.key)) {
          const type = row.querySelector("select.type");
          type.append(new Option(sbsI18n("swade-better-effects.UI.Note_d8da2c49df"), sbsI18n("swade-better-effects.UI.note_edb4656242"))); type.value = draft.type;
        }
        if (draft.type === "note") {
          row.classList.add("sbe-note-change");
          value.type = "hidden"; value.classList.remove("value");
          const edit = document.createElement("button"); edit.type = "button"; edit.className = "value sbe-edit-note";
          edit.dataset.action = "editNote"; edit.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Editnote_299e604ccf")); edit.title = sbsI18n("swade-better-effects.UI.Editformattednote_5a5ef87a74");
          edit.innerHTML = `<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>`;
          value.after(edit);
          const preview = document.createElement("div"); preview.className = "sbe-note-preview";
          preview.innerHTML = cleanRollNote(draft.value);
          if (!preview.textContent.trim() && !preview.querySelector("img")) preview.textContent = sbsI18n("swade-better-effects.UI.Clickthepentowritea_1d54227dfb");
          row.append(preview);
        }
        if ([MODIFY_FLAG_KEY, SUPPRESS_KEY].includes(draft.key)) {
          row.classList.add("sbe-flag-change");
          const type = row.querySelector("select.type");
          const suppress = draft.key === SUPPRESS_KEY;
          type.replaceChildren(...(suppress ? [new Option(sbsI18n("swade-better-effects.UI.Suppress_60b199879b"), "add")]
            : [new Option(sbsI18n("swade-better-effects.UI.Add_9fd728c66c"), "add"), new Option(sbsI18n("swade-better-effects.UI.Suppress_60b199879b"), "subtract")]));
          if (suppress) { draft.type = "add"; type.hidden = true; row.classList.add("sbe-special-change"); }
          type.value = draft.type;
          value.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Flagnames_47e5a289dc"));
          value.placeholder = sbsI18n("swade-better-effects.UI.poisoncursed_62ec9482fc");
          bindFlagSuggestions(value, catalogFlags, {multiple: true, normalize: suppress ? normalizePattern : normalizeFlag});
          value.addEventListener("change", () => { draft.value = (suppress ? suppressionFlags : normalizeFlags)(value.value).join(", "); value.value = draft.value; });
        }
        const group = this.changeGroups.all.find(group => group.options.some(p => p.key === draft.key));
        let choices = group?.options;
        const component = draft.key.match(/^(system\.attributes\.[^.]+\.|@Skill\{.+\}\[system\.)(.+?)(\]?)$/);
        const attributeNote = draft.type === "note" && draft.key.startsWith("system.attributes.");
        if (component && ["die.sides", "wild-die.sides", "die.modifier"].includes(component[2])) choices = [
          ["die.sides", sbsI18n("swade-better-effects.UI.DieSides_dc543aea55")], ["wild-die.sides", sbsI18n("swade-better-effects.UI.WildDieSides_5b2918a71d")], ["die.modifier", sbsI18n("swade-better-effects.UI.Modifier_42e37604b6")]
        ].map(([key, label]) => ({key: `${component[1]}${key}${component[3]}`, label}));
        if (choices?.length > 1) {
          const label = row.querySelector(".label");
          label.replaceChildren();
          if (group?.id === "targeting" || component) {
            const title = document.createElement("small");
            const attribute = draft.key.match(/^system\.attributes\.([^.]+)\./)?.[1];
            title.textContent = group?.id === "targeting" ? sbsI18n("swade-better-effects.UI.Modifytargetingroll_b0d6bac9c2")
              : attribute ? game.i18n.localize(context.attributes[attribute]) : draft.key.match(/^@Skill\{(.+)\}/)?.[1];
            label.append(title);
          }
          const select = document.createElement("select"); select.className = "sbe-change-selector"; select.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Change_c0bf75bd78"));
          for (const option of choices) { const entry = new Option(option.label, option.key); entry.selected = option.key === draft.key; select.append(entry); }
          select.addEventListener("change", event => { event.stopPropagation(); this.capture(); draft.key = select.value; draft.label = select.selectedOptions[0].textContent; });
          label.append(select);
        }
        if (attributeNote) {
          row.classList.add("sbe-attribute-note");
          row.querySelector(".label").hidden = true;
          const attribute = draft.key.match(/^system\.attributes\.([^.]+)\./)?.[1];
          const name = game.i18n.localize(context.attributes[attribute]);
          row.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.note_0672f2ac14", {p0: (name)}));
          const scope = document.createElement("strong"); scope.className = "sbe-note-scope"; scope.textContent = name;
          row.querySelector(".sbe-note-preview").prepend(scope);
        }
        const trash = row.querySelector('[data-action="deleteChange"]');
        const link = document.createElement("a"); link.className = "delete-change sbe-trash"; link.dataset.action = "deleteChange"; link.role = "button"; link.tabIndex = 0;
        link.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Removechange_7b24391bda")); link.title = sbsI18n("swade-better-effects.UI.Removechange_7b24391bda"); link.innerHTML = `<i class="fa-solid fa-trash" aria-hidden="true"></i>`;
        link.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); link.click(); } });
        trash.replaceWith(link);
        if (draft.key === MODIFY_FLAG_KEY) {
          const generate = document.createElement("a"); generate.className = "sbe-generate-flag"; generate.dataset.action = "generateFlag"; generate.role = "button"; generate.tabIndex = 0;
          generate.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Generateflagfromname_9802db77c4")); generate.title = sbsI18n("swade-better-effects.UI.Generateflagfromname_9802db77c4");
          generate.innerHTML = `<i class="fa-solid fa-asterisk" aria-hidden="true"></i>`;
          generate.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); generate.click(); } });
          link.before(generate);
          return;
        }
        if ([ADD_ITEM_KEY, APPLICATION_KEY, SUPPRESS_KEY].includes(draft.key)) return;
        const details = document.createElement("details"); details.className = "sbe-condition-details"; details.open = draft.conditionsOpen ?? false;
        const summary = document.createElement("summary"); summary.textContent = sbsI18n("swade-better-effects.UI.Conditions_97d4be8960");
        const container = document.createElement("div"); container.className = "sbe-condition";
        details.append(summary, container); row.append(details);
        mountPredicate(container, draft.predicate);
      });
      preview.classList.toggle("sbe-attribute-notes-only", !!this.rows.length && this.rows.every(row => row.type === "note" && row.key.startsWith("system.attributes.")));
    }

    mountChangeSearch(presets, context) {
      presets.querySelector(".sbe-change-search")?.remove();
      presets.querySelector(".sbe-no-presets")?.remove();
      const search = document.createElement("input");
      search.type = "search";
      search.className = "sbe-change-search";
      search.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Searchchanges_ebf4fa1920"));
      search.placeholder = sbsI18n("swade-better-effects.UI.Searchchanges_7d9342f5a8");
      search.value = this.changeQuery ?? "";
      const empty = document.createElement("p");
      empty.className = "sbe-no-presets";
      empty.textContent = sbsI18n("swade-better-effects.UI.Nomatchingchanges_63ad50fc4b");
      presets.prepend(search);
      presets.append(empty);
      const categories = [...presets.querySelectorAll("details[data-category]")];
      const filter = () => {
        this.changeQuery = search.value;
        const terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        let found = false;
        for (const category of categories) {
          const heading = category.querySelector("summary").textContent;
          let visible = false;
          for (const button of category.querySelectorAll('[data-action="addChange"]')) {
            const group = this.changeGroups.all.find(group => group.options[0].key === button.dataset.key);
            const extras = category.dataset.category === "attribute"
              ? [...Object.values(context.attributes).map(key => game.i18n.localize(key)), sbsI18n("swade-better-effects.UI.diesideswilddiemodifier_26529253c5")]
              : category.dataset.category === "skill" ? [sbsI18n("swade-better-effects.UI.diesideswilddiemodifier_26529253c5")] : [];
            const value = [heading, button.textContent, button.dataset.key, ...(group?.options.map(option => option.label) ?? []), ...extras]
              .join(" ").toLocaleLowerCase();
            const matches = terms.every(term => value.includes(term));
            (button.closest("li") ?? button).hidden = !matches;
            visible ||= matches;
          }
          category.hidden = !visible;
          category.open = terms.length ? visible : !!this.presetStates[category.dataset.category];
          found ||= visible;
        }
        empty.hidden = found;
      };
      search.addEventListener("input", filter);
      search.addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
      filter();
    }

    mountItemReference(input, grant) {
      input.classList.remove("value");
      input.value = grant.uuid;
      input.placeholder = sbsI18n("swade-better-effects.UI.Dropanitemorenterits_80b256e823");
      input.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.ItemUUID_d815eb6f91"));
      const field = document.createElement("div"); field.className = "sbe-item-reference";
      const link = document.createElement("a"); link.role = "button"; link.tabIndex = 0; link.hidden = true;
      const equip = document.createElement("select"); equip.className = "sbe-grant-equip"; equip.hidden = true;
      const hand = document.createElement("select"); hand.className = "sbe-grant-hand"; hand.hidden = true;
      hand.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Equiphand_380d20ed48"));
      hand.replaceChildren(...[["default", sbsI18n("swade-better-effects.UI.Default_21b111cbfe")], ["any", sbsI18n("swade-better-effects.UI.Anyhand_71aae00ae9")], ["main", sbsI18n("swade-better-effects.UI.Mainhand_bd73f463f8")], ["off", sbsI18n("swade-better-effects.UI.Offhand_5d154d9c57")]]
        .map(([value, label]) => new Option(label, value)));
      hand.value = grant.hand ?? (grant.equipStatus === 2 ? "off" : grant.equipStatus === 4 ? "main" : "default");
      equip.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Equipmentstatewhenadded_b20ef0014d"));
      input.replaceWith(field);
      field.append(input, link, equip, hand);
      const refreshHand = () => { hand.hidden = equip.hidden || Number(equip.value) < 2 || equip.value === ""; };
      equip.addEventListener("change", refreshHand);
      const refresh = async () => {
        const uuid = input.value.trim();
        const item = uuid ? await resolveGrantItem(uuid) : null;
        if (!field.isConnected || uuid !== input.value.trim()) return;
        link.hidden = !item;
        input.hidden = !!item;
        const states = grantEquipOptions(item);
        equip.hidden = !states.length;
        equip.replaceChildren(new Option(sbsI18n("swade-better-effects.UI.Defaultequipmentstate_bf1a3a57f8"), ""), ...states.map(([state, label]) =>
          new Option(game.i18n.localize(`SWADE.ItemEquipStatus.${label}`), String(state))));
        const state = [2, 4, 5].includes(grant.equipStatus) ? 3 : grant.equipStatus;
        equip.value = states.some(([value]) => value === state) ? String(state) : "";
        refreshHand();
        if (!item) return;
        const icon = document.createElement("img"); icon.src = item.img; icon.alt = "";
        link.replaceChildren(icon, document.createTextNode(item.name));
        link.onclick = event => { event.preventDefault(); item.sheet?.render({force: true}); };
      };
      link.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); link.click(); }
      });
      input.addEventListener("change", refresh);
      field.addEventListener("dragover", event => event.preventDefault());
      field.addEventListener("drop", async event => {
        event.preventDefault(); event.stopPropagation();
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const item = data?.type === "Item" ? await resolveGrantItem(data.uuid) : null;
        if (!item) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Dropanaccessibleitemfromthe_0c06a77d21"));
        input.value = item.uuid;
        this.capture();
        await refresh();
      });
      void refresh();
    }

    configureApplication(data) {
      const actor = this.document.documentName === "Actor" ? this.document : this.document.actor;
      return configureApplication(data, actor);
    }

    async addPreset(target) {
      this.capture();
      const details = target.closest("details"); const category = details?.dataset.category;
      const selected = details?.querySelector(".target")?.value;
      let key = target.dataset.key;
      let label = target.textContent.trim();
      if (category === "skill") {
        if (!selected?.trim()) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Enteraskillnamefirst_4bc3eadc68"));
        key = `@Skill{${selected.trim()}}[system.${key}]`; label = `${selected} ${label}`;
      } else if (category === "attribute") { key = `system.attributes.${selected}.${key}`; label = `${selected} ${label}`; }
      const defense = Object.hasOwn(DEFENSES, key) ? DEFENSES[key] : null;
      const value = key === RESTRICT_KEY ? await configureRestriction() : key === APPLICATION_KEY ? await this.configureApplication() : defense?.selector === "immunity" ? "0" : "";
      if (value == null) return;
      this.rows.push({key, label, type: defense?.type ?? "add", value, phase: "initial", priority: null,
        predicate: emptyPredicate(), ...(key === ADD_ITEM_KEY ? {grant: {uuid: ""}} : {})});
      this.render();
    }

    async editNote(index) {
      this.capture(); const row = this.rows[index];
      if (row?.type !== "note") return;
      const content = document.createElement("div");
      const editor = foundry.applications.elements.HTMLProseMirrorElement.create({name: sbsI18n("swade-better-effects.UI.note_edb4656242"), value: cleanRollNote(row.value),
        height: 260, documentUUID: this.document.uuid});
      content.append(editor);
      const value = await foundry.applications.api.DialogV2.prompt({window: {title: sbsI18n("swade-better-effects.UI.Editrollnote_6a8a89e3ad"), icon: "fa-solid fa-note-sticky"},
        classes: ["sbe-app", "sbe-note-editor"], position: {width: 560}, modal: true, content, rejectClose: false,
        ok: {label: sbsI18n("swade-better-effects.UI.Savenote_6501e1ced8"), callback: (_event, _button, dialog) => dialog.element.querySelector("prose-mirror").value}});
      if (value === null) return;
      row.value = cleanRollNote(value); this.render();
    }

    async save(close = true) {
      if (!this.document.isOwner || (this.effect && !this.effect.isOwner)) return false;
      this.capture();
      if (!this.draft.name.trim()) throw new Error(sbsI18n("swade-better-effects.UI.Enteraneffectname_646ca3ebc5"));
      if (this.draft.duration.value !== null && (!Number.isInteger(this.draft.duration.value) || this.draft.duration.value < 0)) throw new Error(sbsI18n("swade-better-effects.UI.Durationmustbeanonnegative_bb5bacdedc"));
      for (const row of this.rows) {
        if (!row.key?.trim()) throw new Error(sbsI18n("swade-better-effects.UI.Eachchangeneedsadatapath_859a59eb4c"));
        if (row.key === RESTRICT_KEY) {
          row.value = validateRestriction(row.value); row.type = "add";
          if (!validatePredicate(row.predicate)) throw new Error(sbsI18n("swade-better-effects.UI.Completeeveryconditionchooseaflag_fe613f0ed1"));
          continue;
        }
        if (row.key === SUPPRESS_KEY) {
          row.value = suppressionFlags(row.value).join(", ");
          if (!row.value) throw new Error(sbsI18n("swade-better-effects.UI.EnterFlagsToSuppress"));
          row.type = "add"; row.predicate = emptyPredicate();
          continue;
        }
        if (row.key === APPLICATION_KEY) {
          await validateApplication(row.value);
          row.type = "add"; row.predicate = emptyPredicate();
          continue;
        }
        if (row.key === ADD_ITEM_KEY) {
          const {uuid, equipStatus, hand} = row.grant;
          const item = await resolveGrantItem(uuid);
          if (!item) throw new Error(sbsI18n("swade-better-effects.UI.EnteravalidItemUUIDor_bbe58375c2"));
          if (item.uuid === this.document.uuid) throw new Error(sbsI18n("swade-better-effects.UI.Anitemcannotgrantitself_b77cf3da54"));
          row.value = grantEquipOptions(item).some(([state]) => state === equipStatus)
            ? {uuid: item.uuid, equipStatus, hand: hand ?? "default"} : item.uuid;
          row.type = "add"; row.predicate = emptyPredicate();
        }
        if (row.key === MODIFY_FLAG_KEY) {
          row.value = normalizeFlags(row.value).join(", ");
          if (!row.value || !["add", "subtract"].includes(row.type)) throw new Error(sbsI18n("swade-better-effects.UI.ChooseAddorSuppressandenter_6cb95a1be9"));
          row.predicate = emptyPredicate();
        }
        if (!validatePredicate(row.predicate)) throw new Error(sbsI18n("swade-better-effects.UI.Completeeveryconditionchooseaflag_fe613f0ed1"));
        if (Object.hasOwn(DEFENSES, row.key)) {
          const defense = DEFENSES[row.key];
          if (defense.selector === "immunity") row.value = "0";
          else if (!String(row.value ?? "").trim() || !Number.isFinite(Number(row.value)) || Number(row.value) < 0) {
            throw new Error(sbsI18n("swade-better-effects.UI.Enteranonnegativedamageamount_b28a88033b", {p0: (defense.label)}));
          }
          row.type = defense.type;
          continue;
        }
        if (row.type === "note") {
          if (!noteSelectorForKey(row.key)) throw new Error(sbsI18n("swade-better-effects.UI.Choosearollchangeforthis_4b3995fb5f"));
          row.value = cleanRollNote(row.value);
          if (!row.value.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(row.value)) throw new Error(sbsI18n("swade-better-effects.UI.Entersometextforeachnote_46919b7b5e"));
          continue;
        }
        if (hasCondition(row.predicate) || row.key.startsWith("sbe.targetRoll.") || row.key.startsWith("sbe.powerRoll.") || row.key === MAP_KEY) {
          const selector = selectorForKey(row.key);
          if ((!selector && !isOwnerCondition(row, row.predicate)) || !Object.hasOwn(OPERATIONS, row.type)) throw new Error(sbsI18n("swade-better-effects.UI.Thischangedoesnotsupportautomatic_0688742af8"));
          if (!Number.isFinite(Number(row.value))) {
            if (selector !== "outgoing-damage") throw new Error(sbsI18n("swade-better-effects.UI.Enterafinitenumberforthis_b13d8a35a2"));
            if (!isDamageFormula(row.value)) throw new Error(sbsI18n("swade-better-effects.UI.EnteravalidDamageformulasuch_72edc37ff6"));
          }
        }
      }
      const changes = this.rows.map(({label, customName, predicate, conditionsOpen, numericValue, noteText, grant, ...change}) => ({...change,
        ...(change.type === "note" ? {key: noteChangeKey(change.key), type: "add"} : {}),
        phase: change.phase ?? "initial", priority: change.priority ?? null}));
      const conditions = changes.map((change, index) => ({signature: changeSignature(change), predicate: this.rows[index].predicate,
        ...(this.rows[index].customName?.trim() ? {customName: this.rows[index].customName.trim()} : {})}));
      const flags = {...this.draft.flags, [MODULE_ID]: {...this.draft.flags?.[MODULE_ID], nameFlag: normalizeFlag(this.draft.name), conditions}};
      if (this.itemEffect) flags[MODULE_ID].itemEffect = true;
      const data = {name: this.draft.name, img: this.draft.img, showIcon: this.draft.showIcon ?? CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS, duration: this.draft.duration, system: {...this.draft.system, changes}, flags,
        ...(this.itemEffect ? {transfer: true} : {})};
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

export function openAegis(document, effect, {itemEffect = false} = {}) {
  if (!document?.isOwner || effect && !effect.isOwner) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Youneedownershiptoeditthis_3af4f5bc37"));
  const key = effect?.uuid ?? document.uuid;
  const existing = openEditors.get(key);
  if (existing) { existing.render({force: true}); existing.bringToFront(); return existing; }
  const app = new Wizard({document, effect, itemEffect}); openEditors.set(key, app); app.render({force: true}); return app;
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
  if (isItemEffect(effect) && effect.isOwner) return openAegis(effect.parent, effect);
  if (!effect?.isOwner) return effect?.sheet.render({force: true});
  return foundry.applications.api.DialogV2.wait({classes: ["sbe-app"], window: {title: sbsI18n("swade-better-effects.UI.EditEffect_e6ea2d28d0", {p0: (effect.name)}), icon: "fa-solid fa-person-rays"}, buttons: [
    {action: "aegis", label: sbsI18n("swade-better-effects.UI.Effectbuilder_037027195e"), icon: "fa-solid fa-shield-quartered", callback: () => openAegis(effect.parent, effect)},
    {action: "standard", label: sbsI18n("swade-better-effects.UI.Manualedit_022b95e70d"), icon: "fa-solid fa-sliders", callback: () => effect.sheet.render({force: true})}
  ], rejectClose: false});
}

export function initialTemplateEffect(item, img = item.img) {
  return {name: item.name, img, type: "base", transfer: false, system: {changes: []},
    flags: {[MODULE_ID]: {nameFlag: normalizeFlag(item.name)}}};
}

export class EffectItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.DocumentSheetV2) {
  static DEFAULT_OPTIONS = {classes: ["sbe-app", "sbe-effect-chooser"], position: {width: 560}, window: {icon: "fa-solid fa-person-rays", resizable: true},
    actions: {
      aegis: async function () { await this.editEffect("aegis"); },
      standard: async function () { await this.editEffect("standard"); }
    }};
  static PARTS = {form: {template: `${TEMPLATE}/effect-item.hbs`}};
  async _prepareContext(options) {
    const effects = this.document.effects.contents;
    const descriptions = await Promise.all(effects.map(async effect => ({
      id: effect.id,
      name: effect.name,
      uuid: effect.uuid,
      value: effect.description,
      html: await foundry.applications.ux.TextEditor.implementation.enrichHTML(effect.description ?? "", {
        relativeTo: effect, secrets: effect.isOwner
      }),
      editable: this.isEditable && effect.isOwner
    })));
    return {...await super._prepareContext(options), item: this.document, editable: this.isEditable,
      descriptions, multiple: effects.length > 1};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const editor of this.element.querySelectorAll("prose-mirror[data-effect-id]")) {
      editor.addEventListener("change", async () => {
        const effect = this.document.effects.get(editor.dataset.effectId);
        if (!this.isEditable || !effect?.isOwner || editor.value === effect.description) return;
        try {
          await effect.update({description: editor.value});
          if (this.rendered) await this.render();
        } catch (error) {
          ui.notifications.error(error.message, {console: true});
        }
      });
    }
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
      select.name = sbsI18n("swade-better-effects.UI.effectId_fcb3f7588f");
      select.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Effect_2252d5cf93"));
      for (const entry of effects) select.append(new Option(entry.name, entry.id));
      const id = await foundry.applications.api.DialogV2.prompt({classes: ["sbe-app"], window: {title: this.document.name}, content: select.outerHTML,
        ok: {label: editor === "aegis" ? sbsI18n("swade-better-effects.UI.Effectbuilder_037027195e") : sbsI18n("swade-better-effects.UI.Manualedit_022b95e70d"),
          callback: (_event, button) => button.form.elements.effectId.value}, rejectClose: false});
      if (!id) return;
      effect = this.document.effects.get(id);
    }
    if (editor === "aegis") return openAegis(this.document, effect);
    if (effect && effects.length === 1 && effect.isOwner && effect.name !== this.document.name) {
      await effect.update({name: this.document.name});
    }
    return effect?.sheet.render({force: true});
  }
  async render(options, ...args) {
    const creating = (typeof options === "object" ? options : args[0])?.renderContext === "createItem";
    if (this.isEditable && !this.document.effects.size) {
      // Repair templates made before Create Item initialized the embedded effect.
      this.initializing ??= this.document.createEmbeddedDocuments("ActiveEffect", [initialTemplateEffect(this.document)])
        .finally(() => { this.initializing = null; });
      await this.initializing;
    }
    const [effect] = this.document.effects.contents;
    if (creating && this.isEditable && this.document.effects.size === 1 && !effect.system.changes.length) {
      return openAegis(this.document, effect);
    }
    return super.render(options, ...args);
  }
}

export function injectEditorButtons(app, html) {
  const doc = app.document;
  if (!doc) return;
  if (["Actor", "Item"].includes(doc.documentName)) {
    if (doc.documentName === "Item" && doc.type !== EFFECT_TYPE) {
      // Skills use an untabbed template in SWADE. Give them the same controls
      // by rendering the native item Effects partial in their content column.
      if (doc.type === "skill" && !html.classList.contains("sbs-skill-draft") && !html.querySelector('section[data-tab="effects"]')) {
        const sheetContent = html.querySelector(".main-grid > .sheet-content");
        if (sheetContent) {
          const details = document.createElement("details"); details.className = "sbe-skill-effects";
          const summary = document.createElement("summary"); summary.textContent = game.i18n.localize("SWADE.Effects");
          details.append(summary); sheetContent.append(details);
          void foundry.applications.handlebars.renderTemplate("systems/swade/templates/item/partials/tabs/effects.hbs", {
            item: doc, tabs: {effects: {id: "effects", group: "main", tabCssClass: "effects"}}, collapsibleStates: app.collapsibleStates
          }).then(markup => {
            if (!details.isConnected) return;
            details.insertAdjacentHTML("beforeend", markup);
            injectEditorButtons(app, html);
          }).catch(error => console.error(`${MODULE_ID} | Skill effects`, error));
        }
      }
      for (const button of html.querySelectorAll('[data-tab="effects"] button.add-effect')) {
        if (!doc.isOwner || !app.isEditable) continue;
        button.type = "button";
        button.replaceChildren(Object.assign(document.createElement("i"), {className: "fa-solid fa-plus"}), sbsI18n("swade-better-effects.UI.AddEffect_86e0214437"));
      }
    }
    if (doc.documentName === "Actor") {
      for (const row of html.querySelectorAll("[data-effect-id][data-parent-id]")) {
        if (isItemEffect(doc.items.get(row.dataset.parentId)?.effects.get(row.dataset.effectId))) row.remove();
      }
    }
    if (html.dataset.sbeEffectEditor) return;
    html.dataset.sbeEffectEditor = "true";
    html.addEventListener("click", event => {
      if (doc.documentName === "Item" && doc.type !== EFFECT_TYPE && doc.isOwner && app.isEditable &&
        event.target.closest('[data-tab="effects"] button.add-effect')) {
        event.preventDefault(); event.stopImmediatePropagation();
        openAegis(doc, undefined, {itemEffect: true});
        return;
      }
      const button = event.target.closest('[data-action="openEffect"], [data-action="editEffect"], .effect-edit');
      const row = button?.closest("[data-effect-uuid], [data-effect-id]");
      if (!row) return;
      const {effectUuid, effectId, parentId} = row.dataset;
      // The actor's Effects tab also lists effects owned by its embedded items.
      const parent = parentId && parentId !== doc.id ? doc.items?.get(parentId) : doc;
      const effect = parent?.effects.get(effectId) ?? (effectUuid ? foundry.utils.fromUuid(effectUuid) : undefined);
      if (!effect) return;
      event.preventDefault(); event.stopImmediatePropagation();
      Promise.resolve(effect).then(chooseEditor).catch(error => ui.notifications.error(error.message));
    }, {capture: true});
  } else if (doc.documentName === "ActiveEffect" && doc.isOwner && !html.querySelector(".sbe-open-aegis")) {
    const button = document.createElement("button"); button.type = "button"; button.className = "sbe-open-aegis"; button.textContent = sbsI18n("swade-better-effects.UI.EditinAEGI_65593bafb0");
    button.addEventListener("click", async event => {
      event.stopPropagation();
      // The standard sheet retains ownership of its fields until it has submitted them.
      await app.submit(); await app.close(); openAegis(doc.parent, doc);
    });
    (html.querySelector(".window-content") ?? html).prepend(button);
    const conditions = doc.getFlag(MODULE_ID, "conditions") ?? [];
    if (conditions.some(c => hasCondition(c?.predicate))) {
      const hint = document.createElement("p"); hint.className = "hint sbe-rule-warning";
      hint.textContent = sbsI18n("swade-better-effects.UI.ThiseffecthasautomaticconditionsUse_6f1e196bd1");
      button.after(hint);
    }
  }
}
