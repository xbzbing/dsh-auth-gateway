/**
 * Credential data directory for dsh-auth-gateway.
 *
 * All plugin state lives under $DSH_HOME/auth-gateway/.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

/** Resolve the harness home the same way dsh does: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** Current credential directory name. */
export const DIR_NAME = 'auth-gateway'

/** Ensure the credential directory exists with owner-only mode. */
export function ensureCredentialDir() {
  const dir = credentialDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Return the credential directory without creating it. */
export function credentialDir() {
  return join(dshHome(), DIR_NAME)
}

/**
 * The audit trail directory: `$DSH_HOME/auth-gateway/log/`.
 *
 * @returns {string} absolute path of the audit log directory.
 */
export function auditLogDir() {
  return join(credentialDir(), 'log')
}
