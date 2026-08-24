/**
 * LAN trust bootstrap script (served via tapIndex into every page `<head>`).
 *
 * dsh pins its configuration plane (settings/credentials RPCs) to
 * loopback-same-origin "until a real authentication layer exists"
 * (packages/client/connection/src/index.ts, PRIVILEGED_METHODS comment). The
 * comment anticipates that need but never implements or endorses a solution;
 * this project deliberately fills the role — every page it serves has passed
 * password + optional OTP, and it rewrites Host/Origin to the loopback
 * upstream. The client-side consequence is `connection.isLoopback`: ui-settings snapshots it
 * at ITS apply time and locks settings persistence to host (loopback) or
 * memory (domain). On domain/reverse-proxy access the value is false, so the
 * Models page reports "settings are unavailable in this browser".
 *
 * This script flips `connection.isLoopback` to true BEFORE ui-settings
 * snapshots it, without breaking coexisting plugins. Mechanism (verified
 * empirically, see TROUBLESHOOTING §6):
 *
 * 1. It runs at `<head>` time — before any bundle — when
 *    `window.__ModuleLoader__` exists in queue mode.
 * 2. It wraps ONLY the registration of `@deepseek-ai/dsh-client-connection`
 *    (its factory/apply), pass-through for every other plugin. Replacing
 *    `loader.load` with a pass-through proxy is proven harmless; the conflict
 *    in auth-gateway@0.4.2 came from REPLACING `ctx.provide`, not from the
 *    proxy layer.
 * 3. The wrapped apply does NOT touch `ctx.provide` (a mixin accessor bound
 *    to the reading ctx; assigning it pollutes the shared ReflectService and
 *    redirects every later `ctx.provide(...)` into the wrong fiber scope —
 *    that is exactly why better-sidebar broke). Instead it temporarily
 *    replaces `ctx.reflect.provide` — the unbound method on the shared
 *    reflect instance — with a forwarding wrapper that captures the
 *    `connection` handle and forwards via `originalProvide.call(this, ...)`,
 *    so the registration lands on the CALLER's fiber (this = caller receiver
 *    on the shared instance keeps `this.ctx.fiber` correct).
 * 4. After the original apply returns, the captured handle's `isLoopback`
 *    becomes an always-true value, synchronously before any dependent fiber
 *    (ui-settings) wakes from PENDING — their snapshot reads true.
 *
 * Zero runtime dependencies, self-contained, idempotent (bootstrapKey guard),
 * and degrades silently when the loader shape is unexpected.
 *
 * @param pkgName - e.g. '@deepseek-ai/dsh-client-connection' (overridable for tests).
 * @returns the `<script>` element string to inject into `<head>`.
 */
export function buildLanTrustScript(pkgName = '@deepseek-ai/dsh-client-connection') {
  const targetId = pkgName
  return `<script>(() => {
  const targetId = ${JSON.stringify(targetId)}
  const loader = globalThis.__ModuleLoader__
  const bootstrapKey = "__dshAuthGatewayTrustedLoopbackBootstrap__"
  if (loader && loader[bootstrapKey] === true) return
  if (!loader || loader.mode !== "queue" || typeof loader.load !== "function" || typeof loader.create !== "function") {
    console.error("dsh-auth-gateway: incompatible __ModuleLoader__ bootstrap; authenticated LAN settings remain unavailable")
    return
  }
  Object.defineProperty(loader, bootstrapKey, { value: true, configurable: false, enumerable: false })

  const wrappedFactories = new WeakSet()
  const wrappedApplies = new WeakSet()
  const wrappedLoads = new WeakSet()

  /** Wrap only the connection registration; every other registration passes through untouched. */
  const wrapRegistration = (registration) => {
    if (!registration || (registration.id !== targetId && registration.id !== targetId + "/client")) return registration
    const originalFactory = registration.factory
    if (typeof originalFactory !== "function" || wrappedFactories.has(originalFactory)) return registration

    const wrappedFactory = function () {
      const moduleExports = originalFactory.apply(this, arguments)
      if (!moduleExports || typeof moduleExports.apply !== "function" || wrappedApplies.has(moduleExports.apply)) return moduleExports
      const originalApply = moduleExports.apply
      const wrappedApply = function (ctx) {
        // Temporarily swap the UNBOUND provide on the shared reflect instance.
        // Do NOT assign ctx.provide (a mixin-bound accessor): that pollutes
        // the shared ReflectService for every later caller. Forwarding via
        // originalProvide.call(this, ...) keeps the registration on the
        // caller's fiber (this.ctx.fiber), so other plugins' provide calls
        // during this window land in their own scope.
        let captured
        let reflect
        let originalProvide
        try {
          reflect = ctx.reflect
          originalProvide = reflect.provide
          reflect.provide = function (name, value) {
            if (name === "connection") captured = value
            return originalProvide.call(this, name, value)
          }
        } catch { /* reflect unavailable — proceed untrusted */ }
        try {
          return originalApply.apply(this, arguments)
        } finally {
          if (reflect && originalProvide) {
            try { reflect.provide = originalProvide } catch { /* non-fatal */ }
          }
          if (captured && typeof captured === "object") {
            try {
              Object.defineProperty(captured, "isLoopback", {
                value: true, writable: true, configurable: true, enumerable: true,
              })
            } catch { /* non-fatal */ }
          }
        }
      }
      wrappedApplies.add(originalApply)
      wrappedApplies.add(wrappedApply)
      moduleExports.apply = wrappedApply
      return moduleExports
    }
    wrappedFactories.add(wrappedFactory)
    registration.factory = wrappedFactory
    return registration
  }

  const wrapLoad = () => {
    const originalLoad = loader.load
    if (wrappedLoads.has(originalLoad)) return
    const wrappedLoad = function (registration) {
      return originalLoad.call(this, wrapRegistration(registration))
    }
    wrappedLoads.add(wrappedLoad)
    loader.load = wrappedLoad
  }

  wrapLoad()
  const originalCreate = loader.create
  loader.create = function () {
    try {
      return originalCreate.apply(this, arguments)
    } finally {
      wrapLoad()
    }
  }
})()</script>`
}