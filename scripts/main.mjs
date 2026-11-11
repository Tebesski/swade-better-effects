import {EFFECT_TYPE, ICON, MODULE_ID, TEMPLATE} from "./constants.mjs";
import {normalizeFlag, normalizeFlags, testPredicate, resolveDamage, resolveTrait} from "./rules.mjs";
import {DocumentFlagsEditor, FlagLibrary, documentFlags, injectFlagField, registerFlagHooks} from "./flags.mjs";
import {EffectItemSheet, editEffectSource, initializeWizard, injectEditorButtons, openAegis} from "./editors.mjs";
import {applyEffectTemplate, applyToSelected, collectRules, installConditionGate, installSheetDrops, registerCanvasDrops} from "./effects.mjs";
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

class EffectTemplateData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return {description: new foundry.data.fields.HTMLField()}; }
}

Hooks.once("init", () => {
  CONFIG.Item.dataModels[EFFECT_TYPE] = EffectTemplateData;
  CONFIG.Item.typeLabels[EFFECT_TYPE] = "TYPES.Item.swade-better-effects.effect";
  CONFIG.Item.typeIcons ??= {}; CONFIG.Item.typeIcons[EFFECT_TYPE] = "fa-solid fa-person-rays";
  foundry.applications.apps.DocumentSheetConfig.registerSheet(CONFIG.Item.documentClass, MODULE_ID, EffectItemSheet,
    {types: [EFFECT_TYPE], makeDefault: true, label: "Better Effects"});
  game.settings.register(MODULE_ID, "flagLibrary", {scope: "world", config: false, type: Array, default: []});
  registerEffectPicker();
  game.settings.registerMenu(MODULE_ID, "flags", {name: "Flag library", label: "Manage effect flags", hint: "Create and manage the shared flags used by effects, actors, items, and damage rolls.",
    icon: "fa-solid fa-tags", type: FlagLibrary, restricted: true});
  CONFIG.queries[`${MODULE_ID}.resolveDamage`] = openDamageRequest;
  registerFlagHooks(); registerRollHooks();
  installConditionGate();
  installEffectSuppression();
  installRollRequests();
  Hooks.on("preCreateItem", item => { if (item.type === EFFECT_TYPE && item.img === CONFIG.Item.documentClass.DEFAULT_ICON) item.updateSource({img: ICON}); });
});

Hooks.once("setup", async () => {
  const NativeWizard = game.swade.apps.ActiveEffectWizard;
  initializeWizard(); installSheetDrops(); registerCanvasDrops(); installMapDialog(); installOpposedRolls();
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
