window.__ModuleLoader__.load({
	id: "dsh-password-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");

		// Simple QR code generator using canvas
		function generateQRCode(canvas, text, size) {
			const ctx = canvas.getContext('2d');
			const modules = encodeQR(text);
			const moduleCount = modules.length;
			const cellSize = Math.floor(size / (moduleCount + 8));
			const offset = Math.floor((size - cellSize * moduleCount) / 2);

			canvas.width = size;
			canvas.height = size;
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, size, size);
			ctx.fillStyle = '#000000';

			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (modules[row][col]) {
						ctx.fillRect(offset + col * cellSize, offset + row * cellSize, cellSize, cellSize);
					}
				}
			}
		}

		// Minimal QR code encoder
		function encodeQR(text) {
			const len = text.length;
			const data = [];
			for (let i = 0; i < len; i++) {
				const c = text.charCodeAt(i);
				if (c < 128) {
					data.push(c);
				} else if (c < 2048) {
					data.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
				} else {
					data.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
				}
			}

			const size = 25;
			const modules = Array.from({ length: size }, () => Array(size).fill(false));
			const reserved = Array.from({ length: size }, () => Array(size).fill(false));

			function drawFinder(row, col) {
				for (let r = -1; r <= 7; r++) {
					for (let c = -1; c <= 7; c++) {
						const rr = row + r, cc = col + c;
						if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
						const inBorder = r === -1 || r === 7 || c === -1 || c === 7;
						const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
						modules[rr][cc] = inBorder || inInner;
						reserved[rr][cc] = true;
					}
				}
			}
			drawFinder(0, 0);
			drawFinder(0, size - 7);
			drawFinder(size - 7, 0);

			for (let i = 8; i < size - 8; i++) {
				modules[6][i] = i % 2 === 0;
				reserved[6][i] = true;
				modules[i][6] = i % 2 === 0;
				reserved[i][6] = true;
			}

			let bitIndex = 0;
			const dataBits = [];
			for (const byte of data) {
				for (let b = 7; b >= 0; b--) {
					dataBits.push((byte >> b) & 1);
				}
			}

			let row = size - 1;
			let col = size - 1;
			let direction = -1;
			while (col >= 0) {
				if (col === 6) col--;
				for (let i = 0; i < 2; i++) {
					const r = row + direction * i;
					if (r >= 0 && r < size && !reserved[r][col]) {
						modules[r][col] = bitIndex < dataBits.length ? dataBits[bitIndex++] === 1 : false;
					}
				}
				row += direction;
				if (row < 0 || row >= size) {
					direction = -direction;
					row += direction;
					col -= 2;
				}
			}

			for (let r = 0; r < size; r++) {
				for (let c = 0; c < size; c++) {
					if (!reserved[r][c] && (r + c) % 2 === 0) {
						modules[r][c] = !modules[r][c];
					}
				}
			}

			return modules;
		}

		/**
		 * User Settings Panel component.
		 */
		function UserSettingsPanel({ ctx }) {
			const [otpEnabled, setOtpEnabled] = react.useState(false);
			const [loading, setLoading] = react.useState(true);
			const [status, setStatus] = react.useState(null);
			const [showQRModal, setShowQRModal] = react.useState(false);
			const [qrData, setQrData] = react.useState(null);
			const canvasRef = react.useRef(null);

			// Change password state
			const [showChangePassword, setShowChangePassword] = react.useState(false);
			const [oldPassword, setOldPassword] = react.useState('');
			const [newPassword, setNewPassword] = react.useState('');
			const [confirmPassword, setConfirmPassword] = react.useState('');
			const [changingPassword, setChangingPassword] = react.useState(false);

			react.useEffect(() => {
				loadSettings();
			}, []);

			react.useEffect(() => {
				if (showQRModal && qrData && canvasRef.current) {
					generateQRCode(canvasRef.current, qrData.uri, 200);
				}
			}, [showQRModal, qrData]);

			async function loadSettings() {
				try {
					const res = await fetch('/api/settings');
					const data = await res.json();
					if (data.ok) {
						setOtpEnabled(data.config?.['dsh-password-gate']?.otpEnabled || false);
					}
				} catch (err) {
					setStatus({ type: 'error', message: '加载失败: ' + err.message });
				} finally {
					setLoading(false);
				}
			}

			async function enableOTP() {
				setStatus(null);
				try {
					const res = await fetch('/otp/enable', { method: 'POST' });
					const data = await res.json();
					if (data.ok) {
						setQrData({
							secret: data.secret,
							uri: data.uri,
							backupCodes: data.backupCodes,
						});
						setShowQRModal(true);
						setOtpEnabled(true);
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
						setOtpEnabled(false);
					} else {
						setStatus({ type: 'error', message: '禁用失败: ' + (data.error || '未知错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '禁用失败: ' + err.message });
				}
			}

			function closeQRModal() {
				setShowQRModal(false);
				setQrData(null);
				setStatus({ type: 'success', message: 'OTP 已启用' });
			}

			async function changePassword() {
				if (newPassword !== confirmPassword) {
					setStatus({ type: 'error', message: '两次输入的密码不一致' });
					return;
				}
				if (newPassword.length < 8) {
					setStatus({ type: 'error', message: '密码至少需要 8 位' });
					return;
				}
				setChangingPassword(true);
				setStatus(null);
				try {
					const res = await fetch('/login/change', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ oldPassword, newPassword }),
					});
					const data = await res.json();
					if (data.ok) {
						setStatus({ type: 'success', message: '密码修改成功，请重新登录' });
						setShowChangePassword(false);
						setOldPassword('');
						setNewPassword('');
						setConfirmPassword('');
						setTimeout(() => { location.href = '/login'; }, 1500);
					} else {
						setStatus({ type: 'error', message: '修改失败: ' + (data.error || '未知错误') });
					}
				} catch (err) {
					setStatus({ type: 'error', message: '修改失败: ' + err.message });
				} finally {
					setChangingPassword(false);
				}
			}

			async function logout() {
				try {
					await fetch('/login/logout', { method: 'POST' });
					location.href = '/login';
				} catch (err) {
					setStatus({ type: 'error', message: '退出失败: ' + err.message });
				}
			}

			if (loading) {
				return (0, react_jsx_runtime.jsx)("div", { children: "加载中..." });
			}

			const inputStyle = {
				border: '1px solid #d9d9d9',
				borderRadius: '6px',
				padding: '8px 12px',
				fontSize: '13px',
				outline: 'none',
				width: '100%',
			};

			return (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: { padding: '16px 0' },
						children: [
							(0, react_jsx_runtime.jsx)("h3", {
								style: { margin: '0 0 16px 0', fontSize: '14px', fontWeight: '500' },
								children: "用户设置"
							}),

							// OTP Section
							(0, react_jsx_runtime.jsxs)("div", {
								style: { marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #e8e8e8' },
								children: [
									(0, react_jsx_runtime.jsx)("div", {
										style: { fontSize: '13px', fontWeight: '500', marginBottom: '8px' },
										children: "OTP 双因素认证"
									}),
									(0, react_jsx_runtime.jsx)("p", {
										style: { margin: '0 0 12px 0', fontSize: '12px', color: '#666' },
										children: "启用后登录需要密码 + 验证码，提高安全性。"
									}),
									(0, react_jsx_runtime.jsx)("button", {
										onClick: otpEnabled ? disableOTP : enableOTP,
										style: {
											background: otpEnabled ? '#ff4d4f' : '#52c41a',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '8px 16px',
											fontSize: '13px',
											cursor: 'pointer',
										},
										children: otpEnabled ? "禁用 OTP" : "启用 OTP"
									}),
								]
							}),

							// Change Password Section
							(0, react_jsx_runtime.jsxs)("div", {
								style: { marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #e8e8e8' },
								children: [
									(0, react_jsx_runtime.jsx)("div", {
										style: { fontSize: '13px', fontWeight: '500', marginBottom: '8px' },
										children: "修改密码"
									}),
									!showChangePassword ? (0, react_jsx_runtime.jsx)("button", {
										onClick: () => setShowChangePassword(true),
										style: {
											background: '#1677ff',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '8px 16px',
											fontSize: '13px',
											cursor: 'pointer',
										},
										children: "修改密码"
									}) : (0, react_jsx_runtime.jsxs)("div", {
										style: { display: 'flex', flexDirection: 'column', gap: '12px' },
										children: [
											(0, react_jsx_runtime.jsx)("input", {
												type: "password",
												placeholder: "当前密码",
												value: oldPassword,
												onChange: (e) => setOldPassword(e.target.value),
												style: inputStyle,
											}),
											(0, react_jsx_runtime.jsx)("input", {
												type: "password",
												placeholder: "新密码（至少 8 位）",
												value: newPassword,
												onChange: (e) => setNewPassword(e.target.value),
												style: inputStyle,
											}),
											(0, react_jsx_runtime.jsx)("input", {
												type: "password",
												placeholder: "确认新密码",
												value: confirmPassword,
												onChange: (e) => setConfirmPassword(e.target.value),
												style: inputStyle,
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												style: { display: 'flex', gap: '8px' },
												children: [
													(0, react_jsx_runtime.jsx)("button", {
														onClick: changePassword,
														disabled: changingPassword,
														style: {
															background: '#1677ff',
															color: 'white',
															border: 'none',
															borderRadius: '6px',
															padding: '8px 16px',
															fontSize: '13px',
															cursor: changingPassword ? 'not-allowed' : 'pointer',
															opacity: changingPassword ? 0.6 : 1,
														},
														children: changingPassword ? "修改中..." : "确认修改"
													}),
													(0, react_jsx_runtime.jsx)("button", {
														onClick: () => {
															setShowChangePassword(false);
															setOldPassword('');
															setNewPassword('');
															setConfirmPassword('');
														},
														style: {
															background: '#f5f5f5',
															color: '#666',
															border: '1px solid #d9d9d9',
															borderRadius: '6px',
															padding: '8px 16px',
															fontSize: '13px',
															cursor: 'pointer',
														},
														children: "取消"
													}),
												]
											}),
										]
									}),
								]
							}),

							// Logout Section
							(0, react_jsx_runtime.jsxs)("div", {
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										onClick: logout,
										style: {
											background: '#ff4d4f',
											color: 'white',
											border: 'none',
											borderRadius: '6px',
											padding: '8px 16px',
											fontSize: '13px',
											cursor: 'pointer',
										},
										children: "退出登录"
									}),
								]
							}),

							// Status message
							status && (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: '16px',
									padding: '8px 12px',
									borderRadius: '6px',
									fontSize: '12px',
									background: status.type === 'success' ? '#f6ffed' : '#fff2f0',
									border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`,
									color: status.type === 'success' ? '#52c41a' : '#ff4d4f',
								},
								children: status.message
							}),
						]
					}),

					// QR Code Modal
					showQRModal && qrData && (0, react_jsx_runtime.jsx)("div", {
						style: {
							position: 'fixed',
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							background: 'rgba(0, 0, 0, 0.5)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							zIndex: 1000,
						},
						onClick: closeQRModal,
						children: (0, react_jsx_runtime.jsxs)("div", {
							style: {
								background: 'white',
								borderRadius: '12px',
								padding: '24px',
								maxWidth: '400px',
								width: '90%',
								maxHeight: '80vh',
								overflow: 'auto',
							},
							onClick: (e) => e.stopPropagation(),
							children: [
								(0, react_jsx_runtime.jsx)("h3", {
									style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' },
									children: "设置 OTP 验证器"
								}),
								(0, react_jsx_runtime.jsx)("p", {
									style: { margin: '0 0 16px 0', fontSize: '13px', color: '#666' },
									children: "使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码："
								}),
								(0, react_jsx_runtime.jsx)("div", {
									style: { textAlign: 'center', margin: '16px 0' },
									children: (0, react_jsx_runtime.jsx)("canvas", {
										ref: canvasRef,
										style: { border: '1px solid #e8e8e8', borderRadius: '8px' },
									})
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: { margin: '16px 0' },
									children: [
										(0, react_jsx_runtime.jsx)("div", {
											style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' },
											children: "密钥（手动输入用）："
										}),
										(0, react_jsx_runtime.jsx)("div", {
											style: {
												padding: '8px 12px',
												background: '#f6f8fa',
												borderRadius: '6px',
												fontFamily: 'monospace',
												fontSize: '13px',
												wordBreak: 'break-all',
											},
											children: qrData.secret
										}),
									]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: { margin: '16px 0' },
									children: [
										(0, react_jsx_runtime.jsx)("div", {
											style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' },
											children: "备份代码（请妥善保存）："
										}),
										(0, react_jsx_runtime.jsx)("div", {
											style: {
												padding: '8px 12px',
												background: '#f6f8fa',
												borderRadius: '6px',
												fontFamily: 'monospace',
												fontSize: '12px',
												whiteSpace: 'pre-wrap',
											},
											children: qrData.backupCodes.join('\n')
										}),
									]
								}),
								(0, react_jsx_runtime.jsx)("button", {
									onClick: closeQRModal,
									style: {
										width: '100%',
										marginTop: '16px',
										padding: '10px',
										background: '#1677ff',
										color: 'white',
										border: 'none',
										borderRadius: '6px',
										fontSize: '14px',
										cursor: 'pointer',
									},
									children: "我已保存，关闭"
								}),
							]
						})
					})
				]
			});
		}

		const inject = [
			"slots",
			"connection",
			"remote",
			"settingsScope"
		];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "user-settings",
				order: 20,
				label: () => "用户设置",
				locale: "dsh-password-gate",
			}, UserSettingsPanel));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
