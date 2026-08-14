#!/usr/bin/env node
/**
 * Forgotten-password reset for dsh-password-gate.
 *
 * Deletes only the password record ($DSH_HOME/login-plugin/password.json);
 * the gateway then serves the "set password" page on the next open and a new
 * password can be chosen. Unlike `dsh-password-gate-uninstall` this does NOT remove
 * the plugin or its directory — the composition stays installed.
 *
 * A running gateway reads the file on every check, so no restart is needed
 * for the reset to take effect; in-flight sessions (in-memory) survive until
 * expiry or process restart, which is fine for the forgotten-password case.
 * Stop dsh web first if you want every session gone immediately.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const file = join(home, 'login-plugin', 'password.json')

try {
  rmSync(file, { force: true })
  console.log(`dsh-password-gate: password record removed (${file})`)
  console.log('dsh-password-gate: open the web UI again — it will ask you to set a new password.')
} catch (err) {
  console.error(`dsh-password-gate: failed to remove ${file}: ${err.message}`)
  process.exit(1)
}
