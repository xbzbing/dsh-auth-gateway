window.__ModuleLoader__.load({
	id: "dsh-password-gate/client",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");

		/**
		 * OTP Settings Panel component.
		 * This will be rendered in the dsh settings panel.
		 */
		function OTPSettingsPanel({ ctx }) {
			const [config, setConfig] = react.useState({
				otpEnabled: false,
				otpRequired: false,
				otpIssuer: 'dsh-password-gate',
			});
			const [loading, setLoading] = react.useState(true);
			const [saving, setSaving] = react.useState(false);
			const [status, setStatus] = react.useState(null);
			const [backupCodes, setBackupCodes] = react.useState(null);

			// Load settings
			react.useEffect(() => {
				loadSettings();
			}, []);

			async function loadSettings() {
				try {
					const res = await fetch('/api/settings');
					const data = await res.json();
					if (data.ok) {
						const pluginConfig = data.config?.['dsh-password-gate'] || {};
						setConfig({
							otpEnabled: pluginConfig.otpEnabled || false,
							otpRequired: pluginConfig.otpRequired || false,
							otpIssuer: pluginConfig.otpIssuer || 'dsh-password-gate',
						});
					}
				} catch (err) {
					setStatus({ type: 'error', message: '加载设置失败: ' + err.message });
				} finally {
					setLoading(false);
				}
			}

			async function saveSettings() {
				setSaving(true);
				setStatus(null);
				try {
					const res = await fetch('/api/settings', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ 'dsh-password-gate': config }),
					});
					const data = await res.json();
					if (data.ok) {
						setStatus({ type: 'success', message: '设置已保存' });
					} else {
						setStatus({ type: 'error', message: '保存失败: ' + (data.error || '未知错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '保存失败: ' + err.message });
				} finally {
					setSaving(false);
				}
			}

			async function enableOTP() {
				setStatus(null);
				try {
					const res = await fetch('/otp/enable', { method: 'POST' });
					const data = await res.json();
					if (data.ok) {
						setStatus({ type: 'success', message: 'OTP 已启用' });
						setBackupCodes(data.backupCodes);
						setConfig(prev => ({ ...prev, otpEnabled: true }));
					} else {
						setStatus({ type: 'error', message: '启用失败: ' + (data.error || '未知错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '启用失败: ' + err.message });
				}
			}

			async function disableOTP() {
				if (!confirm('确定要禁用 OTP 吗？')) return;
				setStatus(null);
				try {
					const res = await fetch('/otp/disable', { method: 'POST' });
					const data = await res.json();
					if (data.ok) {
						setStatus({ type: 'success', message: 'OTP 已禁用' });
						setConfig(prev => ({ ...prev, otpEnabled: false }));
					} else {
						setStatus({ type: 'error', message: '禁用失败: ' + (data.error || '未知错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '禁用失败: ' + err.message });
				}
			}

			if (loading) {
				return (0, react_jsx_runtime.jsx)("div", { children: "加载中..." });
			}

			return (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: '16px 0' },
				children: [
					(0, react_jsx_runtime.jsx)("h3", {
						style: { margin: '0 0 12px 0', fontSize: '14px', fontWeight: '500' },
						children: "OTP 双因素认证"
					}),
					(0, react_jsx_runtime.jsx)("p", {
						style: { margin: '0 0 16px 0', fontSize: '12px', color: '#666' },
						children: "启用 OTP 后，登录需要密码 + 验证码，提高安全性。"
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: { display: 'flex', flexDirection: 'column', gap: '12px' },
						children: [
							(0, react_jsx_runtime.jsxs)("label", {
								style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
								children: [
									(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: config.otpEnabled,
										onChange: (e) => setConfig(prev => ({ ...prev, otpEnabled: e.target.checked })),
									}),
									"启用 OTP"
								]
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
								children: [
									(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: config.otpRequired,
										onChange: (e) => setConfig(prev => ({ ...prev, otpRequired: e.target.checked })),
									}),
									"强制所有用户启用"
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: { display: 'flex', flexDirection: 'column', gap: '4px' },
								children: [
									(0, react_jsx_runtime.jsx)("label", {
										style: { fontSize: '12px', fontWeight: '500' },
										children: "发行者名称"
									}),
									(0, react_jsx_runtime.jsx)("input", {
										type: "text",
										value: config.otpIssuer,
										onChange: (e) => setConfig(prev => ({ ...prev, otpIssuer: e.target.value })),
										style: {
											border: '1px solid #d9d9d9',
											borderRadius: '6px',
											padding: '6px 12px',
											fontSize: '13px',
											outline: 'none',
										},
									}),
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: { display: 'flex', gap: '8px', marginTop: '8px' },
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										onClick: saveSettings,
										disabled: saving,
										style: {
											background: '#1677ff',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '6px 16px',
											fontSize: '13px',
											cursor: saving ? 'not-allowed' : 'pointer',
											opacity: saving ? 0.6 : 1,
										},
										children: saving ? "保存中..." : "保存设置"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										onClick: enableOTP,
										style: {
											background: '#52c41a',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '6px 16px',
											fontSize: '13px',
											cursor: 'pointer',
										},
										children: "启用 OTP"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										onClick: disableOTP,
										style: {
											background: '#ff4d4f',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '6px 16px',
											fontSize: '13px',
											cursor: 'pointer',
										},
										children: "禁用 OTP"
									}),
								]
							}),
							status && (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: '8px',
									padding: '8px 12px',
									borderRadius: '6px',
									fontSize: '12px',
									background: status.type === 'success' ? '#f6ffed' : '#fff2f0',
									border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`,
									color: status.type === 'success' ? '#52c41a' : '#ff4d4f',
								},
								children: status.message
							}),
							backupCodes && (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: '8px',
									padding: '12px',
									borderRadius: '6px',
									background: '#f6f8fa',
									border: '1px solid #d0d7de',
								},
								children: (0, react_jsx_runtime.jsxs)(react.Fragment, {
									children: [
										(0, react_jsx_runtime.jsx)("div", {
											style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' },
											children: "备份代码（请妥善保存）："
										}),
										(0, react_jsx_runtime.jsx)("pre", {
											style: {
												margin: 0,
												fontSize: '12px',
												fontFamily: 'monospace',
												whiteSpace: 'pre-wrap',
											},
											children: backupCodes.join('\n')
										}),
									]
								})
							}),
						]
					}),
				]
			});
		}

		/**
		 * Required services (cordis fiber inject).
		 */
		const inject = [
			"slots",
			"connection",
			"remote",
			"settingsScope"
		];

		/**
		 * Mount the OTP settings section.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "otp",
				order: 20,
				label: () => "OTP 认证",
				locale: "dsh-password-gate",
			}, OTPSettingsPanel));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
