/**
 * Host services this plugin reads off the Cordis context.
 *
 * dsh declares these as module augmentations of `@deepseek-ai/cordis`'s
 * `Context`, in its own packages (`dsh-host-webserver`, `dsh-credentials`,
 * `dsh-settings`). This plugin depends on none of them at runtime — the host
 * provides them — so instead of pulling several prerelease dsh packages in as
 * devDependencies (which would couple every install of this plugin to one dsh
 * version), the shapes actually used here are declared structurally. That is
 * the convention lib/locale.js already follows for `ctx.settings`.
 *
 * Only the members this plugin calls are declared. Each signature is copied
 * from the host's own declarations (dsh 0.2.1-rc.2):
 *   - webServer.tapIndex   dsh-host-webserver/lib/types/index.d.ts:198
 *                          `tapIndex(transform: (html: string) => string): () => void`
 *   - credentials.*        dsh-credentials/lib/types/index.d.ts:159/186/191
 *   - settings.describe    dsh-settings (shape mirrored from lib/locale.js,
 *                          which consumes it)
 *
 * A host API change surfaces here as a typecheck error at the call site — it
 * can never change runtime behaviour. Keep this file in sync with the host.
 *
 * `export {}` makes this file a module, so the `declare module` block below is
 * an AUGMENTATION of cordis' Context. Without it the file is a script, the
 * block becomes an ambient module declaration that REPLACES cordis' own types,
 * and every other Context member (logger, effect, emit, get, …) disappears.
 */

export {}

declare module '@deepseek-ai/cordis' {
  /**
   * Credential-record payload as this plugin stores it: a `grant` record whose
   * payload carries the panel's cookieSecure override. The seam treats the
   * payload as opaque (see lib/gateway-panel-api.js).
   */
  interface AuthGatewayCredentialRecord {
    kind?: string
    payload?: { mode?: unknown }
  }

  interface Context {
    /** dsh's webserver service. */
    webServer: {
      /** Bound address — the plugin asserts this stays on loopback. */
      host: string
      /** Register an index.html transform; returns its disposer. */
      tapIndex(transform: (html: string) => string): () => void
    }
    /** dsh's credential-record store (the settings panel's persistence seam). */
    credentials: {
      readRecord(key: string): Promise<AuthGatewayCredentialRecord | undefined>
      modifyRecord(
        key: string,
        mutate: (
          current: AuthGatewayCredentialRecord | undefined,
        ) => Promise<AuthGatewayCredentialRecord | undefined>,
      ): Promise<AuthGatewayCredentialRecord | undefined>
      deleteRecord(key: string): Promise<void>
    }
    /** dsh's settings service (read for the UI language preference). */
    settings: {
      describe?: () => Array<{ ns?: string, value?: { preference?: unknown } }>
    }
  }
}
