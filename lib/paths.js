/**
 * Credential data directory for dsh-auth-gateway.
 *
 * All plugin state lives under $DSH_HOME/auth-gateway/ (password record,
 * OTP secret + master key, audit trail). The directory name matches the
 * plugin name — the historical `auth-gate/` predates the v0.3 rename.
 *
 * Migration: a deployment upgraded from an older release still carries its
 * credentials under `auth-gate/`. The first call to `credentialDir()` renames
 * the legacy directory into place (same filesystem, atomic) and logs nothing
 * on success; if both exist (a partially migrated tree), the new one wins and
 * the legacy copy is left untouched rather than merged.
 */

import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

/** Resolve the harness home the same way dsh does: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** Legacy directory name (pre-rename deployments). */
export const LEGACY_DIR_NAME = 'auth-gate'

/** Current credential directory name. */
export const DIR_NAME = 'auth-gateway'

/** Whether the legacy directory has already been folded into the new one. */
let migrated = false

/**
 * The credential directory, migrating the legacy `auth-gate/` on first call.
 *
 * Migration rule: the legacy directory is folded into the new one only when
 * it holds data AND the new directory does not exist yet — an upgrade-in-place
 * keeps every credential (password, OTP, audit trail) with its original file
 * modes. A deployment that already runs the new layout is never touched, and
 * a failed migration degrades to a fresh directory (equivalent to a reset)
 * rather than bricking the gateway.
 * @returns {string} absolute path of $DSH_HOME/auth-gateway.
 */
export function credentialDir() {
  const home = dshHome()
  const dir = join(home, DIR_NAME)
  if (!migrated) {
    migrated = true
    const legacy = join(home, LEGACY_DIR_NAME)
    // Only a real directory migrates: a stray file named `auth-gate` is left
    // in place rather than renamed over the credential directory's name.
    if (isDirectory(legacy) && !existsSync(dir)) {
      try {
        // POSIX rename moves a directory onto an absent target atomically;
        // the new directory must not pre-exist, which the guard above ensures.
        renameSync(legacy, dir)
      } catch (err) {
        // A failed rename (e.g. EXDEV across mounts) must be loud: the
        // gateway would otherwise start with a fresh credential dir and mint
        // a new initial password while the old credentials sit untouched.
        console.error(
          `[dsh-auth-gateway] failed to migrate ${legacy} -> ${dir}:`,
          err instanceof Error ? err.message : err,
          '— move it manually or remove it, then restart.',
        )
      }
    }
  }
  return dir
}

/** Ensure the credential directory exists with owner-only mode. */
export function ensureCredentialDir() {
  const dir = credentialDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * The audit trail directory: `$DSH_HOME/auth-gateway/log/`.
 *
 * Kept as a subdirectory of the credential dir so backups and permissions can
 * be managed per-tree, while staying separate from the secret files at the
 * root. Created (0700) on first use by the audit writer.
 * @returns {string} absolute path of the audit log directory.
 */
export function auditLogDir() {
  return join(credentialDir(), 'log')
}

/** True when path exists and is a directory (files masquerading as one are skipped by migrations). */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
