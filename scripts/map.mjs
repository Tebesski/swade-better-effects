import {wrapMethod} from "./effects.mjs";
import {messageContext} from "./roll-context.mjs";
import {normalizeFlags, resolveMapPenalty} from "./rules.mjs";
import {documentFlags} from "./flags.mjs";

export function installMapDialog() {
  const RollDialog = game.swade.RollDialog;
  wrapMethod(RollDialog.prototype, "_onRender", async function (original, ...args) {
    await original(...args);
    if (!this.isTraitRoll) return;
    const context = messageContext({significantRoll: this.ctx.roll, speakerActor: this.ctx.actor ?? this.ctx.item?.actor,
      speaker: this.ctx.speaker, getFlag: () => undefined});
    const targetUuid = context.traitTargetUuid;
    const target = targetUuid ? foundry.utils.fromUuidSync(targetUuid) : null;
    const targetFlags = normalizeFlags([...documentFlags(target?.actor), ...documentFlags(target)]);
    for (const input of this.element.querySelectorAll('input[name="map"]')) {
      const base = Number(input.dataset.sbeMapBase ?? input.value);
      input.dataset.sbeMapBase = String(base);
      const result = resolveMapPenalty({penalty: base, context: {...context, target: targetFlags}, rules: context.attackerRules ?? []});
      input.value = String(result.penalty);
      input.checked = base === (this.sbeMapSelection ?? 0);
      const label = this.element.querySelector(`label[for="${input.id}"]`);
      if (base && label) {
        label.textContent = String(result.penalty);
        if (result.applied.length) label.title = result.applied.map(rule => `${rule.label}: ${rule.before} → ${Math.max(0, rule.after)}`).join("; ");
        else label.removeAttribute("title");
      }
      if (!input.dataset.sbeMapBound) {
        input.dataset.sbeMapBound = "true";
        input.addEventListener("change", () => { if (input.checked) this.sbeMapSelection = base; });
      }
    }
  });
}
