import {EFFECT_TYPE, ICON, MODULE_ID, TEMPLATE} from "./constants.mjs";
import {normalizeFlag, normalizeFlags, testPredicate, resolveDamage, resolveTrait} from "./rules.mjs";
import {DocumentFlagsEditor, FlagLibrary, documentFlags, injectFlagField, registerFlagHooks} from "./flags.mjs";
import {EffectItemSheet, editEffectSource, initialTemplateEffect, initializeWizard, injectEditorButtons, openAegis} from "./editors.mjs";
import {applyEffectTemplate, applyToSelected, collectRules, installConditionGate, installSheetDrops, registerCanvasDrops, wrapMethod} from "./effects.mjs";
import {makeContext, messageContext, registerRollHooks, tagRoll, traitAdjustment} from "./roll-context.mjs";
import {initializeTargetedDamage, openDamageRequest, prepareDamage, renderDamageMessage, resolveMessageDamage} from "./damage.mjs";
import {initializeSwadeTools} from "./swade-tools.mjs";
import {installMapDialog} from "./map.mjs";
import {installEffectSuppression} from "./suppression.mjs";
import {installOpposedRolls, openOpposedRoll} from "./opposed.mjs";
import {buildRollRequest, configureRollRequest, generateRollRequest, installRollRequests, openRollRequest, renderRollRequest, rollRequestedTrait} from "./requests.mjs";
import {migrateRollRequestLibrary, openRollRequestLibrary} from "./request-library.mjs";
import {powerRollModifier, setPowerPreparation} from "./power-rolls.mjs";
import {effectCatalog, pickEffect, registerEffectPicker} from "./effect-picker.mjs";
import {installInitiativeChat} from "./initiative-chat.mjs";
import {registerItemGrants} from "./item-effects.mjs";
import {registerImmunityNotices} from "./immunity-notices.mjs";
import {registerLingeringEffects} from "./lingering.mjs";

class EffectTemplateData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return {description: new foundry.data.fields.HTMLField()}; }
}

Hooks.once("init", () => {
  CONFIG.Item.dataModels[EFFECT_TYPE] = EffectTemplateData;
  CONFIG.Item.typeLabels[EFFECT_TYPE] = "TYPES.Item.swade-better-effects.effect";
  CONFIG.Item.typeIcons ??= {}; CONFIG.Item.typeIcons[EFFECT_TYPE] = "fa-solid fa-person-rays";
  foundry.applications.apps.DocumentSheetConfig.registerSheet(CONFIG.Item.documentClass, MODULE_ID, EffectItemSheet,
    {types: [EFFECT_TYPE], makeDefault: true, label: "Better Effects"});
  // Some item sheet modules register a default for every item type, including
  // Effect templates. These templates use their own sheet and data model.
  wrapMethod(CONFIG.Item.documentClass.prototype, "_getSheetClass", function (original, ...args) {
    return this.type === EFFECT_TYPE ? EffectItemSheet : original(...args);
  });
  game.settings.register(MODULE_ID, "flagLibrary", {scope: "world", config: false, type: Array, default: []});
  registerEffectPicker();
  game.settings.registerMenu(MODULE_ID, "flags", {name: "Flag library", label: "Manage effect flags", hint: "Create and manage the shared flags used by effects, actors, items, and damage rolls.",
    icon: "fa-solid fa-tags", type: FlagLibrary, restricted: true});
  CONFIG.queries[`${MODULE_ID}.resolveDamage`] = openDamageRequest;
  registerFlagHooks(); registerRollHooks();
  registerItemGrants();
  registerImmunityNotices();
  installConditionGate();
  installEffectSuppression();
  installRollRequests();
  registerLingeringEffects();
  Hooks.on("preCreateItem", item => {
    if (item.type !== EFFECT_TYPE) return;
    const img = item.img === CONFIG.Item.documentClass.DEFAULT_ICON ? ICON : item.img;
    if (item.effects.size) {
      if (img !== item.img) item.updateSource({img});
      return;
    }
    const effect = initialTemplateEffect(item, img);
    item.updateSource({img, effects: [{_id: foundry.utils.randomID(), ...effect}]});
  });
});

Hooks.once("setup", async () => {
  const NativeWizard = game.swade.apps.ActiveEffectWizard;
  initializeWizard(); installSheetDrops(); registerCanvasDrops(); installMapDialog(); installOpposedRolls();
  installInitiativeChat();
  Hooks.on("renderActiveEffectWizard", app => {
    if (app.constructor === NativeWizard && app.document?.isOwner) { app.close(); openAegis(app.document); }
  });
  game.modules.get(MODULE_ID).api = Object.freeze({normalizeFlag, normalizeFlags, testPredicate, resolveDamage, collectRules, prepareDamage,
    openAegis, editEffectSource, applyEffectTemplate, applyToSelected, resolveMessageDamage, tagRoll, getFlags: documentFlags, getRollContext: messageContext, resolveTrait, traitAdjustment,
    openFlagLibrary: () => new FlagLibrary().render({force: true}), openOpposedRoll, openRollRequest, openRollRequestLibrary, rollRequestedTrait,
    buildRollRequest, configureRollRequest, generateRollRequest, makeRollContext: makeContext, powerRollModifier, setPowerPreparation, effectCatalog, pickEffect});
  await foundry.applications.handlebars.loadTemplates([`${TEMPLATE}/damage-summary.hbs`]);
});

Hooks.once("ready", () => Promise.all([initializeTargetedDamage(), initializeSwadeTools()]));
Hooks.once("ready", () => { if (game.user.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id)) migrateRollRequestLibrary().catch(error => ui.notifications.error(error.message, {console: true})); });
Hooks.on("renderApplicationV2", (app, html) => { injectFlagField(app, html); injectEditorButtons(app, html); });
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  if (app.document && ["Actor", "Item", "Token", "ActiveEffect", "Scene", "JournalEntry"].includes(app.document.documentName) && app.document.isOwner) {
    controls.push({action: "sbeFlags", icon: "fa-solid fa-tags", label: "Flags", onClick: () => new DocumentFlagsEditor(app.document).render({force: true})});
  }
});
Hooks.on("renderChatMessageHTML", renderDamageMessage);
Hooks.on("renderChatMessageHTML", renderRollRequest);
Hooks.on("targetToken", user => {
  if (user !== game.user) return;
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof game.swade.RollDialog && app.isDamageRoll) void app.render();
  }
});
