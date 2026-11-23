import {t as sbsI18n} from "./i18n.mjs";
import { MODULE_ID } from "./constants.mjs"
import { wrapMethod } from "./effects.mjs"

const TEXT_OPTIONS = {
   get fontFamily() { return sbsI18n("swade-better-effects.UI.Signika_08d428107e"); },
   fontSize: 16,
   followToken: true,
   duration: 1000,
   fadeIn: 150,
   gap: 1,
   rise: 0.3,
}

async function showEffectText(token, content) {
   if (!game.settings.get("core", "scrollingStatusText")) return
   const layer = canvas.interface
   const scale = canvas.dimensions.uiScale
   const origin = { ...token.center }
   const text = new foundry.canvas.containers.PreciseText(content, {
      fontFamily: TEXT_OPTIONS.fontFamily,
      fontSize: TEXT_OPTIONS.fontSize,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
   })
   text.anchor.set(0.5, 1)
   // Match Foundry's scrolling-text overlay, above token interface layers.
   text.zIndex = CONFIG.Canvas.groups.interface.zIndexScrollingText
   text.eventMode = "none"
   text.scale.set(scale)
   text.alpha = 0
   const motion = { progress: 0 }
   const position = () => {
      const visible =
         canvas.ready &&
         !token.destroyed &&
         token.visible &&
         !token.document.isSecret
      text.visible = !!visible
      if (!visible) return
      const center = TEXT_OPTIONS.followToken ? token.center : origin
      const elapsed = motion.progress * TEXT_OPTIONS.duration
      const opacity =
         elapsed < TEXT_OPTIONS.fadeIn
            ? elapsed / TEXT_OPTIONS.fadeIn
            : (TEXT_OPTIONS.duration - elapsed) /
              (TEXT_OPTIONS.duration - TEXT_OPTIONS.fadeIn)
      text.alpha = (1 - Math.cos(Math.PI * opacity)) / 2
      text.position.set(
         center.x,
         center.y -
            token.h / 2 -
            TEXT_OPTIONS.gap * scale -
            motion.progress * TEXT_OPTIONS.rise * token.h,
      )
   }
   layer.addChild(text)
   position()
   try {
      await foundry.canvas.animation.CanvasAnimation.animate(
         [{ parent: motion, attribute: "progress", from: 0, to: 1 }],
         { duration: TEXT_OPTIONS.duration, ontick: position },
      )
   } finally {
      if (!text.destroyed) text.destroy()
   }
}

export function installEffectText() {
   const triggeringTokens = new WeakMap()
   const prototype = CONFIG.ActiveEffect.documentClass.prototype
   for (const event of [sbsI18n("swade-better-effects.UI.Create_4759498ac2"), sbsI18n("swade-better-effects.UI.Update_c1c1009d3f"), "Delete"]) {
      Hooks.on(`pre${event}ActiveEffect`, (effect, ...args) => {
         const options = event === "Delete" ? args[0] : args[1]
         if (options.sbeEffectTextTokenUuid || !canvas.ready) return
         const actor = effect.actor
         if (!actor) return
         const tokens = actor.getActiveTokens(true)
         const controlled = tokens.filter((token) => token.controlled)
         const targeted = tokens.filter((token) => game.user.targets.has(token))
         const token =
            actor.token?.object ??
            (controlled.length === 1 ? controlled[0] : null) ??
            (targeted.length === 1 ? targeted[0] : null) ??
            (tokens.length === 1 ? tokens[0] : null)
         if (token) options.sbeEffectTextTokenUuid = token.document.uuid
      })
      wrapMethod(prototype, `_on${event}`, function (original, ...args) {
         const options = event === "Delete" ? args[0] : args[1]
         triggeringTokens.set(this, options.sbeEffectTextTokenUuid)
         try {
            return original(...args)
         } finally {
            triggeringTokens.delete(this)
         }
      })
   }
   wrapMethod(
      CONFIG.ActiveEffect.documentClass.prototype,
      "_displayScrollingStatus",
      function (_original, enabled) {
         if (!canvas.ready || this.target?.documentName !== "Actor") return
         const uuid = triggeringTokens.get(this)
         const tokens = this.target.getActiveTokens(true)
         const triggeringToken = uuid
            ? tokens.find((token) => token.document.uuid === uuid)
            : (this.target.token?.object ??
              (tokens.length === 1 ? tokens[0] : null))
         for (const token of triggeringToken ? [triggeringToken] : []) {
            if (!token.visible || token.document.isSecret) continue
            void showEffectText(
               token,
               `${enabled ? "+" : "-"} ${this.name}`,
            ).catch((error) =>
               console.error(`${MODULE_ID} | Effect text`, error),
            )
         }
      },
   )
}
