# ADR-0001: Authenticate upstream through the official `connection.authentication` provider

> [简体中文](../../zh/adr/0001-official-authentication-provider.md) | English

- Status: accepted (0.9.0)
- Date: 2026-11-23
- Versions: dsh `0.2.3-alpha.1` adds the authentication provider registry; `0.2.2` and earlier have none

## Context

Every request the gateway forwards has already passed its password (+ OTP) gate, but dsh's internal webserver runs its own browser authentication: the index and `/api` demand the launch token or a signed cookie. Up to 0.8.x the gateway read dsh's signing-secret record `client-connection/browser-session` through `ctx.credentials` and minted cookies in dsh's private format (`dsh-auth-<hash>` = `v1.<payload>.<HMAC>`) on the loopback hop (`lib/upstream-auth.js`).

That path depends on three things that are not public contracts: the shape of the secret record, the cookie name and payload format, and how the authority is derived. dsh 0.2.3 moved BrowserAuth into its own package, `@deepseek-ai/dsh-host-authentication-token`. The format is unchanged for now, but nothing keeps it that way.

The same release adds a provider registry to Connection, `connection.authentication`: webserver admission asks the registered providers in order and the first one that returns a Peer wins. The official Token and remote-connection plugins both sign in through it. The gateway runs in the same process as dsh, so it can register its own provider and stop copying Token's format.

## Decision

1. **On dsh 0.2.3 and later, register an official provider.** In `apply`, the gateway probes the registry with `ctx.get('connection.authentication')`. When the registry is present:
   - it registers the provider from a child plugin (`inject: ['connection', 'connection.authentication']`) and creates the gateway's own shared Peer with `connection.createPeer({ principal: { kind: 'owner' } })`. The child scope unloads with the gateway, which withdraws the provider and the Peer together;
   - it generates a 32-byte random credential on every plugin activation (including reloads) and keeps it in memory only. Every gate-passed forward (HTTP and WebSocket upgrade) carries the header `x-dsh-auth-gateway-credential: <credential>`. The provider recognizes it with a constant-time comparison and returns the gateway's Peer;
   - the registration is awaited **before the gateway listens**; if it does not complete within the default 10s the plugin **throws and startup fails** (fail loud) instead of degrading into a state where the login page loads but every forward is 401 — that state is harder to diagnose than a failed start;
   - it never reads `client-connection/browser-session` and never mints dsh-format cookies.
2. **On 0.2.2 and earlier, keep the existing path.** Without the registry the behavior is exactly that of 0.8.x: read the signing secret and mint v1 cookies. One of the two paths is chosen at startup. They never switch or mix at runtime.
3. **Every forward first deletes any browser-supplied header with that name**, including the pre-gate public assets and the `publicPaths` handshakes, so the header cannot be forged. Anonymous forwards never carry the credential.
4. **Related changes** (part of the same adaptation, committed separately):
   - `publicPaths` forwards keep the browser's loopback Host. dsh 0.2.3 matches the account callback by `Host === the browser origin that started the login`, and the loopback rewrite would make every callback miss;
   - the bundle patch disables the `remote-connection` row. Its QR redemption requires `Host === publicUrl`, which always fails behind the gateway; the gateway's own gate blocks its anonymous pairing routes; and its settings card would display the process launch token. Remote access is the gateway's job.

## What stays the same

- Loopback binding: the internal webserver still listens on `127.0.0.1` only.
- Host/Origin rewrite: Connection's source policy (the Host fence) and authentication providers are separate layers, and the fence still checks Host.
- The LAN trust script: the client's `connection.isLoopback` still looks only at the page address, so that security exception stays.
- The supported range keeps its floor (`0.1.5-rc.2`), because the old path is still there.

## Consequences

- From dsh 0.2.3 on, the gateway no longer depends on Token's secret record or cookie format. A format change in the Token package can no longer make every forward 401.
- A browser reaching dsh through the gateway is admitted as the gateway's own owner Peer, separate from Token's browser Peer and API Peers. Unloading the gateway closes the connections on that Peer and leaves Token connections alone.
- The credential appears only in process memory and on the loopback hop, and is replaced on every plugin activation. Only a local user who can inspect the dsh process memory or sniff loopback traffic could read it, and such a user is already inside the trust boundary.
- The gateway now injects `connection`, so its lifecycle follows Connection: a Connection reload (for example a change to its config) restarts the gateway too, clearing the in-memory session table and signing every user out. Connection's config (`trustedHosts`) comes from the CLI and rarely changes at runtime, so the risk is acceptable. The inject holds at the supported floor: the `@deepseek-ai/dsh-web-app` bundle patch of 0.1.5-rc.2 already enables `@deepseek-ai/dsh-client-connection`, whose lib provides the service via `super(ctx, 'connection')`.
- Both paths have to be maintained and tested until the supported floor moves past 0.2.3. At that point, delete `lib/upstream-auth.js` and the fallback branch, and add a note at the end of this ADR.

## Rejected alternatives

- **Keep minting cookies only**: the least work, but it keeps the dependency on dsh's private format. 0.2.3 has already moved that format into its own package, and the next format change would make every forward 401.
- **Raise the floor to 0.2.3 now**: simpler code, but 0.2.2 users would have no alternative. The fallback is the existing code, so keeping it costs little.
- **Have the provider validate the gateway session cookie directly**: this would remove the header, but it would expose the session table, the onboarding/OTP state and basePath handling to dsh's admission flow, so there would be two places that decide authentication instead of one. With the chosen design the gate remains the only decision point, and the provider only confirms that a request came from the gateway.
- **Listen to `webserver/authorize` and admit requests there**: that is the webserver's internal admission event, already claimed by Connection. The provider registry is the extension point dsh offers authentication plugins.
