import {MODULE_ID} from "./constants.mjs";
import {messageTargets} from "./chat-flags.mjs";
import {damageRulesForTarget} from "./damage-formulas.mjs";
import {collectEffectRules} from "./effects.mjs";
import {documentFlags, rollTarget} from "./flags.mjs";
import {excludedFlags} from "./default-flags.mjs";
import {isDamageMessage, isTraitMessage, messageContext} from "./roll-context.mjs";
import {matchingDamageRules, matchesFlag, normalizeFlags, testPredicate} from "./rules.mjs";

// Only report flags from successful branches, including positive flags under
// double negation. A matching owner/target condition alone names no roll flags.
function matchedFlags(node, context, negated = false) {
  if (!node || testPredicate(node, context) === negated) return [];
  if (node.op === "not") return matchedFlags(node.child, context, !negated);
  if (node.op === "flag") {
    return !negated && node.source === "roll" ? context.roll.filter(flag => matchesFlag(node.flag, [flag])) : [];
  }
  return node.children.flatMap(child => matchedFlags(child, context, negated));
}

function immunityMatch({context, defenderRules}, {requireFlag = false} = {}) {
  const rules = [...matchingDamageRules({context, defenderRules})].filter(rule => rule.selector === "immunity");
  const flags = normalizeFlags(rules.flatMap(rule => matchedFlags(rule.predicate, {...context, actor: rule.ownerFlags ?? []})));
  return rules.length && (!requireFlag || flags.length) ? flags : null;
}

const gmIds = () => game.users.filter(user => user.isGM).map(user => user.id);
const flagText = flags => flags.length ? ` (${flags.join(", ")})` : "";

function announce(lines, whisper = []) {
  if (!lines.length) return;
  ui.notifications.warn(lines.join(" "));
  const escape = foundry.utils.escapeHTML;
  const content = `<div class="sbe-immunity-notice">${lines.map(line => `<div>${escape(line)}</div>`).join("")}</div>`;
  void CONFIG.ChatMessage.documentClass.create({content, speaker: {alias: game.i18n.localize("SBE.Immunity")}, whisper},
    {notify: false}).catch(error => console.error(`${MODULE_ID} | Immunity notice`, error));
}

function noticeForRoll(message, _options, userId) {
  const damage = isDamageMessage(message);
  if ((!damage && !isTraitMessage(message)) || !message.isContentVisible) return;
  // The user who rolls usually posts the notice. For a blind player roll,
  // only a GM who can see that roll may post it.
  const author = game.users.get(userId);
  const shouldDelegate = message.blind && !author?.isGM;
  const publisher = shouldDelegate
    ? game.users.getDesignatedUser(user => user.active && user.isGM && message.whisper.includes(user.id))
    : author;
  if (game.user.id !== publisher?.id) return;

  const context = messageContext(message);
  const targets = messageTargets(message, context);
  if (!targets.length && context.opposition?.actorUuid && !context.opposition.tokenUuid) {
    const actor = foundry.utils.fromUuidSync(context.opposition.actorUuid);
    if (actor) targets.push({actor, name: actor.name});
  }
  const lines = [], hidden = [];
  for (const token of targets) {
    if (!token.actor || (token.hidden && !game.user.isGM)) continue;
    const flags = immunityMatch(damageRulesForTarget(context, token.actor, token), {requireFlag: !damage});
    if (!flags) continue;
    const line = game.i18n.format("SBE.ImmuneToRoll", {name: token.name, flags: flagText(flags)});
    (token.hidden ? hidden : lines).push(line);
  }
  const audience = shouldDelegate ? message.whisper.filter(id => id !== author?.id) : [...message.whisper];
  announce(lines, audience);
  const privateRecipients = audience.length ? audience.filter(id => game.users.get(id)?.isGM) : gmIds();
  if (privateRecipients.length) announce(hidden, privateRecipients);
}

function noticeForEffect(effect, userId) {
  if (game.user.id !== userId || !effect.modifiesActor || effect.pack) return;
  const actor = effect.actor;
  if (!actor) return;
  const excluded = new Set(excludedFlags(effect));
  const roll = normalizeFlags([...documentFlags(effect), ...effect.statuses]).filter(flag => !excluded.has(flag));
  if (!roll.length) return;
  const token = actor.token;
  const context = {hasRoll: true, roll};
  context.target = rollTarget(context, token, actor).flags;
  const effects = [...actor.allApplicableEffects()].filter(defense => defense !== effect);
  const defenderRules = collectEffectRules(effects, context.target);
  const flags = immunityMatch({context, defenderRules}, {requireFlag: true});
  if (!flags) return;
  const tokens = token ? [token] : actor.getActiveTokens(false, true);
  const hidden = tokens.length && tokens.every(token => token.hidden);
  const line = game.i18n.format("SBE.ImmuneToEffect", {name: token?.name ?? actor.name, effect: effect.name, flags: flagText(flags)});
  announce([line], hidden ? [...new Set([...gmIds(), userId])] : []);
}

export function registerImmunityNotices() {
  Hooks.on("createChatMessage", noticeForRoll);
  Hooks.on("createActiveEffect", (effect, _options, userId) => noticeForEffect(effect, userId));
  Hooks.on("updateActiveEffect", (effect, changes, _options, userId) => {
    if (changes.disabled === false) noticeForEffect(effect, userId);
  });
}
