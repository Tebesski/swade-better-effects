import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {wrapMethod} from "./effects.mjs";
import {installJokerChat} from "./joker-chat.mjs";

function cardFace(card) {
  const face = card.faces?.[card.face];
  return {img: face?.img, name: face?.name || card.name};
}

async function summarizeDraws(sources) {
  const groups = [];
  for (const source of sources) {
    const {speaker, flags, ...message} = source;
    const {cards, pickedCard, isRedraw, ...swade} = flags.swade ?? {};
    const picked = Array.isArray(cards) && cards.find(card => card._id === pickedCard);
    if (!picked || source.content || source.rolls?.length || source._id) {
      groups.push({source});
      continue;
    }

    // Only combine cards whose chat messages have the same audience and metadata.
    const whisper = [...new Set((message.whisper ?? []).map(user => user.id ?? user))].sort();
    const metadata = {...message, whisper, flags: {...flags, swade}};
    let group = groups.find(entry => entry.rows && foundry.utils.equals(entry.metadata, metadata));
    if (!group) {
      group = {metadata, rows: []};
      groups.push(group);
    }
    group.rows.push({
      combatant: speaker?.alias,
      picked: cardFace(picked),
      discarded: cards.filter(card => card._id !== pickedCard).map(cardFace),
      isRedraw
    });
  }

  try {
    return await Promise.all(groups.map(async group => {
      if (group.source) return group.source;
      return {
        ...group.metadata,
        speaker: {alias: game.i18n.localize("SBE.InitiativeCards")},
        content: await foundry.applications.handlebars.renderTemplate(`${TEMPLATE}/initiative-chat.hbs`, {rows: group.rows})
      };
    }));
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not render the initiative summary`, error);
    return sources;
  }
}

export function installInitiativeChat() {
  const combat = CONFIG.Combat.documentClass.prototype;
  const ChatMessage = CONFIG.ChatMessage.documentClass;
  const automaticDeals = new Map();
  const batchFlag = "initiativeChatBatch";
  const withJokers = installJokerChat();

  // Combatant updates frequently render the tracker again. Keep the original
  // buttons when the footer is unchanged so a render cannot interrupt a click.
  const footerMarkup = new WeakMap();
  wrapMethod(CONFIG.ui.combat.prototype, "_replaceHTML", function (original, parts, content, options) {
    const footer = parts.footer;
    if (footer) {
      const html = footer.outerHTML;
      if (html === footerMarkup.get(this) && content.querySelector('[data-application-part="footer"]')) {
        const {footer: _, ...updated} = parts;
        return original(updated, content, options);
      }
      footerMarkup.set(this, html);
    }
    return original(parts, content, options);
  });

  // SWADE deals local PCs individually, then NPCs as a batch during automatic initiative.
  async function automaticDeal(original, ...args) {
    if (!this.automaticInitiative || automaticDeals.has(this.id)) return original(...args);
    const draws = [];
    automaticDeals.set(this.id, draws);
    try {
      return await withJokers(this, () => original(...args));
    } finally {
      automaticDeals.delete(this.id);
      if (draws.length) void summarizeDraws(draws).then(sources => ChatMessage.createDocuments(sources))
        .catch(error => console.error(`${MODULE_ID} | Could not post the initiative summary`, error));
    }
  }
  wrapMethod(combat, "startCombat", automaticDeal);
  wrapMethod(combat, "_nextRoundAsGM", automaticDeal);

  wrapMethod(combat, "rollInitiative", function (original, ids, options = {}) {
    const messageOptions = foundry.utils.mergeObject(options.messageOptions ?? {}, {
      [`flags.${MODULE_ID}.${batchFlag}`]: automaticDeals.has(this.id) ? this.id : true
    }, {inplace: false});
    return withJokers(this, () => original(ids, {...options, messageOptions}));
  });

  wrapMethod(ChatMessage, "createDocuments", async function (original, sources = [], operation) {
    const batch = sources[0]?.flags?.[MODULE_ID]?.[batchFlag];
    if (!batch || !sources.every(source => source.flags?.[MODULE_ID]?.[batchFlag] === batch)) {
      return original(sources, operation);
    }
    const draws = sources.map(source => {
      const flags = {...source.flags};
      const {[batchFlag]: _, ...moduleFlags} = flags[MODULE_ID];
      if (Object.keys(moduleFlags).length) flags[MODULE_ID] = moduleFlags;
      else delete flags[MODULE_ID];
      return {...source, flags};
    });
    const pending = automaticDeals.get(batch);
    if (pending && !operation && draws.every(draw => !draw.flags.swade?.isRedraw)) {
      pending.push(...draws);
      return [];
    }
    return original(await summarizeDraws(draws), operation);
  });
}
