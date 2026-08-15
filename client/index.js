window.__ModuleLoader__.load({
	id: "dsh-password-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");

		// QR Code generator - based on qrcode-generator by kazuhikoarase (MIT)
		// Minimal port for TOTP URI encoding only (byte mode, version 1-10)
		const QR = (() => {
			function QRCode(typeNumber, errorCorrectionLevel) {
				const PAD0 = 0xEC, PAD1 = 0x11;
				const PATTERN_POSITION_TABLE = [
					[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
					[6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
					[6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
					[6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
					[6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146]
				];
				const EC_CODEWORDS_PER_BLOCK = [
					-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
					20, 24, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30
				];
				const NUM_ERROR_CORRECTION_BLOCKS = [
					-1, 1, 1, 1, 2, 2, 4, 4, 4, 4, 4,
					5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 29, 31, 33, 35, 37, 40, 43, 45, 48, 51, 54
				];
				const MAX_CODEWORD_COUNT = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

				const EC_LEVELS = { L: 1, M: 0, Q: 3, H: 2 };
				const ecLevel = EC_LEVELS[errorCorrectionLevel] || 0;

				let buffer = [], modules = [], moduleCount = 0;

				this.addData = function(data) {
					const bytes = [];
					for (let i = 0; i < data.length; i++) bytes.push(data.charCodeAt(i) & 0xff);
					addData(bytes);
				};

				this.make = function() {
					if (typeNumber < 1) {
						for (typeNumber = 1; typeNumber <= 40; typeNumber++) {
							const count = getCapacity(typeNumber, ecLevel);
							if (buffer.length <= count) break;
						}
					}
					makeImpl(false, getBestMaskPattern());
				};

				this.getModuleCount = function() { return moduleCount; };
				this.isDark = function(row, col) {
					if (row < 0 || moduleCount <= row || col < 0 || moduleCount <= col) throw new Error(row + ',' + col);
					return modules[row][col];
				};

				function getCapacity(typeNumber, ecLevel) {
					if (typeNumber === 1) return 19;
					const totalData = MAX_CODEWORD_COUNT[typeNumber] || (typeNumber * 4 + 17);
					const ecPerBlock = EC_CODEWORDS_PER_BLOCK[typeNumber];
					const blocks = NUM_ERROR_CORRECTION_BLOCKS[typeNumber];
					return (totalData - ecPerBlock * blocks);
				}

				function addData(data) {
					const capacity = getCapacity(typeNumber, ecLevel);
					const stream = new BitStream();
					// Byte mode
					stream.put(0x04, 4);
					stream.put(data.length, typeNumber <= 9 ? 8 : 16);
					for (let i = 0; i < data.length; i++) stream.put(data[i], 8);
					// Terminator
					const termLen = Math.min(4, capacity * 8 - stream.getLengthInBits());
					for (let i = 0; i < termLen; i++) stream.put(0, 1);
					// Pad to byte
					while (stream.getLengthInBits() % 8 !== 0) stream.put(0, 1);
					// Pad bytes
					while (stream.getLengthInBits() < capacity * 8) {
						stream.put(PAD0, 8);
						if (stream.getLengthInBits() < capacity * 8) stream.put(PAD1, 8);
					}
					buffer = stream.toByteArray();
				}

				function getBestMaskPattern() {
					let minPenalty = Infinity, bestMask = 0;
					for (let mask = 0; mask < 8; mask++) {
						makeImpl(true, mask);
						const p = getPenaltyScore();
						if (p < minPenalty) { minPenalty = p; bestMask = mask; }
					}
					return bestMask;
				}

				function makeImpl(test, maskPattern) {
					moduleCount = typeNumber * 4 + 17;
					modules = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(null));
					// Finder patterns
					placeFinderPattern(0, 0);
					placeFinderPattern(0, moduleCount - 7);
					placeFinderPattern(moduleCount - 7, 0);
					// Timing
					placeTiming();
					// Alignment
					placeAlignment(maskPattern);
					// Format info
					placeFormatInfo(test, maskPattern);
					if (typeNumber >= 7) placeVersionInfo(test);
					// Data
					placeData(maskPattern);
					if (!test) makeMask(maskPattern);
				}

				function placeFinderPattern(row, col) {
					const pattern = [
						[1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],
						[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]
					];
					for (let r = -1; r <= 7; r++) {
						for (let c = -1; c <= 7; c++) {
							const rr = row + r, cc = col + c;
							if (rr < 0 || moduleCount <= rr || cc < 0 || moduleCount <= cc) continue;
							const v = (r >= 0 && r <= 6 && c >= 0 && c <= 6) ? pattern[r][c] : 0;
							modules[rr][cc] = v === 1;
						}
					}
				}

				function placeTiming() {
					for (let i = 8; i < moduleCount - 8; i++) {
						const v = i % 2 === 0;
						if (modules[6][i] === null) modules[6][i] = v;
						if (modules[i][6] === null) modules[i][6] = v;
					}
				}

				function placeAlignment() {
					const positions = PATTERN_POSITION_TABLE[typeNumber] || [];
					if (positions.length === 0) return;
					for (let i = 0; i < positions.length; i++) {
						for (let j = 0; j < positions.length; j++) {
							const row = positions[i], col = positions[j];
							if (modules[row][col] !== null) continue;
							for (let r = -2; r <= 2; r++) {
								for (let c = -2; c <= 2; c++) {
									const v = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
									modules[row + r][col + c] = v;
								}
							}
						}
					}
				}

				function getReservedCount(typeNumber) {
					let count = 3 * 8 + 2; // 3 finders + separators
					count += moduleCount * 2 - 2 * 8 + 1; // timing
					count += 15 * 2 + 1; // format info
					if (typeNumber >= 7) count += 3 * 2; // version info
					const positions = PATTERN_POSITION_TABLE[typeNumber] || [];
					if (positions.length > 0) {
						count += positions.length * positions.length * 25;
						count -= 2 * (positions.length - 1); // overlap with timing
					}
					return count;
				}

				function placeFormatInfo(test, maskPattern) {
					const data = getFormatBits(maskPattern);
					const bits = [];
					for (let i = 14; i >= 0; i--) bits.push((data >> i) & 1);
					// Around top-left finder
					const pos1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
					for (let i = 0; i < 15; i++) {
						const r = pos1[i][0], c = pos1[i][1];
						if (!test || modules[r][c] === null) modules[r][c] = bits[i] === 1;
					}
					// Right side + bottom-left
					const pos2 = [];
					for (let i = 0; i <= 6; i++) pos2.push([moduleCount - 1 - i, 8]);
					for (let i = 7; i <= 14; i++) pos2.push([8, moduleCount - 15 + i]);
					for (let i = 0; i < 15; i++) {
						const r = pos2[i][0], c = pos2[i][1];
						if (!test || modules[r][c] === null) modules[r][c] = bits[i] === 1;
					}
					// Dark module
					if (!test || modules[moduleCount - 8][8] === null) modules[moduleCount - 8][8] = true;
				}

				function getFormatBits(maskPattern) {
					const d = (ecLevel << 3) | maskPattern;
					let bits = d << 10;
					let tmp = bits;
					for (let i = 0; i < 10; i++) tmp = (tmp << 1) ^ ((tmp >>> 9) * 0x537);
					bits = ((bits ^ tmp) << 10) ^ 0x5412;
					return bits;
				}

				function placeVersionInfo() {
					if (typeNumber < 7) return;
					const bits = typeNumber << 12;
					let tmp = bits;
					for (let i = 0; i < 6; i++) tmp = (tmp << 1) ^ ((tmp >>> 11) * 0x1F25);
					const all = (bits | tmp) ^ 0x4445;
					for (let i = 0; i < 18; i++) {
						const v = ((all >> i) & 1) === 1;
						const row = i % 3 + moduleCount - 11;
						const col = Math.floor(i / 3);
						if (modules[row][col] === null) modules[row][col] = v;
						if (modules[col][row] === null) modules[col][row] = v;
					}
				}

				function placeData(maskPattern) {
					const bits = bufferToBits();
					let bitIndex = 0;
					let col = moduleCount - 1;
					while (col >= 0) {
						if (col === 6) col--;
						for (let rowOffset = 0; rowOffset < moduleCount; rowOffset++) {
							const row = ((Math.floor((moduleCount - 1 - col) / 2) & 1) === 0) ? moduleCount - 1 - rowOffset : rowOffset;
							for (let dc = 0; dc < 2; dc++) {
								const c = col - dc;
								if (c < 0 || modules[row][c] !== null) continue;
								let bit = false;
								if (bitIndex < bits.length) bit = bits[bitIndex] === 1;
								if (!isReserved(row, c)) {
									modules[row][c] = bit;
									bitIndex++;
								}
							}
						}
						col -= 2;
					}
				}

				function isReserved(row, col) {
					// Finder patterns + separators
					if (row < 9 && col < 9) return true;
					if (row < 9 && col >= moduleCount - 8) return true;
					if (row >= moduleCount - 8 && col < 9) return true;
					// Timing
					if (row === 6 || col === 6) return true;
					// Dark module
					if (row === moduleCount - 8 && col === 8) return true;
					// Alignment
					const positions = PATTERN_POSITION_TABLE[typeNumber] || [];
					for (const r of positions) {
						for (const c of positions) {
							if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
						}
					}
					return false;
				}

				function bufferToBits() {
					const bits = [];
					for (const b of buffer) {
						for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
					}
					return bits;
				}

				function makeMask(maskPattern) {
					for (let r = 0; r < moduleCount; r++) {
						for (let c = 0; c < moduleCount; c++) {
							if (isReserved(r, c)) continue;
							if (getMask(maskPattern, r, c)) modules[r][c] = !modules[r][c];
						}
					}
				}

				function getMask(i, r, c) {
					switch (i) {
						case 0: return (r + c) % 2 === 0;
						case 1: return r % 2 === 0;
						case 2: return c % 3 === 0;
						case 3: return (r + c) % 3 === 0;
						case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
						case 5: return (r * c) % 2 + (r * c) % 3 === 0;
						case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
						case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
					}
				}

				function getPenaltyScore() {
					let penalty = 0;
					// Rule 1: adjacent modules in row/column
					for (let r = 0; r < moduleCount; r++) {
						let runColor = modules[r][0], runCount = 1;
						for (let c = 1; c < moduleCount; c++) {
							if (modules[r][c] === runColor) {
								runCount++;
								if (runCount === 5) penalty += 3;
								else if (runCount > 5) penalty += 1;
							} else {
								runColor = modules[r][c];
								runCount = 1;
							}
						}
					}
					for (let c = 0; c < moduleCount; c++) {
						let runColor = modules[0][c], runCount = 1;
						for (let r = 1; r < moduleCount; r++) {
							if (modules[r][c] === runColor) {
								runCount++;
								if (runCount === 5) penalty += 3;
								else if (runCount > 5) penalty += 1;
							} else {
								runColor = modules[r][c];
								runCount = 1;
							}
						}
					}
					// Rule 2: 2x2 same color blocks
					for (let r = 0; r < moduleCount - 1; r++) {
						for (let c = 0; c < moduleCount - 1; c++) {
							const v = modules[r][c];
							if (v === modules[r][c+1] && v === modules[r+1][c] && v === modules[r+1][c+1]) penalty += 3;
						}
					}
					return penalty;
				}
			}

			function BitStream() {
				let buffer = [], bufferIndex = 0;
				this.put = function(num, length) {
					for (let i = length - 1; i >= 0; i--) {
						const bit = ((num >> i) & 1) === 1;
						const byteIndex = Math.floor(bufferIndex / 8);
						if (byteIndex >= buffer.length) buffer.push(0);
						if (bit) buffer[byteIndex] |= (0x80 >>> (bufferIndex % 8));
						bufferIndex++;
					}
				};
				this.getLengthInBits = function() { return bufferIndex; };
				this.toByteArray = function() { return buffer; };
			}

			function create(typeNumber, ecLevel) {
				return new QRCode(typeNumber, ecLevel);
			}

			function renderCanvas(canvas, text, size) {
				const qr = create(0, 'M');
				qr.addData(text);
				qr.make();
				const count = qr.getModuleCount();
				const ctx = canvas.getContext('2d');
				const cellSize = Math.floor(size / (count + 8));
				const offset = Math.floor((size - cellSize * count) / 2);
				canvas.width = size;
				canvas.height = size;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, size, size);
				ctx.fillStyle = '#000000';
				for (let r = 0; r < count; r++) {
					for (let c = 0; c < count; c++) {
						if (qr.isDark(r, c)) {
							ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
						}
					}
				}
			}

			return { renderCanvas };
		})();

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

			const [showChangePassword, setShowChangePassword] = react.useState(false);
			const [oldPassword, setOldPassword] = react.useState('');
			const [newPassword, setNewPassword] = react.useState('');
			const [confirmPassword, setConfirmPassword] = react.useState('');
			const [changingPassword, setChangingPassword] = react.useState(false);

			react.useEffect(() => { loadSettings(); }, []);

			react.useEffect(() => {
				if (showQRModal && qrData && canvasRef.current) {
					QR.renderCanvas(canvasRef.current, qrData.uri, 200);
				}
			}, [showQRModal, qrData]);

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
						setQrData({ secret: data.secret, uri: data.uri, backupCodes: data.backupCodes });
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
				setShowQRModal(false); setQrData(null);
				setStatus({ type: 'success', message: 'OTP 已启用' });
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
								(0, react_jsx_runtime.jsx)("div", { style: { textAlign: 'center', margin: '16px 0' }, children: (0, react_jsx_runtime.jsx)("canvas", { ref: canvasRef, style: { border: '1px solid #e8e8e8', borderRadius: '8px' } }) }),
								(0, react_jsx_runtime.jsxs)("div", { style: { margin: '16px 0' }, children: [
									(0, react_jsx_runtime.jsx)("div", { style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' }, children: "密钥（手动输入用）：" }),
									(0, react_jsx_runtime.jsx)("div", { style: { padding: '8px 12px', background: '#f6f8fa', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }, children: qrData.secret }),
								] }),
								(0, react_jsx_runtime.jsxs)("div", { style: { margin: '16px 0' }, children: [
									(0, react_jsx_runtime.jsx)("div", { style: { fontSize: '12px', fontWeight: '500', marginBottom: '8px' }, children: "备份代码（请妥善保存）：" }),
									(0, react_jsx_runtime.jsx)("div", { style: { padding: '8px 12px', background: '#f6f8fa', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }, children: qrData.backupCodes.join('\n') }),
								] }),
								(0, react_jsx_runtime.jsx)("button", { onClick: closeQRModal, style: { width: '100%', marginTop: '16px', padding: '10px', background: '#1677ff', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }, children: "我已保存，关闭" }),
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
