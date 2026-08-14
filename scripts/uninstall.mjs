#!/usr/bin/env node
/**
 * Complete-uninstall data cleanup for dsh-password-gate.
 *
 * `dsh plugin --profile web remove` only removes the composition row and
 * bundle layer — it never runs plugin code, so the password record stays on
 * disk. Run this script to delete the plugin's data directory
 * ($DSH_HOME/login-plugin). Stop dsh web first; a running gateway keeps
 * serving from memory until it exits.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const dir = join(home, 'login-plugin')

try {
  rmSync(dir, { recursive: true, force: true })
  console.log(`dsh-password-gate: removed ${dir}`)
} catch (err) {
  console.error(`dsh-password-gate: failed to remove ${dir}: ${err.message}`)
  process.exit(1)
}
