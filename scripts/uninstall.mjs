#!/usr/bin/env node
/**
 * Complete-uninstall data cleanup for dsh-auth-gateway.
 *
 * `dsh plugin --profile web remove` only removes the composition row and
 * bundle layer — it never runs plugin code, so the password record stays on
 * disk. Run this script to delete the plugin's data directory
 * ($DSH_HOME/auth-gateway, plus the legacy auth-gate/ and login-plugin/
 * from pre-rename deployments). Stop dsh web first; a running gateway keeps
 * serving from memory until it exits.
 *
 * The canonical directory is removed unconditionally; a legacy directory is
 * removed only once it is proven to be ours (it holds at least one record
 * this plugin creates). `login-plugin/` in particular is a generic name, and
 * a recursive delete must never reach a tree we cannot identify.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const PRIMARY_DIR = join(home, 'auth-gateway')
const LEGACY_DIRS = [join(home, 'auth-gate'), join(home, 'login-plugin')]

/** Records this plugin writes; used to prove a legacy dir is ours. */
const OWNED_FILES = ['password.json', 'otp.json', 'otp-master.key', 'audit.log']
/** 0.5.1+ audit layout — the `log/` subdirectory. A tree holding none of
 *  these is left in place (fail-safe: never delete what we cannot identify). */
const hasOwnedContent = (dir) => {
  if (OWNED_FILES.some((name) => existsSync(join(dir, name)))) return true
  const log = join(dir, 'log')
  if (!existsSync(log)) return false
  return readdirSync(log, { withFileTypes: true }).some((entry) =>
    entry.isFile() && /^audit\.log(?:\.\d{4}-\d{2}-\d{2}(?:-\d+)?)?$/.test(entry.name))
}

const LINE = '═'.repeat(56)

console.log(LINE)
console.log('  dsh-auth-gateway uninstall · 清理全部凭据')
console.log('  dsh-auth-gateway uninstall · remove all credentials')
console.log(LINE)

try {
  const removed = [PRIMARY_DIR]
  const skipped = []
  rmSync(PRIMARY_DIR, { recursive: true, force: true })
  for (const dir of LEGACY_DIRS) {
    if (!existsSync(dir)) continue
    // Only delete a legacy tree we can positively identify as ours — a
    // recursive rm on an unverified `login-plugin/` could consume another
    // tool's data.
    if (!hasOwnedContent(dir)) {
      skipped.push(dir)
      continue
    }
    rmSync(dir, { recursive: true, force: true })
    removed.push(dir)
  }
  console.log()
  console.log('✓ 已删除全部凭据（密码 + OTP）')
  console.log('  All credentials removed (password + OTP)')
  for (const dir of removed) console.log(`  → ${dir}`)
  if (skipped.length > 0) {
    console.log()
    console.log('ℹ 以下旧目录未发现本插件记录，已保留（避免误删他人数据）')
    console.log('  Kept: no dsh-auth-gateway records found, so these were not removed')
    for (const dir of skipped) console.log(`  → ${dir}`)
    console.log('    如确认属于本插件，请手动检查后删除 / inspect and remove manually if it is ours')
  }
  console.log()
  console.log('▸ 提示 / Note')
  console.log('  · 请先停止 dsh web：运行中的网关会继续从内存提供登录服务，')
  console.log('    直到进程退出。')
  console.log('    Stop dsh web first; a running gateway keeps serving')
  console.log('    from memory until it exits.')
  console.log('  · 插件本体未删除，如需移除插件请执行：')
  console.log('    The plugin itself is not removed. To remove it:')
  console.log('    dsh plugin --profile web remove dsh-auth-gateway')
} catch (err) {
  console.error()
  console.error('✗ 删除失败 / Failed to remove')
  console.error(`  ${err.message}`)
  process.exit(1)
}
