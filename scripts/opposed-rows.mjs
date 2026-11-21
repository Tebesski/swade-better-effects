export function latestTargetOpposition(messages, messageUuid, defenderUuid, contextOf) {
  let latest = null;
  for (const message of messages) {
    if (message.visible === false || message.isContentVisible === false) continue;
    const context = contextOf(message);
    const opposition = context?.opposition ?? context?.response;
    if (opposition?.messageUuid !== messageUuid || opposition.defenderUuid !== defenderUuid) continue;
    if (!latest || Number(message.timestamp ?? 0) >= Number(latest.timestamp ?? 0)) latest = message;
  }
  return latest;
}
