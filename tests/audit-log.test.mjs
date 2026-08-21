/**
 * Audit log sink tests: JSONL appends, daily rotation stamped by the
 * content's day, stale-file adoption after a restart, retention pruning,
 * archive-name collision suffixes, structured security-event fields, and
 * failure isolation (a broken sink never rejects the auth flow).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, rmSync, writeFileSync, utimesSync, mkdirSync, rmdirSync,
  readFileSync, readdirSync, existsSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { link as fsLink } from 'node:fs/promises'
import { AuditLogWriter, AUDIT_LOG_NAME, dayString } from '../lib/audit-log.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-audit-'))
}

// Rotation works on LOCAL calendar days, so build instants from components
// instead of UTC ISO strings.
const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime()

async function withWriter(dir, options, run) {
  const writer = new AuditLogWriter({ dir, ...options })
  await run(writer)
}

test('appends one JSONL line per event with ts/kind/ip and optional reason', async () => {
  const dir = tempDir()
  try {
    let now = at(2025, 8, 20, 10, 0, 0)
    await withWriter(dir, { now: () => now }, async (w) => {
      await w.append({ kind: 'login-success', ip: '192.168.1.10' })
      now = at(2025, 8, 20, 10, 5, 30)
      await w.append({ kind: 'login-failed', ip: '192.168.1.10', reason: 'invalid-credentials' })
    })

    const lines = readFileSync(join(dir, AUDIT_LOG_NAME), 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)
    const first = JSON.parse(lines[0])
    assert.deepEqual(first, {
      ts: new Date(at(2025, 8, 20, 10, 0, 0)).toISOString(),
      kind: 'login-success',
      ip: '192.168.1.10',
    })
    assert.ok(!('reason' in first), 'reason is omitted when absent')
    const second = JSON.parse(lines[1])
    assert.equal(second.kind, 'login-failed')
    assert.equal(second.reason, 'invalid-credentials')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rolls audit.log over when the local day changes, stamping the content day', async () => {
  const dir = tempDir()
  try {
    let now = at(2025, 8, 20, 23, 59, 59)
    await withWriter(dir, { now: () => now }, async (w) => {
      await w.append({ kind: 'login-success', ip: '10.0.0.1' })
      now = at(2025, 8, 21, 0, 0, 1)
      await w.append({ kind: 'logout', ip: '10.0.0.1' })
    })

    const live = readFileSync(join(dir, AUDIT_LOG_NAME), 'utf8').trim().split('\n')
    assert.equal(live.length, 1, 'the live file only holds today’s events')
    assert.equal(JSON.parse(live[0]).kind, 'logout')

    const archived = readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`), 'utf8').trim().split('\n')
    assert.equal(archived.length, 1)
    assert.equal(JSON.parse(archived[0]).kind, 'login-success')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('adopts a stale audit.log left by a previous run, stamping from its mtime', async () => {
  const dir = tempDir()
  try {
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"old":true}\n')
    const staleDay = at(2025, 8, 18, 9)
    utimesSync(live, new Date(staleDay), new Date(staleDay))

    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => {
      await w.append({ kind: 'login-success', ip: '10.0.0.2' })
    })

    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-18`)),
      'the stale file is archived under the day it was last written')
    assert.equal(readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-18`), 'utf8'), '{"old":true}\n')
    const lines = readFileSync(join(dir, AUDIT_LOG_NAME), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a same-day restart adopts the live file instead of splitting the day', async () => {
  const dir = tempDir()
  try {
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"ts":"earlier-today","kind":"login-success","ip":"10.0.0.7"}\n')
    const thisMorning = at(2025, 8, 21, 9)
    utimesSync(live, new Date(thisMorning), new Date(thisMorning))

    await withWriter(dir, { now: () => at(2025, 8, 21, 17) }, async (w) => {
      await w.append({ kind: 'logout', ip: '10.0.0.7' })
    })

    const files = readdirSync(dir)
    assert.deepEqual(files, [AUDIT_LOG_NAME],
      'no archive is created — the day stays in one file')
    const lines = readFileSync(live, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2, 'the new event appends to the adopted file')
    assert.equal(JSON.parse(lines[1]).kind, 'logout')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prunes rotated archives older than the retention window — and only those', async () => {
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    const now = at(2025, 8, 21, 8)
    const expired = `${AUDIT_LOG_NAME}.${dayString(now - 90 * 24 * 60 * 60 * 1000)}`
    const recent = `${AUDIT_LOG_NAME}.${dayString(now - 89 * 24 * 60 * 60 * 1000)}`
    writeFileSync(join(dir, `${AUDIT_LOG_NAME}.2024-01-01`), 'x\n') // far too old
    writeFileSync(join(dir, expired), 'x\n') // exactly the cutoff day -> gone ("at most" 90 days)
    writeFileSync(join(dir, recent), 'x\n') // inside the window
    writeFileSync(join(dir, `${AUDIT_LOG_NAME}.not-a-date`), 'x\n') // unmatched pattern
    writeFileSync(join(dir, 'unrelated.txt'), 'x\n') // not ours

    await withWriter(dir, { now: () => now }, async (w) => w.open())

    assert.ok(!existsSync(join(dir, `${AUDIT_LOG_NAME}.2024-01-01`)))
    assert.ok(!existsSync(join(dir, expired)))
    assert.ok(existsSync(join(dir, recent)))
    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.not-a-date`)))
    assert.ok(existsSync(join(dir, 'unrelated.txt')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suffixes colliding archive names instead of overwriting them', async () => {
  const dir = tempDir()
  try {
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"stale":true}\n')
    const staleDay = at(2025, 8, 19, 22)
    utimesSync(live, new Date(staleDay), new Date(staleDay))
    writeFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-19`), 'a\n')
    writeFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-19-2`), 'b\n')

    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => {
      await w.append({ kind: 'logout', ip: '10.0.0.3' })
    })

    assert.equal(readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-19`), 'utf8'), 'a\n')
    assert.equal(readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-19-2`), 'utf8'), 'b\n')
    assert.equal(readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-19-3`), 'utf8'), '{"stale":true}\n',
      'the colliding rotation lands on the next free suffix')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('security events keep their structured fields; absent fields are omitted', async () => {
  const dir = tempDir()
  try {
    const lockedUntil = at(2025, 8, 21, 8, 5)
    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => {
      await w.append({ kind: 'lockout', ip: '10.0.0.5', maxFailures: 5, lockedUntil })
      // global-rate-limit has no sourceAddress — the line must not carry an ip.
      await w.append({ kind: 'global-rate-limit', limit: 60, windowSeconds: 60 })
    })

    const lines = readFileSync(join(dir, AUDIT_LOG_NAME), 'utf8').trim().split('\n')
    const lockout = JSON.parse(lines[0])
    assert.equal(lockout.maxFailures, 5)
    assert.equal(lockout.lockedUntil, lockedUntil)
    const global = JSON.parse(lines[1])
    assert.ok(!('ip' in global), 'no ip key for a process-wide event')
    assert.equal(global.limit, 60)
    assert.equal(global.windowSeconds, 60)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write failures go to onError and never reject or wedge the chain', async () => {
  const dir = tempDir()
  try {
    // A regular file where a directory is expected makes every fs op fail.
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, '')
    const errors = []
    let now = at(2025, 8, 21, 8)
    await withWriter(dir, {
      dir: blocker,
      now: () => now,
      onError: (err) => errors.push(err),
    }, async (w) => {
      await w.append({ kind: 'login-success', ip: '10.0.0.4' }) // must resolve
      now += 10 * 60 * 1000 // past the repeat interval → reported again
      await w.append({ kind: 'logout', ip: '10.0.0.4' }) // chain stays usable
    })
    assert.ok(errors.length >= 2, 'failures report (deduped) without rejecting')
    assert.ok(errors.every((e) => e instanceof Error))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the live file is created 0600 inside a 0700 directory', async () => {
  const dir = tempDir()
  try {
    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => {
      await w.append({ kind: 'login-success', ip: '10.0.0.6' })
    })
    assert.equal(statSync(join(dir, AUDIT_LOG_NAME)).mode & 0o777, 0o600)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flush() drains every enqueued write before it resolves', async () => {
  const dir = tempDir()
  try {
    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => {
      // Fire-and-forget like the auth flow does — nothing awaited here.
      for (let n = 0; n < 5; n++) {
        w.append({ kind: 'login-failed', ip: '10.0.0.8', reason: 'invalid-credentials' })
      }
      await w.flush()
    })
    const lines = readFileSync(join(dir, AUDIT_LOG_NAME), 'utf8').trim().split('\n')
    assert.equal(lines.length, 5, 'graceful shutdown loses no buffered line')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('open() tightens a loose live-file mode back to 0600', async () => {
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, 'restored-from-backup\n', { mode: 0o644 })
    assert.equal(statSync(live).mode & 0o777, 0o644)

    await withWriter(dir, { now: () => at(2025, 8, 21, 8) }, async (w) => w.open())

    assert.equal(statSync(live).mode & 0o777, 0o600,
      'a file that predates the plugin or came from a backup is corrected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prune failure during rotation is caught — the event is never lost', async () => {
  const dir = tempDir()
  try {
    // Pre-create a live file from day 1.
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"ts":"yesterday","kind":"login-success","ip":"1.2.3.4"}\n')
    utimesSync(live, new Date(at(2025, 8, 20, 9)), new Date(at(2025, 8, 20, 9)))

    // Pre-create an audit.log.<date> as a DIRECTORY with a date OLD enough
    // that prune will try to unlink it — unlink on a directory gives EISDIR
    // (not ENOENT), so prune throws.
    mkdirSync(join(dir, `${AUDIT_LOG_NAME}.2024-01-01`), { recursive: true })

    const errors = []
    await withWriter(dir, {
      now: () => at(2025, 8, 21, 8),
      onError: (err) => errors.push(err),
    }, async (w) => {
      await w.append({ kind: 'logout', ip: '1.2.3.4' })
    })

    // The event must have landed — prune failure must not abort the append.
    const lines = readFileSync(live, 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]).kind, 'logout')
    // The prune failure was reported to onError.
    assert.ok(errors.length >= 1, 'prune failure reaches onError')
    assert.equal(errors[0].code, 'EISDIR')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed rotation retries on the next append instead of pinning currentDay', async () => {
  const dir = tempDir()
  try {
    // Day-1 live file; injected link fails with EPERM until released.
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"ts":"yesterday","kind":"login-success","ip":"10.0.0.7"}\n')
    utimesSync(live, new Date(at(2025, 8, 20, 9)), new Date(at(2025, 8, 20, 9)))

    let failLinks = 2
    const link = (from, to) => {
      if (failLinks > 0) {
        failLinks -= 1
        return Promise.resolve().then(() => {
          throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
        })
      }
      return fsLink(from, to)
    }

    const errors = []
    let now = at(2025, 8, 21, 8)
    const w = new AuditLogWriter({ dir, now: () => now, onError: (err) => errors.push(err), link })

    // Rotation fails: the event still lands in the (un-rotated) live file.
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    assert.equal(errors.length, 1)
    assert.equal(errors[0].code, 'EPERM')
    assert.equal(JSON.parse(readFileSync(live, 'utf8').trim().split('\n').at(-1)).kind, 'logout')
    assert.ok(!existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`)), 'nothing archived yet')

    // Next append while still failing: retries the archive, never overwrites.
    // Pin the live mtime inside the fake timeline after each failed-window
    // append so the retry stamp stays deterministic.
    now = at(2025, 8, 21, 9)
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    utimesSync(live, new Date(now), new Date(now))
    assert.equal(errors.length, 2)

    // Recover: the pending content archives under the remembered stamp —
    // the day most of it belongs to — not the recovery-time day.
    now = at(2025, 8, 22, 8)
    await w.append({ kind: 'login-success', ip: '10.0.0.7' })
    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`)),
      'the retry archives under the remembered content day')
    const archived = readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l).kind)
    assert.deepEqual(archived, ['login-success', 'logout', 'logout'],
      'both failed-window events ride along in the archive')

    // The following day rotates normally again.
    now = at(2025, 8, 23, 8)
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-22`)),
      'the next midnight rollover works after recovery')
    const liveLines = readFileSync(live, 'utf8').trim().split('\n')
    assert.equal(liveLines.length, 1)
    assert.equal(JSON.parse(liveLines[0]).kind, 'logout')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed rotation spanning multiple days archives under the original content day', async () => {
  const dir = tempDir()
  try {
    // Day-1 live file; injected link fails 3 times then delegates to fsLink.
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"ts":"day1","kind":"login-success","ip":"10.0.0.7"}\n')
    utimesSync(live, new Date(at(2025, 8, 20, 9)), new Date(at(2025, 8, 20, 9)))

    let failLinks = 3
    const link = (from, to) => {
      if (failLinks > 0) {
        failLinks -= 1
        return Promise.resolve().then(() => {
          throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
        })
      }
      return fsLink(from, to)
    }

    const errors = []
    let now = at(2025, 8, 21, 8)
    const w = new AuditLogWriter({ dir, now: () => now, onError: (err) => errors.push(err), link })

    // Day 2 — two failed rotations.
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    assert.equal(errors.length, 1)
    now = at(2025, 8, 21, 9)
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    utimesSync(live, new Date(now), new Date(now))
    assert.equal(errors.length, 2)

    // Day 3 — still failing.
    now = at(2025, 8, 22, 8)
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    assert.equal(errors.length, 3)
    utimesSync(live, new Date(now), new Date(now))

    // Day 4 — rotation finally succeeds: everything archives under the
    // ORIGINAL content day (8/20), not the recovery day (8/23).
    now = at(2025, 8, 23, 8)
    await w.append({ kind: 'login-success', ip: '10.0.0.7' })
    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`)),
      'the retry archives under the remembered content day, not the recovery day')
    const archived = readFileSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-20`), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l).kind)
    assert.deepEqual(archived,
      ['login-success', 'logout', 'logout', 'logout'],
      'all failure-window events ride along in the archive')

    // The following day rotates normally again.
    now = at(2025, 8, 24, 8)
    await w.append({ kind: 'logout', ip: '10.0.0.7' })
    assert.ok(existsSync(join(dir, `${AUDIT_LOG_NAME}.2025-08-23`)),
      'the next midnight rollover works after recovery')
    const liveLines = readFileSync(live, 'utf8').trim().split('\n')
    assert.equal(liveLines.length, 1)
    assert.equal(JSON.parse(liveLines[0]).kind, 'logout')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rotation failures stay deduped across successful appends; recovery fires once rotation succeeds', async () => {
  const dir = tempDir()
  try {
    const live = join(dir, AUDIT_LOG_NAME)
    writeFileSync(live, '{"ts":"yesterday","kind":"login-success","ip":"10.0.0.10"}\n')
    utimesSync(live, new Date(at(2025, 8, 20, 9)), new Date(at(2025, 8, 20, 9)))

    let failLinks = true
    const link = () => {
      if (failLinks) return Promise.resolve().then(() => {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      })
      return fsLink(live, join(dir, `${AUDIT_LOG_NAME}.2025-08-20`))
    }

    const errors = []
    const recovered = []
    let now = at(2025, 8, 21, 8)
    const w = new AuditLogWriter({
      dir, now: () => now,
      onError: (err) => errors.push(err),
      onRecover: () => recovered.push(true),
      link,
    })

    // Successful appends interleaved with a persistently failing rotation:
    // the first failure reports once, the rest are silenced by the dedupe —
    // a landed line must not reset the streak ("recovered" would be a lie).
    for (let n = 0; n < 5; n++) {
      now = at(2025, 8, 21, 8, n)
      await w.append({ kind: 'logout', ip: '10.0.0.10' })
    }
    assert.equal(errors.length, 1, 'one warn for the whole failure streak')
    assert.equal(recovered.length, 0, 'no recovery while rotation is still failing')

    // Heal the rotation: the next append reports recovery exactly once.
    failLinks = false
    now = at(2025, 8, 21, 14)
    await w.append({ kind: 'login-success', ip: '10.0.0.10' })
    assert.equal(recovered.length, 1, 'recovery fires once when rotation succeeds')
    assert.equal(errors.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sustained sink failures report once per interval; recovery reports once', async () => {
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    // audit.log as a DIRECTORY: mkdir succeeds but appendFile fails (EISDIR).
    // Its mtime is pinned to the fake today so rotation adopts instead of
    // renaming it away.
    const live = join(dir, AUDIT_LOG_NAME)
    mkdirSync(live)
    utimesSync(live, new Date(at(2025, 8, 21, 7)), new Date(at(2025, 8, 21, 7)))

    const errors = []
    const recovered = []
    let now = at(2025, 8, 21, 8)
    const w = new AuditLogWriter({
      dir,
      now: () => now,
      onError: (err) => errors.push(err),
      onRecover: () => recovered.push(true),
    })

    await w.append({ kind: 'login-success', ip: '10.0.0.9' }) // first failure: reported
    for (let n = 0; n < 4; n++) {
      now += 60 * 1000 // +1 min each — stays inside the 5-minute interval
      await w.append({ kind: 'logout', ip: '10.0.0.9' })
    }
    assert.equal(errors.length, 1, 'repeats inside the interval are silenced')
    assert.ok(!('suppressed' in errors[0]), 'the first report carries no count')

    now += 6 * 60 * 1000 // past the interval
    await w.append({ kind: 'logout', ip: '10.0.0.9' })
    assert.equal(errors.length, 2, 'a sustained failure reminds once per interval')
    assert.equal(errors[1].suppressed, 4, 'the reminder carries the silenced count')

    rmdirSync(live) // heal the sink
    await w.append({ kind: 'logout', ip: '10.0.0.9' }) // succeeds → recovery
    await w.append({ kind: 'logout', ip: '10.0.0.9' }) // stays healthy
    assert.equal(recovered.length, 1, 'recovery reports exactly once')
    assert.equal(errors.length, 2, 'healthy writes report nothing')
    const lines = readFileSync(live, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2, 'the healed sink records both events')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
