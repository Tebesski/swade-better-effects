import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {renderRollNotes} from "./roll-notes.mjs";
import {collectRules} from "./effects.mjs";
import {calculateWounds, matchingDamageRules, resolveDamage} from "./rules.mjs";
import {damageAP, damageIsHeavyWeapon, damageRoll, isDamageMessage, isTraitMessage, messageContext} from "./roll-context.mjs";
import {renderChatFlags} from "./chat-flags.mjs";
import {renderOpposedRoll} from "./opposed.mjs";
import {moduleScriptBase} from "./module-imports.mjs";
import {damageRulesForTarget} from "./damage-formulas.mjs";

let TargetedAdapter;
let targetedInitialization;
const openDamage = new Map();

export function lingeringDamageRoll(message) {
  const data = message?.getFlag(MODULE_ID, "lingeringResult")?.damage;
  return data ? {roll: Roll.fromData(data.roll), context: data.context} : null;
}

function baseDamage(message) {
  const gmAdjustment = Number.parseInt(message.flags?.["swade-tools"]?.gmmod) || 0;
  return damageRoll(message).total + gmAdjustment;
}

const tinyMelee = context => context.attacker?.includes("size-4") && context.roll?.includes("melee");

export function prepareDamage(actor, token, message, {damage, ap, toughness, armor, context = messageContext(message)} = {}) {
  const rules = damageRulesForTarget(context, actor, token);
  const defense = actor.type === "vehicle" ? actor.system.toughness : actor.system.stats.toughness;
  const resolved = resolveDamage({damage: damage ?? baseDamage(message), ap: ap ?? damageAP(message), toughness: toughness ?? (actor.type === "vehicle" ? defense.total : defense.value),
    armor: armor ?? defense.armor, skipUnrolled: true, ...rules});
  const tiny = tinyMelee(rules.context);
  if (tiny) resolved.damage = Math.min(resolved.damage, 1);
  const blocked = tiny && ((actor.system.stats?.scale ?? actor.system.scale ?? 0) >= -2 || resolved.toughness > 1);
  const immunity = resolved.immunity ? `Immune to this damage (${resolved.immunity}).`
    : blocked ? "Tiny melee cannot harm this target without a swarm."
    : actor.hasHeavyArmor && !damageIsHeavyWeapon(message) ? "Heavy Armor requires a Heavy Weapon." : "";
  return {...resolved, flags: rules.context.roll, immune: !!immunity, immunity};
}

function resultFor(actor, values) {
  return calculateWounds({...values, shaken: actor.system.status?.isShaken, hardy: actor.getFlag("swade", "hardy"), woundCap: game.settings.get("swade", "woundCap")});
}

async function ensureStatus(actor, id, active) {
  if (actor.statuses.has(id) === active) return;
  return actor.toggleActiveEffect(id, {active});
}

export function actorWithDefense(actor, values) {
  const toughness = {...actor.system.stats?.toughness, value: values.toughness, armor: values.armor};
  const system = new Proxy(actor.system, {get(target, key) {
    if (key === "stats") return {...target.stats, toughness};
    if (key === "toughness") return {...target.toughness, total: values.toughness, armor: values.armor};
    return Reflect.get(target, key);
  }});
  return new Proxy(actor, {get(target, key) {
    if (key === "system") return system;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}

export function initializeTargetedDamage() {
  if (!game.modules.get("swade-targeted-damage")?.active) return Promise.resolve();
  return targetedInitialization ??= loadTargetedDamage();
}

async function loadTargetedDamage() {
  try {
    const base = await moduleScriptBase("swade-targeted-damage");
    const {TargetedDamageApplicator: Base} = await import(new URL("modules/TargetedDamageApplicator.mjs", base).href);
    TargetedAdapter = class ConditionalTargetedDamageApplicator extends Base {
      static DEFAULT_OPTIONS = {classes: ["sbe-targeted-adapter"]};
      static PARTS = {summary: {template: `${TEMPLATE}/damage-summary.hbs`}, ...Base.PARTS};
      render(options, ...args) {
        if (options && typeof options === "object" && options.parts) options = {...options, parts: [...new Set([...options.parts, "summary"])]};
        return super.render(options, ...args);
      }
      get actor() {
        const actor = super.actor;
        return this.sbeDefense ? actorWithDefense(actor, this.sbeDefense) : actor;
      }
      async calcWounds() {
        const actor = super.actor;
        const original = {damage: this.object.damage, ap: this.object.ap};
        const values = prepareDamage(actor, this.options.token, this.sbeMessage, original);
        this.sbeValues = values; this.sbeDefense = values;
        try {
          this.object.damage = values.damage; this.object.ap = values.ap;
          await super.calcWounds();
          // Preserve Targeted Damage's soak progress and correct its missing Hardy/heavy-armor check.
          const result = resultFor(actor, values);
          this.object.statusToApply = result.status;
          if (values.immune || !this.object.bestSoakAttempt) this.object.wounds = result.wounds;
        } finally { Object.assign(this.object, original); this.sbeDefense = null; }
      }
      async _prepareContext(...args) { return {...await super._prepareContext(...args), sbe: this.sbeValues}; }
      async outputChat(message) {
        const original = {damage: this.object.damage, ap: this.object.ap};
        this.sbeDefense = this.sbeValues;
        try {
          this.object.damage = this.sbeValues.damage; this.object.ap = this.sbeValues.ap;
          await super.outputChat(message);
        } finally { Object.assign(this.object, original); this.sbeDefense = null; }
      }
      async _onClose(options) { openDamage.delete(this.sbeKey); await super._onClose(options); }
    };
  } catch (error) {
    console.error(`${MODULE_ID} | Targeted Damage adapter could not be loaded`, error);
    ui.notifications.error("Better Effects could not load the Targeted Damage integration. Disable SWADE Targeted Damage to use the standalone conditional resolver.");
  }
}

export class ConditionalDamageApplicator extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor({actor, token, message, key}) {
    super(); this.actor = actor; this.token = token; this.message = message; this.sbeKey = key;
    this.damage = baseDamage(message); this.ap = damageAP(message); this.bestSoak = 0; this.attemptedSoak = false;
  }
  static DEFAULT_OPTIONS = {tag: "form", classes: ["sbe-app"], position: {width: 460}, window: {title: "Resolve Conditional Damage"},
    form: {handler: function () { this.readInputs(); this.render(); }, closeOnSubmit: false},
    actions: {take: async function () { await this.takeDamage(); }, freeSoak: async function () { await this.soak(false); },
      bennySoak: async function () { await this.soak(true); }, dismiss: async function () { await this.close(); }}};
  static PARTS = {form: {template: `${TEMPLATE}/damage-resolver.hbs`}};
  readInputs() {
    for (const key of ["damage", "ap"]) {
      const input = this.element?.querySelector(`[name="${key}"]`);
      if (input) {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) throw new Error("Damage and AP must be nonnegative numbers.");
        if (this[key] !== value) { this.bestSoak = 0; this.attemptedSoak = false; }
        this[key] = value;
      }
    }
  }
  evaluate() {
    this.values = prepareDamage(this.actor, this.token, this.message, {damage: this.damage, ap: this.ap});
    this.result = resultFor(this.actor, this.values);
    this.remaining = Math.max(0, this.result.wounds - this.bestSoak);
  }
  async _prepareContext() {
    this.evaluate();
    return {actor: this.actor, damage: this.damage, ap: this.ap, sbe: this.values, result: this.result, remaining: this.remaining,
      canSoak: this.result.wounds > 0, attemptedSoak: this.attemptedSoak, bestSoak: this.bestSoak, canSpendBenny: this.actor.system.bennies?.value > 0};
  }
  async soak(spend) {
    this.readInputs(); this.evaluate();
    if (!this.actor.isOwner || !this.result.wounds) return;
    if (spend) {
      if (!(this.actor.system.bennies?.value > 0)) return ui.notifications.warn("No Bennies available.");
      await this.actor.spendBenny();
    }
    const mods = [{label: "Soak modifier", value: this.actor.system.attributes.vigor.soakBonus ?? 0}];
    if (game.settings.get("swade", "unarmoredHero") && this.actor.isUnarmored) mods.push({label: "Unarmored Hero", value: 2});
    if (spend && this.attemptedSoak && this.actor.getFlag("swade", "elan")) mods.push({label: "Elan", value: 2});
    const roll = await this.actor.rollAttribute("vigor", {title: "Soak Roll", flavour: "Soak Roll", additionalMods: mods, isRerollable: false});
    if (!roll) return;
    this.attemptedSoak = true;
    if (!roll.isCritfail) this.bestSoak = Math.max(this.bestSoak, Math.max(0, Math.floor(roll.total / 4)));
    this.render();
  }
  async takeDamage() {
    if (this.applying || !this.actor.isOwner) return;
    this.readInputs(); this.evaluate(); this.applying = true;
    try {
      const context = {damage: {total: this.values.damage, ap: this.values.ap}, status: this.result.status,
        wounds: {applied: this.result.wounds, taken: this.remaining, soaked: this.bestSoak}, isHeavyWeapon: damageIsHeavyWeapon(this.message),
        flags: this.values.flags, doubleShaken: this.result.wounds === 1 && this.values.damage < this.values.effectiveToughness + 4 && !!this.actor.system.status?.isShaken};
      if (Hooks.call("swadePreCalcWounds", this.actor, context, this.remaining, this.result.status) === false) return;
      if (this.remaining) {
        const wounds = this.actor.system.wounds;
        const total = wounds.value + this.remaining;
        await this.actor.update({"system.wounds.value": Math.min(wounds.max, total)});
        if (total > wounds.max) await ensureStatus(this.actor, "incapacitated", true);
      }
      const fullySoaked = this.attemptedSoak && this.bestSoak >= this.result.wounds && this.result.wounds > 0;
      if (fullySoaked) await ensureStatus(this.actor, "shaken", false);
      else if (this.result.status !== "none") await ensureStatus(this.actor, "shaken", true);
      if (this.remaining && this.actor.isWildcard && game.settings.get("swade", "grittyDamage") && !context.doubleShaken) {
        const uuid = game.settings.get("swade", "injuryTable");
        if (uuid) await (await foundry.utils.fromUuid(uuid))?.draw();
      }
      Hooks.callAll("swadeTakeDamage", this.actor, context);
      const summary = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/damage-result.hbs`, {name: this.actor.name, remaining: this.remaining, fullySoaked, shaken: !fullySoaked && this.result.status !== "none", sbe: this.values});
      await CONFIG.ChatMessage.documentClass.create({speaker: CONFIG.ChatMessage.documentClass.getSpeaker({actor: this.actor}), content: summary}, {messageMode: game.settings.get("core", "messageMode")});
      await this.close();
    } finally { this.applying = false; }
  }
  async _onClose(options) { openDamage.delete(this.sbeKey); await super._onClose(options); }
}

export async function openDamageRequest({messageUuid, tokenUuid, rollData}) {
  if (game.modules.get("swade-targeted-damage")?.active) {
    await initializeTargetedDamage();
    if (!TargetedAdapter) throw new Error("The Targeted Damage integration is unavailable. Disable SWADE Targeted Damage to resolve conditional effects.");
  }
  let [message, token] = await Promise.all([foundry.utils.fromUuid(messageUuid).catch(() => null), foundry.utils.fromUuid(tokenUuid)]);
  const visible = message?.visible && message.isContentVisible !== false;
  const outcome = visible && lingeringDamageRoll(message);
  if (outcome) {
    if (!outcome.context.targetUuids.includes(tokenUuid)) throw new Error("This token is not the target of the lingering damage.");
    message = {uuid: message.uuid, visible: true, isContentVisible: true, significantRoll: outcome.roll,
      getFlag: (scope, key) => scope === MODULE_ID && key === "context" ? outcome.context : undefined};
  }
  // A GM may intentionally resolve a whispered roll against a player's actor. Send only the
  // damage context needed by the owner; never require access to the original private message.
  if ((!message?.visible || message.isContentVisible === false) && rollData && Number.isFinite(rollData.total) && Number.isFinite(rollData.ap)) {
    const context = structuredClone(rollData.context);
    message = {uuid: messageUuid, visible: true, significantRoll: {total: rollData.total, ap: rollData.ap,
      isHeavyWeapon: !!rollData.isHeavyWeapon, options: {rollType: "damage"}}, getFlag: (scope, key) => scope === MODULE_ID && key === "context" ? context : undefined};
  }
  const actor = token?.actor;
  if (!actor?.isOwner || !message?.visible || message.isContentVisible === false || !isDamageMessage(message)) throw new Error("This damage request is not accessible.");
  const key = `${messageUuid}:${tokenUuid}`;
  const existing = openDamage.get(key);
  if (existing) { existing.bringToFront(); return {opened: true}; }
  const app = TargetedAdapter ? new TargetedAdapter({token, damage: baseDamage(message), ap: damageAP(message)})
    : new ConditionalDamageApplicator({actor, token, message, key});
  app.sbeMessage = message; app.sbeKey = key;
  openDamage.set(key, app);
  try { await app.render({force: true}); } catch (error) { openDamage.delete(key); throw error; }
  return {opened: true};
}

export async function resolveMessageDamage(message) {
  const targeted = game.modules.get("swade-targeted-damage")?.active;
  const context = messageContext(message);
  const tokens = context.lingeringDamage ? (context.targetUuids ?? []).map(uuid => foundry.utils.fromUuidSync(uuid)).filter(Boolean)
    : targeted ? [...game.user.targets] : canvas.tokens?.controlled ?? [];
  if (!tokens.length) return ui.notifications.warn(targeted ? "Target at least one token first." : "Select at least one token first.");
  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    const request = {messageUuid: message.uuid, tokenUuid: (token.document ?? token).uuid, rollData: {total: baseDamage(message), ap: damageAP(message),
      isHeavyWeapon: !!damageIsHeavyWeapon(message), context: structuredClone(context)}};
    const playerOwner = game.users.find(u => u.active && !u.isGM && u.character?.id === actor.id && actor.testUserPermission(u, "OWNER"))
      ?? game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
    if (actor.isOwner && (!targeted || !playerOwner || playerOwner.id === game.user.id)) await openDamageRequest(request);
    else {
      const owner = playerOwner ?? game.users.activeGM;
      if (!owner) { ui.notifications.warn(`No connected owner can resolve damage for ${actor.name}.`); continue; }
      await owner.query(`${MODULE_ID}.resolveDamage`, request);
      ui.notifications.info(`Sent damage for ${actor.name} to ${owner.name}.`);
    }
  }
}

export function renderDamageMessage(message, html) {
  const damage = isDamageMessage(message);
  if ((!damage && !isTraitMessage(message)) || message.isContentVisible === false) return;
  if (html.dataset.sbeDamageBound) return;
  html.dataset.sbeDamageBound = "true";
  const context = messageContext(message);
  renderOpposedRoll(message, html, context);
  renderChatFlags(message, html, context);
  renderRollNotes(message, html, context).catch(error => console.error(`${MODULE_ID} | Roll notes`, error));
  if (!damage) return;
  html.addEventListener("click", event => {
    if (!event.target.closest("button.calculate-wounds")) return;
    const tokens = game.modules.get("swade-targeted-damage")?.active ? [...game.user.targets] : canvas.tokens?.controlled ?? [];
    if (!context.lingeringDamage && !tinyMelee(context) && !context.attackerRules?.length
      && !tokens.some(t => t.actor && (collectRules(t.actor).length
        || [...matchingDamageRules(damageRulesForTarget(context, t.actor, t.document ?? t))].some(rule => rule.resolutionOnly)))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    resolveMessageDamage(message).catch(error => ui.notifications.error(error.message, {console: true}));
  }, {capture: true});
}
