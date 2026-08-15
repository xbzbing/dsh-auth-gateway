window.__ModuleLoader__.load({
	id: "dsh-password-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");

		/**
		 * User Settings Panel component.
		 */
		function UserSettingsPanel({ ctx }) {
			const [otpEnabled, setOtpEnabled] = react.useState(false);
			const [loading, setLoading] = react.useState(true);
			const [status, setStatus] = react.useState(null);
			const [showQRModal, setShowQRModal] = react.useState(false);
			const [qrData, setQrData] = react.useState(null);

			const [showChangePassword, setShowChangePassword] = react.useState(false);
			const [oldPassword, setOldPassword] = react.useState('');
			const [newPassword, setNewPassword] = react.useState('');
			const [confirmPassword, setConfirmPassword] = react.useState('');
			const [changingPassword, setChangingPassword] = react.useState(false);
			const [otpCode, setOtpCode] = react.useState('');
			const [verifyingOtp, setVerifyingOtp] = react.useState(false);

			react.useEffect(() => { loadSettings(); }, []);

			async function loadSettings() {
				try {
					const res = await fetch('/api/settings');
					const data = await res.json();
					if (data.ok) setOtpEnabled(data.config?.['dsh-password-gate']?.otpEnabled || false);
				} catch (err) {
					setStatus({ type: 'error', message: '加载失败: ' + err.message });
				} finally { setLoading(false); }
			}

			async function enableOTP() {
				setStatus(null);
				try {
					const res = await fetch('/otp/enable', { method: 'POST' });
					const data = await res.json();
					if (data.ok) {
						setQrData({ secret: data.secret, uri: data.uri, svgUrl: data.svgUrl, backupCodes: data.backupCodes });
						setShowQRModal(true);
						setOtpEnabled(true);
					} else {
						setStatus({ type: 'error', message: '启用失败: ' + (data.error || '未知错误') });
					}
				} catch (err) { setStatus({ type: 'error', message: '启用失败: ' + err.message }); }
			}

			async function disableOTP() {
				if (!confirm('确定要禁用 OTP 吗？')) return;
				setStatus(null);
				try {
					const res = await fetch('/otp/disable', { method: 'POST' });
					const data = await res.json();
					if (data.ok) { setStatus({ type: 'success', message: 'OTP 已禁用' }); setOtpEnabled(false); }
					else setStatus({ type: 'error', message: '禁用失败: ' + (data.error || '未知错误') });
				} catch (err) { setStatus({ type: 'error', message: '禁用失败: ' + err.message }); }
			}

			function closeQRModal() {
				setShowQRModal(false); setQrData(null); setOtpCode('');
				setStatus({ type: 'success', message: 'OTP 已启用' });
			}

			async function verifyOTPSetup() {
				if (otpCode.length !== 6) { setStatus({ type: 'error', message: '请输入 6 位验证码' }); return; }
				setVerifyingOtp(true); setStatus(null);
				try {
					const res = await fetch('/otp/verify-setup', {
						method: 'POST', headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ otp: otpCode }),
					});
					const data = await res.json();
					if (data.ok) {
						closeQRModal();
					} else {
						setStatus({ type: 'error', message: '验证失败: ' + (data.error || '验证码错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '验证失败: ' + err.message });
				} finally {
					setVerifyingOtp(false);
				}
			}

			async function changePassword() {
				if (newPassword !== confirmPassword) { setStatus({ type: 'error', message: '两次输入的密码不一致' }); return; }
				if (newPassword.length < 8) { setStatus({ type: 'error', message: '密码至少需要 8 位' }); return; }
				setChangingPassword(true); setStatus(null);
				try {
					const res = await fetch('/login/change', {
						method: 'POST', headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ oldPassword, newPassword }),
					});
					const data = await res.json();
					if (data.ok) {
						setStatus({ type: 'success', message: '密码修改成功，请重新登录' });
						setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('');
						setTimeout(() => { location.href = '/login'; }, 1500);
					} else setStatus({ type: 'error', message: '修改失败: ' + (data.error || '未知错误') });
				} catch (err) { setStatus({ type: 'error', message: '修改失败: ' + err.message }); }
				finally { setChangingPassword(false); }
			}

			async function logout() {
				try { await fetch('/login/logout', { method: 'POST' }); location.href = '/login'; }
				catch (err) { setStatus({ type: 'error', message: '退出失败: ' + err.message }); }
			}

			if (loading) return (0, react_jsx_runtime.jsx)("div", { children: "加载中..." });

			const sectionStyle = { marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #f0f0f0' };
			const titleStyle = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#1a1a1a' };
			const descStyle = { margin: '0 0 12px 0', fontSize: '12px', color: '#8c8c8c', lineHeight: '1.5' };
			const inputStyle = { border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', outline: 'none', width: '100%' };

			return (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: { padding: '20px 0' },
						children: [
							(0, react_jsx_runtime.jsxs)("h3", {
								style: { margin: '0 0 20px 0', fontSize: '15px', fontWeight: '600', color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' },
								children: [(0, react_jsx_runtime.jsx)("span", { children: "\u2699\uFE0F" }), "用户设置"]
							}),
							// OTP
							(0, react_jsx_runtime.jsxs)("div", {
								style: sectionStyle,
								children: [
									(0, react_jsx_runtime.jsxs)("div", { style: titleStyle, children: [(0, react_jsx_runtime.jsx)("span", { children: "\uD83D\uDD10" }), "OTP 双因素认证"] }),
									(0, react_jsx_runtime.jsx)("p", { style: descStyle, children: "启用后登录需要密码 + 验证码，提高安全性。" }),
									(0, react_jsx_runtime.jsx)("button", {
										onClick: otpEnabled ? disableOTP : enableOTP,
										style: { background: otpEnabled ? '#ff4d4f' : '#52c41a', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
										children: otpEnabled ? "禁用 OTP" : "启用 OTP"
									}),
								]
							}),
							// Change Password
							(0, react_jsx_runtime.jsxs)("div", {
								style: sectionStyle,
								children: [
									(0, react_jsx_runtime.jsxs)("div", { style: titleStyle, children: [(0, react_jsx_runtime.jsx)("span", { children: "\uD83D\uDD11" }), "修改密码"] }),
									(0, react_jsx_runtime.jsx)("p", { style: descStyle, children: "修改您的登录密码。" }),
									!showChangePassword ? (0, react_jsx_runtime.jsx)("button", {
										onClick: () => setShowChangePassword(true),
										style: { background: '#1677ff', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
										children: "修改密码"
									}) : (0, react_jsx_runtime.jsxs)("div", {
										style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: '#fafafa', borderRadius: '8px' },
										children: [
											(0, react_jsx_runtime.jsx)("input", { type: "password", placeholder: "当前密码", value: oldPassword, onChange: (e) => setOldPassword(e.target.value), style: inputStyle }),
											(0, react_jsx_runtime.jsx)("input", { type: "password", placeholder: "新密码（至少 8 位）", value: newPassword, onChange: (e) => setNewPassword(e.target.value), style: inputStyle }),
											(0, react_jsx_runtime.jsx)("input", { type: "password", placeholder: "确认新密码", value: confirmPassword, onChange: (e) => setConfirmPassword(e.target.value), style: inputStyle }),
											(0, react_jsx_runtime.jsxs)("div", {
												style: { display: 'flex', gap: '8px', marginTop: '4px' },
												children: [
													(0, react_jsx_runtime.jsx)("button", {
														onClick: changePassword, disabled: changingPassword,
														style: { background: '#1677ff', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: changingPassword ? 'not-allowed' : 'pointer', opacity: changingPassword ? 0.6 : 1 },
														children: changingPassword ? "修改中..." : "确认修改"
													}),
													(0, react_jsx_runtime.jsx)("button", {
														onClick: () => { setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); },
														style: { background: 'white', color: '#666', border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
														children: "取消"
													}),
												]
											}),
										]
									}),
								]
							}),
							// Logout
							(0, react_jsx_runtime.jsxs)("div", {
								style: { paddingTop: '4px' },
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										onClick: logout,
										style: { background: 'white', color: '#ff4d4f', border: '1px solid #ff4d4f', borderRadius: '6px', padding: '7px 15px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', boxSizing: 'border-box' },
										onMouseEnter: (e) => { e.target.style.background = '#ff4d4f'; e.target.style.color = 'white'; },
										onMouseLeave: (e) => { e.target.style.background = 'white'; e.target.style.color = '#ff4d4f'; },
										children: "退出登录"
									}),
								]
							}),
							// Status
							status && (0, react_jsx_runtime.jsx)("div", {
								style: { marginTop: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', background: status.type === 'success' ? '#f6ffed' : '#fff2f0', border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`, color: status.type === 'success' ? '#52c41a' : '#ff4d4f' },
								children: status.message
							}),
						]
					}),
					// QR Modal
					showQRModal && qrData && (0, react_jsx_runtime.jsx)("div", {
						style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
						onClick: closeQRModal,
						children: (0, react_jsx_runtime.jsxs)("div", {
							style: { background: 'white', borderRadius: '12px', padding: '24px', maxWidth: '400px', width: '90%', maxHeight: '80vh', overflow: 'auto' },
							onClick: (e) => e.stopPropagation(),
							children: [
								(0, react_jsx_runtime.jsx)("h3", { style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }, children: "设置 OTP 验证器" }),
								(0, react_jsx_runtime.jsx)("p", { style: { margin: '0 0 16px 0', fontSize: '13px', color: '#666' }, children: "使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码：" }),
								(0, react_jsx_runtime.jsx)("div", { style: { textAlign: 'center', margin: '16px 0' }, children: (0, react_jsx_runtime.jsx)("img", { src: qrData.svgUrl, alt: "OTP QR Code", style: { border: '1px solid #e8e8e8', borderRadius: '8px', width: '200px', height: '200px' } }) }),
								(0, react_jsx_runtime.jsxs)("div", { style: { margin: '16px 0' }, children: [
									(0, react_jsx_runtime.jsx)("div", { style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' }, children: "密钥（手动输入用）：" }),
									(0, react_jsx_runtime.jsx)("div", { style: { padding: '8px 12px', background: '#f6f8fa', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }, children: qrData.secret }),
								] }),
								(0, react_jsx_runtime.jsxs)("div", { style: { margin: '16px 0' }, children: [
									(0, react_jsx_runtime.jsx)("div", { style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' }, children: "输入验证码以完成设置：" }),
									(0, react_jsx_runtime.jsx)("input", {
										type: "text", placeholder: "6位验证码", maxLength: 6,
										value: otpCode, onChange: (e) => setOtpCode(e.target.value.replace(/\D/g, '')),
										style: { border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 12px', fontSize: '14px', outline: 'none', width: '140px', textAlign: 'center', letterSpacing: '6px', fontFamily: 'monospace' },
										onKeyDown: (e) => { if (e.key === 'Enter') verifyOTPSetup(); }
									}),
								] }),
								status && (0, react_jsx_runtime.jsx)("div", {
									style: { margin: '12px 0', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: status.type === 'success' ? '#f6ffed' : '#fff2f0', border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`, color: status.type === 'success' ? '#52c41a' : '#ff4d4f' },
									children: status.message
								}),
								(0, react_jsx_runtime.jsx)("button", {
									onClick: verifyOTPSetup, disabled: verifyingOtp,
									style: { width: '100%', marginTop: '8px', padding: '10px', background: '#52c41a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: verifyingOtp ? 'not-allowed' : 'pointer', opacity: verifyingOtp ? 0.6 : 1 },
									children: verifyingOtp ? "验证中..." : "验证并启用"
								}),
							]
						})
					})
				]
			});
		}

		const inject = ["slots", "connection", "remote", "settingsScope"];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section", id: "user-settings", order: 20,
				label: () => "用户设置", locale: "dsh-password-gate",
			}, UserSettingsPanel));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
