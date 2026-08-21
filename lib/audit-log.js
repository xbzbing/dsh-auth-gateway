/**
 * File sink for auth-audit events.
 *
 * The host logger (`ctx.logger`) is buffer-only in the current dsh runtime —
 * its built-in exporter keeps the last 1000 records in memory and nothing
 * persists them. This writer is the durable, greppable audit trail: the
 * `{kind, ip, reason?}` payloads the plugin maps onto `ctx.logger.info` and
 * the brute-force security events (`lockout`, `global-rate-limit`,
 * `otp-rate-limit`, with their structured fields) are appended as JSON Lines
 * to $DSH_HOME/auth-gate/audit.log.
 *
 * Retention: the live file rolls over once per local calendar day
 * (audit.log -> audit.log.<YYYY-MM-DD>), and rotated files older than
 * AUDIT_MAX_AGE_DAYS are deleted. Rotation is stamped with the day the
 * content belongs to (the file's last write day), so a process that was down
 * for several days produces one archive for the day it last wrote — the gap
 * days simply have no events.
 *
 * Note: each record's `ts` field is UTC ISO-8601 while the archive filename
 * uses the LOCAL calendar day — near midnight the ISO date can differ from
 * the filename date in non-UTC zones.
 *
 * Safety properties, matching the repo conventions:
 * - payloads stay kind/ip/reason — never credentials, tokens or OTP codes;
 * - appends are async and failure-isolated: a broken sink degrades to the
 *   onError callback (wired to ctx.logger.warn), never into the auth flow;
 *   housekeeping failures during rotation (mkdir, link, unlink, prune) are
 *   likewise isolated — the append proceeds into whatever live file exists,
 *   and a failed rotation keeps the dedupe streak alive (see #append);
 * - a sustained sink failure is reported once, then at most once per
 *   FAILURE_REPORT_INTERVAL_MS (silenced repeats counted on `error.suppressed`);
 *   recovery after a streak is reported once via onRecover;
 * - writes go through fs.appendFile (open-write-close per line), so the
 *   link+unlink rotation can never leave a stale fd writing into an archived
 *   file;
 * - per-line O_APPEND writes keep each JSON line atomic on local filesystems;
 * - only files matching the exact `audit.log.*` archive pattern are ever
 *   unlinked — anything else in the directory is left alone.
 */

import { chmod, link, mkdir, readdir, appendFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './store.js'

/** Name of the live (today) audit file inside the auth-gate directory. */
export const AUDIT_LOG_NAME = 'audit.log'

/** Rotated archives older than this many days are deleted (at most). */
export const AUDIT_MAX_AGE_DAYS = 90

/** While a failure streak persists, repeat the report at most once per this
 * interval — the first failure of a streak always reports immediately, and
 * recovery is reported once when a write succeeds again. */
export const FAILURE_REPORT_INTERVAL_MS = 5 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** Maximum number of suffix bumps before giving up on a collision-free name. */
const MAX_SUFFIX_BUMP = 100

/** Local calendar day of a timestamp, `YYYY-MM-DD` — the rotation unit. */
export function dayString(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Directory holding the audit trail (same owner-only dir as password.json). */
export function auditLogDir() {
  return join(dshHome(), 'auth-gate')
}

/**
 * Append-only audit writer for one directory.
 *
 * All public methods serialize through an internal promise chain, so
 * concurrent events cannot interleave two rotations of the same file.
 */
export class AuditLogWriter {
  /**
   * @param {object} [options]
   * @param {string} [options.dir] - target directory (tests override; default
   *   $DSH_HOME/auth-gate).
   * @param {() => number} [options.now] - injectable clock (ms epoch).
   * @param {number} [options.maxAgeDays] - archive retention in days.
   * @param {(err: Error) => void} [options.onError] - write-failure sink
   *   (dedupe applied, see #fail).
   * @param {() => void} [options.onRecover] - called once when a write
   *   succeeds again after a failure streak.
   * @param {(from: string, to: string) => Promise<void>} [options.link] -
   *   injectable no-clobber link (deterministic rotation-failure tests).
   */
  constructor({
    dir = auditLogDir(),
    now = Date.now,
    maxAgeDays = AUDIT_MAX_AGE_DAYS,
    onError = () => {},
    onRecover = () => {},
    link: linkImpl = link,
  } = {}) {
    this.dir = dir
    this.now = now
    this.maxAgeDays = maxAgeDays
    this.onError = onError
    this.onRecover = onRecover
    /** Calendar day of the live audit.log; undefined until the first write. */
    this.currentDay = undefined
    /** Stamp of a rotation that failed and is pending retry; see #rollTo. */
    this.retryStamp = undefined
    /** Serialization chain; always a settled promise. */
    this.#chain = Promise.resolve()
    this.#link = linkImpl
  }

  #chain
  #link
  /** Failure-streak state for warn dedupe (see #fail). */
  #failing = false
  #lastReportAt = 0
  #suppressed = 0

  /**
   * Startup pass: tighten the live file's mode (appendFile's 0600 only
   * applies at creation — a file that predates this plugin version or was
   * restored from a backup with looser permissions is corrected here) and
   * prune expired archives even if no auth event arrives. Never rejects;
   * failures go to onError.
   */
  open() {
    return this.#enqueue(async () => {
      try {
        const live = join(this.dir, AUDIT_LOG_NAME)
        const { mode } = await stat(live)
        if ((mode & 0o777) !== 0o600) await chmod(live, 0o600)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err // no live file yet — nothing to tighten
      }
      await this.#prune()
    })
  }

  /**
   * Append one audit event as a single JSON line. Fire-and-forget safe: the
   * returned promise never rejects — every failure lands in onError.
   * @param {{ kind: string, ip?: string, reason?: string, [key: string]: unknown }} event
   *   `ts` is prepended and the known fields keep their order; further own
   *   fields (e.g. a brute-force payload's limit/lockedUntil) are preserved
   *   after them, undefined-valued fields are omitted.
   */
  append(event) {
    return this.#enqueue(() => this.#append(event))
  }

  /**
   * Resolve when every write enqueued so far has settled (success or
   * reported failure). Await this on graceful shutdown so pending audit
   * lines reach the disk; a crash (before fsync) can still lose data in
   * the page cache — this only covers the settle-once-started guarantee.
   */
  flush() {
    return this.#chain
  }

  async #enqueue(fn) {
    const run = this.#chain.then(fn)
    // Keep the chain settled no matter how a task ends.
    this.#chain = run.then(() => {}, () => {})
    try {
      await run
    } catch (err) {
      this.#fail(err)
    }
  }

  async #append(event) {
    const ts = this.now()
    const day = dayString(ts)
    let rotationOk = true
    if (day !== this.currentDay) rotationOk = await this.#rollTo(day)
    const { kind, ip, reason, ...extra } = event
    const record = { ts: new Date(ts).toISOString(), kind }
    if (ip !== undefined) record.ip = ip
    if (reason !== undefined) record.reason = reason
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) record[key] = value
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await appendFile(join(this.dir, AUDIT_LOG_NAME), `${JSON.stringify(record)}\n`, { mode: 0o600 })
    // A failed rotation keeps the failure streak alive even though this line
    // landed: reporting "recovered" here would reset the dedupe and turn the
    // next rotation failure into a fresh per-event report.
    if (rotationOk) this.#markHealthy()
  }

  /**
   * Archive the live file under the day its content belongs to, then prune.
   * A first write after a restart finds `currentDay === undefined` and stamps
   * the stale file from its mtime; a retry after a failed rotation prefers
   * the stamp remembered from the failed attempt.
   *
   * Housekeeping failures (mkdir, link, unlink, prune) are caught and routed
   * to onError so the append that triggered the rotation is never lost — the
   * event lands in whatever live file exists. A failed rotation leaves
   * currentDay unset (and returns false) so the next append retries it.
   * @returns {Promise<boolean>} whether the rotation leg succeeded.
   */
  async #rollTo(day) {
    const live = join(this.dir, AUDIT_LOG_NAME)
    let stamp = this.retryStamp ?? this.currentDay
    if (stamp === undefined) {
      try {
        stamp = dayString((await stat(live)).mtimeMs)
      } catch {
        stamp = undefined // no live file (fresh install) — nothing to rotate
      }
    }
    // A same-day restart finds the live file already stamped with today's
    // date: adopt it instead of rotating, or the day's trail would be split
    // across the live file and a same-named archive (forcing a `-2` suffix
    // at the next midnight).
    if (stamp !== undefined && stamp !== day) {
      this.retryStamp = stamp
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o700 })
        // No-clobber archive: link() fails with EEXIST instead of silently
        // overwriting a concurrently created file (multi-process $DSH_HOME).
        let dest = join(this.dir, `${AUDIT_LOG_NAME}.${stamp}`)
        for (let n = 2; ; n++) {
          try {
            await this.#link(live, dest)
            break
          } catch (err) {
            if (err.code !== 'EEXIST' || n > MAX_SUFFIX_BUMP) throw err
            dest = join(this.dir, `${AUDIT_LOG_NAME}.${stamp}-${n}`)
          }
        }
        try {
          await unlink(live)
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
        }
      } catch (err) {
        // Rotation failed — keep currentDay unset: the next append retries
        // the archive from the remembered stamp. The triggering event still
        // lands in the live file.
        this.#fail(err)
        return false
      }
    }
    this.currentDay = day
    this.retryStamp = undefined
    try {
      await this.#prune()
    } catch (err) {
      // Prune failed — old archives accumulate, but the append proceeds.
      this.#fail(err)
    }
    return true
  }

  /** Delete `audit.log.<date>` archives older than the retention window. */
  async #prune() {
    let names
    try {
      names = await readdir(this.dir)
    } catch (err) {
      if (err.code === 'ENOENT') return // no dir yet — nothing to prune
      throw err
    }
    const cutoff = this.now() - this.maxAgeDays * DAY_MS
    for (const name of names) {
      const m = /^audit\.log\.(\d{4}-\d{2}-\d{2})(?:-\d+)?$/.exec(name)
      if (m === null) continue // never touch files we did not create
      const dayTs = Date.parse(`${m[1]}T00:00:00`) // local midnight, like dayString
      if (Number.isNaN(dayTs)) continue
      if (dayTs < cutoff) {
        try {
          await unlink(join(this.dir, name))
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
        }
      }
    }
  }

  /**
   * Report a failure with dedupe: the first failure of a streak reports
   * immediately; sustained failures remind at most once per
   * FAILURE_REPORT_INTERVAL_MS, with the count of silenced repeats attached
   * to the error as `suppressed`. Keeps a broken sink from flooding dsh's
   * ring-buffer log (and evicting useful records) one warn per event.
   */
  #fail(err) {
    const now = this.now()
    const error = err instanceof Error ? err : new Error(String(err))
    if (!this.#failing) {
      this.#failing = true
      this.#lastReportAt = now
      this.#suppressed = 0
    } else if (now - this.#lastReportAt < FAILURE_REPORT_INTERVAL_MS) {
      this.#suppressed += 1
      return
    } else {
      error.suppressed = this.#suppressed
      this.#lastReportAt = now
      this.#suppressed = 0
    }
    try {
      this.onError(error)
    } catch {
      // An onError that throws must not break the auth flow either.
    }
  }

  /** A successful append ends the failure streak; report recovery once. */
  #markHealthy() {
    if (!this.#failing) return
    this.#failing = false
    this.#suppressed = 0
    try {
      this.onRecover()
    } catch {
      // A throwing onRecover must not break the auth flow either.
    }
  }
}
