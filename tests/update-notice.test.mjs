/**
 * About-card state derivation tests (client/src/update-notice.js).
 *
 * This is where the panel's version/update behaviour is pinned, because the
 * mapping used to live inside the component and nothing could test it — the
 * repo ships no client render runtime (React comes from dsh at runtime). The
 * regression these cover is real: a failed manual check used to erase the
 * displayed version and repository while showing no notice at all.
 *
 * The translator is a stub that reports which key was chosen, so the tests
 * assert the *message* a state maps to, not just its shape.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  afterCheckAttempt,
  failedUpdate,
  readVersion,
  updateNotice,
} from '../client/src/update-notice.js'

/** Records the i18n key (and vars) a notice asks for. */
function fakeT() {
  const calls = []
  const t = (key, vars) => {
    calls.push({ key, vars })
    return vars === undefined ? key : `${key}:${vars.version}`
  }
  t.calls = calls
  return t
}

const REPO = 'https://github.com/xbzbing/dsh-auth-gateway'
const ok = (update, extra = {}) => ({ ok: true, version: '0.6.0', repository: REPO, update, ...extra })

test('readVersion normalizes identity and refuses a non-http repository', () => {
  assert.deepEqual(readVersion(ok({})), { version: '0.6.0', repository: REPO, update: {} })
  assert.deepEqual(readVersion(null), { version: '', repository: '', update: {} })
  assert.deepEqual(readVersion({ version: 42, repository: 'javascript:alert(1)' }),
    { version: '', repository: '', update: {} })
})

test('afterCheckAttempt adopts a successful result', () => {
  const next = afterCheckAttempt(readVersion(null), {
    data: ok({ latest: '0.7.0', updateAvailable: true, checkedAt: 'T', error: null }),
  })
  assert.equal(next.version, '0.6.0')
  assert.equal(next.repository, REPO)
  assert.equal(next.update.updateAvailable, true)
})

test('REGRESSION: a failed attempt keeps the version and repository', () => {
  // The card already knows its identity; a failed check must not erase it.
  const previous = readVersion(ok({ latest: null, updateAvailable: null, checkedAt: null, error: null }))

  for (const outcome of [{ error: 'unauthenticated' }, { error: 'network' }, { data: { ok: false, error: 'unauthenticated' } }]) {
    const next = afterCheckAttempt(previous, outcome)
    assert.equal(next.version, '0.6.0', `identity lost for ${JSON.stringify(outcome)}`)
    assert.equal(next.repository, REPO, `repository lost for ${JSON.stringify(outcome)}`)
    // A missing reason still records a failure rather than nothing.
    assert.equal(next.update.error, outcome.error ?? 'unauthenticated')
  }
  // A transport failure with no reason at all still records a failure.
  assert.equal(afterCheckAttempt(previous, {}).update.error, 'unauthenticated')
})

test('afterCheckAttempt works when nothing was known yet', () => {
  const next = afterCheckAttempt(null, { error: 'network' })
  assert.equal(next.version, '')
  assert.equal(next.update.error, 'network')
})

test('failedUpdate is the shape both failure paths share', () => {
  assert.deepEqual(failedUpdate('network'),
    { latest: null, updateAvailable: null, checkedAt: null, error: 'network' })
})

test('REGRESSION: a failed check produces a visible notice', () => {
  // This is what the component could not do before: the failure line was
  // conditioned on `checkedAt`, which a failed attempt leaves null.
  const t = fakeT()
  for (const error of ['network', 'timeout', 'http-503', 'invalid-response', 'unauthenticated']) {
    const notice = updateNotice(failedUpdate(error), t, REPO)
    assert.ok(notice !== null, `a failed check (${error}) must say something`)
    assert.equal(notice.tone, 'muted')
    assert.equal(notice.text, 'about.checkFailed')
  }
  assert.deepEqual(t.calls.map((c) => c.key), ['about.checkFailed', 'about.checkFailed', 'about.checkFailed', 'about.checkFailed', 'about.checkFailed'])
})

test('never checked claims nothing at all', () => {
  const t = fakeT()
  assert.equal(updateNotice({ latest: null, updateAvailable: null, checkedAt: null, error: null }, t, REPO), null)
  assert.equal(updateNotice(undefined, t, REPO), null)
  assert.equal(updateNotice({}, t, REPO), null)
  assert.equal(t.calls.length, 0, 'no message may be borrowed for the unknown state')
})

test('an update offers the release link; the link is omitted without a repository', () => {
  const t = fakeT()
  const notice = updateNotice({ latest: '0.7.0', updateAvailable: true, checkedAt: 'T', error: null }, t, REPO)
  assert.equal(notice.tone, 'banner')
  assert.equal(notice.text, 'about.updateAvailable:0.7.0')
  assert.equal(notice.href, REPO + '/releases')

  const noRepo = updateNotice({ latest: '0.7.0', updateAvailable: true, checkedAt: 'T', error: null }, fakeT(), '')
  assert.equal(noRepo.href, '', 'no repository means no link, not a broken one')
})

test('up to date is stated once and never as an error', () => {
  const notice = updateNotice({ latest: '0.6.0', updateAvailable: false, checkedAt: 'T', error: null }, fakeT(), REPO)
  assert.equal(notice.tone, 'muted')
  assert.equal(notice.text, 'about.upToDate')
})

test('a verdict outranks a stale error field', () => {
  // Defensive: if a future payload carried both, the verdict is the news.
  const notice = updateNotice({ latest: '0.7.0', updateAvailable: true, checkedAt: 'T', error: 'network' }, fakeT(), REPO)
  assert.equal(notice.text, 'about.updateAvailable:0.7.0')
})

test('an empty error string is not a failure', () => {
  assert.equal(updateNotice({ updateAvailable: null, error: '' }, fakeT(), REPO), null)
})
