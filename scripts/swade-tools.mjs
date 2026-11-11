import {damageFormula, sharedDamageRules} from "./damage-formulas.mjs";
import {damageRuleKey} from "./rules.mjs";
import {MODULE_ID} from "./constants.mjs";
import {actorWithDefense, prepareDamage} from "./damage.mjs";
import {wrapMethod} from "./effects.mjs";
import {damageAP, isDamageMessage, isTraitMessage, makeContext, messageContext, setRollContext, traitAdjustment} from "./roll-context.mjs";
import {isFlagSuppressed} from "./default-flags.mjs";
import {moduleScriptBase} from "./module-imports.mjs";

// Keep SWADE Tools' target labels, application handlers, and soak workflow. Supply an
// equivalent defense only while its synchronous target calculation is running.
export async function initializeSwadeTools() {
  if (!game.modules.get("swade-tools")?.active) return;
  try {
    const base = await moduleScriptBase("swade-tools");
    const [{default: RollControl}, gb, {default: BasicRoll}, {default: CharRoll}] = await Promise.all([
      import(new URL("scripts/class/RollControl.js", base).href),
      import(new URL("scripts/gb.js", base).href),
      import(new URL("scripts/class/BasicRoll.js", base).href),
      import(new URL("scripts/class/CharRoll.js", base).href)
    ]);
    wrapMethod(CharRoll.prototype, "baseModifiers", function (original, damage = false) {
      if (damage || !isFlagSuppressed(this.actor, "fatigue")) return original(damage);
      // Tools reads the counter directly. Give this synchronous calculation a
      // view with no fatigue penalty, preserving the real counter and wounds.
      const actor = this.actor;
      const system = new Proxy(actor.system, {get(target, key) {
        if (key === "fatigue") return {...target.fatigue, ignored: target.fatigue.value};
        return Reflect.get(target, key);
      }});
      this.actor = new Proxy(actor, {get(target, key) {
        if (key === "system") return system;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }});
      try { return original(damage); } finally { this.actor = actor; }
    });
    wrapMethod(CharRoll.prototype, "rollAtt", function (original, attribute, ...args) {
      this.sbeAttribute = attribute;
      this.addFlag("attribute", attribute);
      return original(attribute, ...args);
    });
    wrapMethod(BasicRoll.prototype, "buildRoll", async function (original, die, wild, modifier, rof) {
      if (!this.actor || !this.skillName && !this.sbeAttribute) return original(die, wild, modifier, rof);
      const skill = this.actor.items.find(item => item.type === "skill" && item.name === this.skillName);
      const context = makeContext(this.actor, this.item, [], {kind: "trait", skill, attribute: this.sbeAttribute ?? skill?.system.attribute});
      const target = canvas.tokens?.get(this.usetarget) ?? game.user.targets.first();
      const result = traitAdjustment(context, target, {includeDefender: !this.item});
      context.traitApplied = result.value;
      context.traitTargetUuid = !this.item ? target?.document.uuid : null;
      for (const mod of result.applied) this.reasons.push(`${mod.label}: ${mod.value}`);
      const roll = await original(die, wild, Number(modifier || 0) + result.value, rof);
      setRollContext(roll, context);
      return roll;
    });
    wrapMethod(BasicRoll.prototype, "buildDamageRoll", async function (original, damage, modifier, raise, raisedie = 6) {
      const context = makeContext(this.actor, this.item);
      const targets = String(this.usetarget ?? "").split(",").map(id => canvas.tokens?.get(id)?.document.uuid).filter(Boolean);
      if (targets.length) context.targetUuids = targets;
      const rules = sharedDamageRules(context);
      if (!rules.length) return original(damage, modifier, raise, raisedie);
      const bonus = raise ? `+1d${raisedie}x` : "";
      const base = `${this.explodeAllDice(damage)}${bonus}${this.prepareModifier(modifier)}`;
      this.roll = new CONFIG.Dice.SwadeRoll(damageFormula(base, rules, true));
      setRollContext(this.roll, {...context, damageRulesInRoll: rules.map(rule => damageRuleKey(rule))});
      return this.roll.evaluate();
    });
    wrapMethod(RollControl.prototype, "attackTarget", function (original, target, total, ...args) {
      if (!target?.actor) return original(target, total, ...args);
      const context = structuredClone(messageContext(this.chat));
      if (context.roll.includes("melee") && gb.setting("gangUp")) {
        context.roll = context.roll.filter(flag => flag !== "gang-up");
        const source = this.getActor(true);
        if (source && this.gangUp(source, target) > 0) context.roll.push("gang-up");
      }
      const result = traitAdjustment(context, target);
      const start = this.targetPrint.length;
      const returned = original(target, total + result.value - (context.traitApplied ?? 0), ...args);
      if (result.applied.length) {
        const description = foundry.utils.escapeHTML(result.applied.map(mod => `${mod.label}: ${mod.value}`).join("; "));
        for (const entry of this.targetPrint.slice(start)) entry.print = entry.print.replace('class="swadetools-targetname"', `class="swadetools-targetname" data-tooltip="${description}"`);
      }
      return returned;
    });
    wrapMethod(RollControl.prototype, "damageTarget", function (original, target, newWounds = null, ...rest) {
      if (newWounds !== null || !target?.actor || !isDamageMessage(this.chat)) return original(target, newWounds, ...rest);
      const actor = target.actor;
      const item = this.getItemOwner()?.items.get(this.chat.flags["swade-tools"]?.itemroll);
      if (!item) return original(target, newWounds, ...rest);
      const vehicle = actor.type === "vehicle";
      const area = this.chat.flags["swade-tools"].usecalled || "torso";
      const armor = vehicle ? actor.system.toughness.armor : gb.getArmorArea(actor, area);
      const base = vehicle ? actor.system.toughness.total : actor.system.stats.toughness.value;
      const toughness = vehicle ? base : base - gb.getArmorArea(actor) + armor;
      const values = prepareDamage(actor, target.document, this.chat, {damage: this.roll.total + this.gmmod,
        ap: damageAP(this.chat), toughness, armor});
      if (!values.applied.length) return original(target, newWounds, ...rest);

      // SWADE Tools has its own AP and hit-location calculation. Offset its final
      // threshold to the resolved one, leaving its armor and item data intact.
      let toolsAP = 0;
      if (item.system.ap) {
        const action = item.system.actions.additional[this.chat.flags["swade-tools"].useaction];
        toolsAP = Math.max(0, Number(action?.ap || item.system.ap)
          + (this.getItemOwner().system.stats?.globalMods.ap ?? []).reduce((sum, mod) => sum + Number(mod.value), 0));
      }
      const toolsDefense = toughness - Math.min(toolsAP, armor);
      const defense = actorWithDefense(actor, {toughness: base + values.effectiveToughness - toolsDefense,
        armor: vehicle ? actor.system.toughness.armor : actor.system.stats.toughness.armor});
      const adjustedTarget = new Proxy(target, {get(object, key) {
        if (key === "actor") return defense;
        return Reflect.get(object, key, object);
      }});
      const roll = this.roll;
      const start = this.targetShow.length;
      const adjustedTotal = values.damage - this.gmmod;
      this.roll = new Proxy(roll, {get(object, key) {
        if (key === "total") return adjustedTotal;
        return Reflect.get(object, key, object);
      }});
      try {
        const result = original(adjustedTarget, newWounds, ...rest);
        const explanation = foundry.utils.escapeHTML(`Damage ${values.damage} vs Toughness ${values.effectiveToughness}. `
          + values.applied.map(rule => `${rule.label}: ${rule.before} → ${rule.after}${rule.formula ? ` (${rule.formula} = ${rule.rolledValue})` : ""}`).join("; "));
        this.targetShow = this.targetShow.slice(0, start) + this.targetShow.slice(start)
          .replace('class="swadetools-targetname"', `class="swadetools-targetname" data-tooltip="${explanation}"`);
        return result;
      } finally { this.roll = roll; }
    });
    wrapMethod(RollControl.prototype, "rerollBasic", function (original, ...args) {
      if (isDamageMessage(this.chat)) setRollContext(this.chat.rolls[0], {...structuredClone(messageContext(this.chat)),
        rollType: "damage", ap: damageAP(this.chat)});
      else if (isTraitMessage(this.chat)) setRollContext(this.chat.rolls[0], messageContext(this.chat));
      return original(...args);
    });
    wrapMethod(RollControl.prototype, "addButtons", function (original, ...args) {
      const result = original(...args);
      if (isDamageMessage(this.chat) || isTraitMessage(this.chat)) {
        const html = this.html[0];
        const toolbar = html.querySelector(".swadetools-relative");
        const total = html.querySelector(".dice-total");
        if (toolbar && total) { html.classList.add("sbe-tools-damage"); total.after(toolbar); }
      }
      return result;
    });
  } catch (error) {
    console.error(`${MODULE_ID} | SWADE Tools integration could not be loaded`, error);
    ui.notifications.error("Better Effects could not load its SWADE Tools integration. See the browser console for details.");
  }
}
