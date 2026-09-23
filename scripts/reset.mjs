#!/usr/bin/env node
/**
 * Forgotten-password reset for dsh-auth-gateway.
 *
 * Deletes only the password record. Restart dsh web afterwards so the plugin
 * generates and prints a fresh initial password.
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const dir = join(home, 'auth-gateway')
const passwordFile = join(dir, 'password.json')
const LINE = '═'.repeat(56)

console.log(LINE)
console.log('  dsh-auth-gateway reset · 重置登录密码')
console.log('  dsh-auth-gateway reset · reset login password')
console.log(LINE)

if (!existsSync(passwordFile)) {
  console.log()
  console.log('ℹ 未找到密码记录 / No password record found')
  console.log(`  → ${passwordFile}`)
  process.exit(0)
}

try {
  rmSync(passwordFile, { force: true })
  console.log()
  console.log('✓ 密码记录已删除')
  console.log('  Password record removed')
  console.log(`  → ${passwordFile}`)
  console.log()
  console.log('▸ 下一步 / Next steps')
  console.log('  1. 重启 dsh web —— 新的初始密码将生成并打印到控制台')
  console.log('     Restart dsh web; a new initial password will be')
  console.log('     generated and printed to the console')
  console.log('  2. 用新密码登录，并完成引导流程设置个人密码')
  console.log('     Log in with it and complete onboarding.')
  console.log()
  console.log('ℹ 认证器也丢失了？/ Authenticator lost too?')
  console.log('  需同时删除 OTP 记录与主密钥：')
  console.log('  Delete otp.json AND otp-master.key together:')
  console.log(`  → ${join(dir, 'otp.json')}`)
  console.log(`  → ${join(dir, 'otp-master.key')}`)
} catch (err) {
  console.error()
  console.error('✗ 删除失败 / Failed to remove')
  console.error(`  → ${passwordFile}`)
  console.error(`  ${err.message}`)
  process.exit(1)
}
