import {MODULE_ID} from "./constants.mjs";
import {wrapMethod} from "./effects.mjs";

const TITLE = "SWADE.Settings.JokersWild.Name";

function postReport(report) {
  if (!report.announced) return;
  const title = game.i18n.localize(TITLE);
  const content = document.createElement("div");
  const byCount = Map.groupBy(report.awards.values(), award => award.count);
  for (const [count, awards] of byCount) {
    const line = document.createElement("div");
    const names = awards.map(award => award.name).join(", ");
    line.textContent = game.i18n.format(count === 1 ? "SBE.JokerBenny" : "SBE.JokerBennies", {count, names});
    content.append(line);
  }
  if (!content.childElementCount) content.textContent = title;
  const speaker = byCount.size ? {alias: title} : undefined;
  return CONFIG.ChatMessage.documentClass.create({content: content.outerHTML, speaker});
}

export function installJokerChat() {
  const batches = new WeakMap();
  const ChatMessage = CONFIG.ChatMessage.documentClass;
  const templates = CONFIG.SWADE.bennies.templates;
  const {renderTemplate} = foundry.applications.handlebars;
  let award;
  let queue = Promise.resolve();

  async function withJokers(combat, draw) {
    if (batches.has(combat)) return draw();
    const report = {announced: false, awards: new Map(), tasks: []};
    batches.set(combat, report);
    try {
      return await draw();
    } finally {
      batches.delete(combat);
      // Announcements must not hold up initiative or turn changes.
      if (report.tasks.length) void Promise.all(report.tasks).then(() => postReport(report))
        .catch(error => console.error(`${MODULE_ID} | Could not post the Joker's Wild summary`, error));
    }
  }

  const model = CONFIG.Combatant.dataModels.base?.prototype;
  if (!model) return (_combat, draw) => draw();
  wrapMethod(model, "handOutBennies", function (original, ...args) {
    const combatant = this.parent;
    const combat = combatant?.combat;
    if (!combat || !combatant.hasJoker || !game.settings.get("swade", "jokersWild")) return original(...args);
    function enqueue() {
      const report = batches.get(combat);
      // A deal can contain two Jokers. Serialize the native awards so both Benny
      // increments are applied even when they have the same recipient.
      queue = queue.then(async () => {
        const type = combatant.actor?.type === "character" ? "character" : "npc";
        const recipients = new Set(combat.combatants.map(c => c.actor).filter(actor => actor?.type === type && actor.isOwner));
        const visibleActors = new Set(combat.combatants.filter(c => !c.hidden && !c.token?.hidden).map(c => c.actor?.uuid));
        if (type === "npc") for (const user of game.users) if (user.active && user.isGM) recipients.add(user);
        // Match the exact localized templates, including customizations made by
        // SWADE or other modules. Leave the native workflow in place if a
        // template cannot be read.
        try {
          const heading = await renderTemplate(templates.joker, {speaker: game.user});
          const notices = await Promise.all([...recipients].map(async target => {
            const speaker = target.documentName === "Actor" ? ChatMessage.getSpeaker({actor: target}) : target;
            const hidden = target.documentName === "Actor" && !visibleActors.has(target.uuid);
            return {target, hidden, content: await renderTemplate(templates.add, {target, speaker})};
          }));
          award = {report, heading, notices, started: false};
        } catch (error) {
          console.warn(`${MODULE_ID} | Could not prepare the Joker's Wild summary`, error);
        }
        try {
          await original(...args);
        } finally {
          award = undefined;
        }
      }).catch(error => console.error(`${MODULE_ID} | Could not award Joker's Wild Bennies`, error));
      report.tasks.push(queue);
      return queue;
    }
    return batches.has(combat) ? enqueue() : withJokers(combat, enqueue);
  });

  // The native award methods always create their own notifications. Collect
  // those notifications while leaving the awards, hooks and animations to SWADE.
  Hooks.on("preCreateChatMessage", (message, data) => {
    if (!award || message.whisper.length || message.blind || message.isRoll) return;
    if (!award.started && data.content === award.heading) {
      award.started = true;
      award.report.announced = true;
      return false;
    }
    if (!award.started) return;
    const actor = ChatMessage.getSpeakerActor(data.speaker);
    const notice = award.notices.find(({target, content}) => content === data.content
      && (target.documentName === "Actor" ? actor?.uuid === target.uuid : !data.speaker));
    if (!notice) return;
    if (notice.hidden) return false;
    const {target} = notice;
    const previous = award.report.awards.get(target.uuid)?.count ?? 0;
    award.report.awards.set(target.uuid, {name: target.name, count: previous + 1});
    return false;
  });
  return withJokers;
}
