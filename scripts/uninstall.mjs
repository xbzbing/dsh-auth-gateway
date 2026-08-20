#!/usr/bin/env node
/**
 * Complete-uninstall data cleanup for dsh-auth-gateway.
 *
 * `dsh plugin --profile web remove` only removes the composition row and
 * bundle layer — it never runs plugin code, so the password record stays on
 * disk. Run this script to delete the plugin's data directory
 * ($DSH_HOME/auth-gate). Stop dsh web first; a running gateway keeps
 * serving from memory until it exits.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const dir = join(home, 'auth-gate')

const LINE = '═'.repeat(56)

console.log(LINE)
console.log('  dsh-auth-gateway uninstall · 清理全部凭据')
console.log('  dsh-auth-gateway uninstall · remove all credentials')
console.log(LINE)

try {
  rmSync(dir, { recursive: true, force: true })
  console.log()
  console.log('✓ 已删除全部凭据（密码 + OTP）')
  console.log('  All credentials removed (password + OTP)')
  console.log(`  → ${dir}`)
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
  console.error(`  → ${dir}`)
  console.error(`  ${err.message}`)
  process.exit(1)
}