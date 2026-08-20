#!/usr/bin/env node
/**
 * Forgotten-password reset for dsh-auth-gateway.
 *
 * Deletes only the password record ($DSH_HOME/auth-gate/password.json).
 * dsh-auth-gateway has no setup page: the initial credential is minted at boot,
 * so RESTART dsh web after running this — the plugin generates a fresh
 * auto initial password, prints it to the console, and you log in with it
 * and complete onboarding (set a personal password).
 *
 * The OTP binding is a separate file ($DSH_HOME/auth-gate/otp.json); delete
 * it AND its master key ($DSH_HOME/auth-gate/otp-master.key) together when the
 * authenticator is lost (or run dsh-auth-gateway-uninstall to clear the whole
 * directory). Delete both at once: dropping only the key leaves otp.json behind,
 * and on next start getMasterKey() silently generates a fresh key that fails to
 * decrypt the old otp.json. Unlike `dsh-auth-gateway-uninstall` this script does
 * NOT remove the plugin or its directory — the composition stays installed.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const dir = join(home, 'auth-gate')
const file = join(dir, 'password.json')

const LINE = '═'.repeat(56)

console.log(LINE)
console.log('  dsh-auth-gateway reset · 重置登录密码')
console.log('  dsh-auth-gateway reset · reset login password')
console.log(LINE)

try {
  rmSync(file, { force: true })
  console.log()
  console.log('✓ 密码记录已删除')
  console.log('  Password record removed')
  console.log(`  → ${file}`)
  console.log()
  console.log('▸ 下一步 / Next steps')
  console.log('  1. 重启 dsh web —— 新的初始密码将生成并打印到控制台')
  console.log('     Restart dsh web; a new initial password will be')
  console.log('     generated and printed to the console')
  console.log('  2. 用新密码登录，并完成引导流程设置个人密码')
  console.log('     Log in with it and complete onboarding.')
  console.log()
  console.log('ℹ 认证器也丢失了？/ Authenticator lost too?')
  console.log('  需同时删除 OTP 记录与主密钥（只删其一会导致重启后')
  console.log('  新生成的主密钥无法解密旧的 otp.json）：')
  console.log('  Delete otp.json AND otp-master.key together — dropping')
  console.log('  only the key leaves otp.json behind, and the fresh key')
  console.log('  minted at next start fails to decrypt it.')
  console.log(`  → ${join(dir, 'otp.json')}`)
  console.log(`  → ${join(dir, 'otp-master.key')}`)
} catch (err) {
  console.error()
  console.error('✗ 删除失败 / Failed to remove')
  console.error(`  → ${file}`)
  console.error(`  ${err.message}`)
  process.exit(1)
}