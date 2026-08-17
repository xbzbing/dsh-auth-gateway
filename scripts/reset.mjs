#!/usr/bin/env node
/**
 * Forgotten-password reset for dsh-auth-gateway.
 *
 * Deletes only the password record ($DSH_HOME/auth-gate/password.json).
 * dsh-auth-gateway has no setup page: the initial credential is minted at boot,
 * so RESTART dsh web after running this — the plugin generates a fresh
 * auto initial password, prints it to the console, and you log in with it
 * and complete onboarding (set a personal password).
 *
 * The OTP binding is a separate file ($DSH_HOME/auth-gate/otp.json); delete
 * it as well when the authenticator is lost (or run dsh-auth-gateway-uninstall
 * to clear the whole directory). Unlike `dsh-auth-gateway-uninstall` this
 * script does NOT remove the plugin or its directory — the composition
 * stays installed.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const file = join(home, 'auth-gate', 'password.json')

try {
  rmSync(file, { force: true })
  console.log(`dsh-auth-gateway: password record removed (${file})`)
  console.log('dsh-auth-gateway: restart dsh web now — a new initial password will be generated and')
  console.log('dsh-auth-gateway: printed to the console; log in with it and complete onboarding.')
  console.log('dsh-auth-gateway: (authenticator lost too? also delete $DSH_HOME/auth-gate/otp.json)')
} catch (err) {
  console.error(`dsh-auth-gateway: failed to remove ${file}: ${err.message}`)
  process.exit(1)
}
