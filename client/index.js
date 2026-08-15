/**
 * OTP Settings Panel - Client plugin for dsh web UI.
 *
 * Adds OTP settings to the dsh settings panel.
 */

export const name = 'dsh-password-gate/client'

export const inject = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-api-remotes',
]

export function apply(ctx) {
  // Register settings panel section
  ctx.slots.register('settings-panel', {
    id: 'otp-settings',
    title: 'OTP 双因素认证',
    icon: '🔐',
    order: 100,
    component: OTPSettingsPanel,
  })
}

/**
 * OTP Settings Panel component.
 * This will be rendered in the dsh settings panel.
 */
function OTPSettingsPanel({ ctx }) {
  return {
    render() {
      return `
        <div class="settings-section">
          <h3>OTP 双因素认证</h3>
          <p class="settings-description">
            启用 OTP 后，登录需要密码 + 验证码，提高安全性。
          </p>
          <div class="settings-content">
            <div class="settings-item">
              <label>
                <input type="checkbox" id="otp-enabled" />
                启用 OTP
              </label>
            </div>
            <div class="settings-item">
              <label>
                <input type="checkbox" id="otp-required" />
                强制所有用户启用
              </label>
            </div>
            <div class="settings-item">
              <label for="otp-issuer">发行者名称</label>
              <input type="text" id="otp-issuer" value="dsh-password-gate" />
            </div>
            <div class="settings-actions">
              <button id="otp-save" class="settings-btn">保存设置</button>
              <button id="otp-enable" class="settings-btn secondary">启用 OTP</button>
              <button id="otp-disable" class="settings-btn danger">禁用 OTP</button>
            </div>
            <div id="otp-status" class="settings-status"></div>
          </div>
        </div>
      `
    },
    mounted() {
      // Load current settings
      this.loadSettings()
      
      // Bind events
      document.getElementById('otp-save')?.addEventListener('click', () => this.saveSettings())
      document.getElementById('otp-enable')?.addEventListener('click', () => this.enableOTP())
      document.getElementById('otp-disable')?.addEventListener('click', () => this.disableOTP())
    },
    async loadSettings() {
      try {
        const res = await fetch('/api/settings')
        const data = await res.json()
        if (data.ok) {
          const config = data.config?.['dsh-password-gate'] || {}
          document.getElementById('otp-enabled').checked = config.otpEnabled || false
          document.getElementById('otp-required').checked = config.otpRequired || false
          document.getElementById('otp-issuer').value = config.otpIssuer || 'dsh-password-gate'
        }
      } catch (err) {
        this.showStatus('加载设置失败: ' + err.message, 'error')
      }
    },
    async saveSettings() {
      const config = {
        otpEnabled: document.getElementById('otp-enabled').checked,
        otpRequired: document.getElementById('otp-required').checked,
        otpIssuer: document.getElementById('otp-issuer').value,
      }
      
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ 'dsh-password-gate': config }),
        })
        const data = await res.json()
        if (data.ok) {
          this.showStatus('设置已保存', 'success')
        } else {
          this.showStatus('保存失败: ' + (data.error || '未知错误'), 'error')
        }
      } catch (err) {
        this.showStatus('保存失败: ' + err.message, 'error')
      }
    },
    async enableOTP() {
      try {
        const res = await fetch('/otp/enable', { method: 'POST' })
        const data = await res.json()
        if (data.ok) {
          this.showStatus('OTP 已启用', 'success')
          this.showBackupCodes(data.backupCodes)
        } else {
          this.showStatus('启用失败: ' + (data.error || '未知错误'), 'error')
        }
      } catch (err) {
        this.showStatus('启用失败: ' + err.message, 'error')
      }
    },
    async disableOTP() {
      if (!confirm('确定要禁用 OTP 吗？')) return
      
      try {
        const res = await fetch('/otp/disable', { method: 'POST' })
        const data = await res.json()
        if (data.ok) {
          this.showStatus('OTP 已禁用', 'success')
        } else {
          this.showStatus('禁用失败: ' + (data.error || '未知错误'), 'error')
        }
      } catch (err) {
        this.showStatus('禁用失败: ' + err.message, 'error')
      }
    },
    showStatus(message, type) {
      const status = document.getElementById('otp-status')
      if (status) {
        status.textContent = message
        status.className = `settings-status ${type}`
        setTimeout(() => { status.textContent = '' }, 3000)
      }
    },
    showBackupCodes(codes) {
      const status = document.getElementById('otp-status')
      if (status && codes) {
        status.innerHTML = `
          <div class="backup-codes">
            <strong>备份代码（请妥善保存）：</strong>
            <pre>${codes.join('\n')}</pre>
          </div>
        `
      }
    },
  }
}
