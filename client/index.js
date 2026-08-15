window.__ModuleLoader__.load({
	id: "dsh-password-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");

		// QR Code generator - using a minimal but working implementation
		// Based on the QR code specification with proper encoding
		const QRCode = (() => {
			// GF(2^8) arithmetic for Reed-Solomon error correction
			const GF256 = (() => {
				const EXP = new Uint8Array(256);
				const LOG = new Uint8Array(256);
				let x = 1;
				for (let i = 0; i < 255; i++) {
					EXP[i] = x;
					LOG[x] = i;
					x = x < 128 ? x << 1 : (x << 1) ^ 0x11d;
				}
				EXP[255] = EXP[0];
				return {
					exp: (a) => EXP[a % 255],
					log: (a) => LOG[a],
					mul: (a, b) => a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255],
				};
			})();

			// Reed-Solomon encoder
			function rsEncode(data, nsym) {
				const gen = [1];
				for (let i = 0; i < nsym; i++) {
					const newGen = new Uint8Array(gen.length + 1);
					for (let j = 0; j < gen.length; j++) {
						newGen[j] = gen[j];
						newGen[j + 1] = gen[j + 1] || 0;
					}
					for (let j = 0; j < gen.length; j++) {
						newGen[j + 1] ^= GF256.mul(gen[j], GF256.exp(i));
					}
					gen.length++;
					for (let j = 0; j < gen.length; j++) gen[j] = newGen[j];
				}

				const msg = new Uint8Array(data.length + nsym);
				msg.set(data);
				for (let i = 0; i < data.length; i++) {
					const coef = msg[i];
					if (coef !== 0) {
						for (let j = 0; j < gen.length; j++) {
							msg[i + j] ^= GF256.mul(gen[j], coef);
						}
					}
				}
				return msg.slice(data.length);
			}

			// Data encoding modes
			const MODE = { BYTE: 0b0100, ALPHANUM: 0b0010, NUM: 0b0001 };

			// Version capacities (byte mode)
			const CAPACITIES = [
				0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
				321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
				929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732,
				1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
			];

			// Error correction codewords per block
			const EC_CODEWORDS = [
				0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
				20, 24, 30, 22, 24, 28, 30, 28, 28, 28,
				28, 30, 30, 26, 28, 30, 30, 30, 30, 30,
				30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
			];

			// Number of error correction blocks
			const EC_BLOCKS = [
				0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,
				5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
				17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
				31, 33, 35, 37, 38, 40, 43, 45, 48, 51,
			];

			// Alignment pattern positions
			const ALIGN_POS = [
				[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
				[6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
				[6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
				[6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
				[6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
				[6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
				[6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
				[6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
				[6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
				[6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
				[6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
				[6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
				[6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
			];

			function getVersion(dataLen) {
				for (let v = 1; v <= 40; v++) {
					if (dataLen <= CAPACITIES[v]) return v;
				}
				return 40;
			}

			function createMatrix(version) {
				const size = version * 4 + 17;
				const matrix = Array.from({ length: size }, () => new Int8Array(size)); // 0=unset, 1=black, -1=white
				const reserved = Array.from({ length: size }, () => new Uint8Array(size));
				return { matrix, reserved, size };
			}

			function placeFinderPattern(qr, row, col) {
				const { matrix, reserved, size } = qr;
				for (let r = -1; r <= 7; r++) {
					for (let c = -1; c <= 7; c++) {
						const rr = row + r, cc = col + c;
						if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
						const inBorder = r === -1 || r === 7 || c === -1 || c === 7;
						const inBlack = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
						const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
						matrix[rr][cc] = (inBorder || inBlack || inInner) ? 1 : -1;
						reserved[rr][cc] = 1;
					}
				}
			}

			function placeAlignmentPattern(qr, row, col) {
				const { matrix, reserved } = qr;
				for (let r = -2; r <= 2; r++) {
					for (let c = -2; c <= 2; c++) {
						const rr = row + r, cc = col + c;
						if (reserved[rr][cc]) continue;
						const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
						matrix[rr][cc] = isBlack ? 1 : -1;
						reserved[rr][cc] = 1;
					}
				}
			}

			function placeTimingPatterns(qr) {
				const { matrix, reserved, size } = qr;
				for (let i = 8; i < size - 8; i++) {
					if (!reserved[6][i]) {
						matrix[6][i] = i % 2 === 0 ? 1 : -1;
						reserved[6][i] = 1;
					}
					if (!reserved[i][6]) {
						matrix[i][6] = i % 2 === 0 ? 1 : -1;
						reserved[i][6] = 1;
					}
				}
			}

			function reserveFormatInfo(qr) {
				const { reserved, size } = qr;
				for (let i = 0; i < 8; i++) {
					reserved[8][i] = 1;
					reserved[i][8] = 1;
					reserved[8][size - 1 - i] = 1;
					reserved[size - 1 - i][8] = 1;
				}
				reserved[8][8] = 1;
				reserved[size - 8][8] = 1;
				reserved[8][size - 8] = 1;
			}

			function placeData(qr, bits) {
				const { matrix, reserved, size } = qr;
				let bitIdx = 0;
				let col = size - 1;
				let upward = true;

				while (col >= 0) {
					if (col === 6) col--;
					const rows = upward ? size - 1 : 0;
					const end = upward ? -1 : size;
					const step = upward ? -1 : 1;

					for (let row = rows; row !== end; row += step) {
						for (let dc = 0; dc < 2; dc++) {
							const c = col - dc;
							if (c < 0 || reserved[row][c]) continue;
							matrix[row][c] = bitIdx < bits.length && bits[bitIdx] ? 1 : -1;
							bitIdx++;
						}
					}

					upward = !upward;
					col -= 2;
				}
			}

			function applyMask(qr, maskNum) {
				const { matrix, reserved, size } = qr;
				const masks = [
					(r, c) => (r + c) % 2 === 0,
					(r, c) => r % 2 === 0,
					(r, c) => c % 3 === 0,
					(r, c) => (r + c) % 3 === 0,
					(r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
					(r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
					(r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
					(r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
				];
				const mask = masks[maskNum];
				for (let r = 0; r < size; r++) {
					for (let c = 0; c < size; c++) {
						if (!reserved[r][c] && mask(r, c)) {
							matrix[r][c] = matrix[r][c] === 1 ? -1 : 1;
						}
					}
				}
			}

			function placeFormatInfo(qr, maskNum) {
				const { matrix, size } = qr;
				const ecLevel = 1; // M
				const formatInfo = ((ecLevel << 3) | maskNum) ^ 0x5412;
				const bits = [];
				for (let i = 14; i >= 0; i--) bits.push((formatInfo >> i) & 1);

				const positions1 = [
					[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
					[7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
				];
				const positions2 = [
					[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
					[size - 5, 8], [size - 6, 8], [size - 7, 8],
					[8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
					[8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
				];

				for (let i = 0; i < 15; i++) {
					matrix[positions1[i][0]][positions1[i][1]] = bits[i] ? 1 : -1;
					matrix[positions2[i][0]][positions2[i][1]] = bits[i] ? 1 : -1;
				}
			}

			function encode(text) {
				const data = new TextEncoder().encode(text);
				const version = getVersion(data.length + 3); // +3 for mode + length
				const size = version * 4 + 17;
				const qr = createMatrix(version);

				// Place fixed patterns
				placeFinderPattern(qr, 0, 0);
				placeFinderPattern(qr, 0, size - 7);
				placeFinderPattern(qr, size - 7, 0);
				placeTimingPatterns(qr);
				reserveFormatInfo(qr);

				// Place alignment patterns
				const alignPos = ALIGN_POS[version] || [];
				for (let i = 0; i < alignPos.length; i++) {
					for (let j = 0; j < alignPos.length; j++) {
						const row = alignPos[i], col = alignPos[j];
						if (qr.reserved[row][col]) continue;
						placeAlignmentPattern(qr, row, col);
					}
				}

				// Encode data
				const dataBits = [];
				// Mode indicator (byte mode = 0100)
				dataBits.push(0, 1, 0, 0);
				// Character count
				const lenBits = version <= 9 ? 8 : 16;
				for (let i = lenBits - 1; i >= 0; i--) dataBits.push((data.length >> i) & 1);
				// Data bytes
				for (const byte of data) {
					for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
				}
				// Terminator
				for (let i = 0; i < 4; i++) dataBits.push(0);
				// Pad to byte boundary
				while (dataBits.length % 8 !== 0) dataBits.push(0);
				// Pad bytes
				const padBytes = [0xec, 0x11];
				let padIdx = 0;
				while (dataBits.length < (CAPACITIES[version] + 3) * 8 + 32) {
					const pb = padBytes[padIdx % 2];
					for (let i = 7; i >= 0; i--) dataBits.push((pb >> i) & 1);
					padIdx++;
				}

				// Add error correction
				const totalDataCodewords = CAPACITIES[version];
				const totalCodewords = totalDataCodewords + EC_BLOCKS[version] * EC_CODEWORDS[version];
				const dataBytes = [];
				for (let i = 0; i < dataBits.length; i += 8) {
					let byte = 0;
					for (let j = 0; j < 8; j++) byte = (byte << 1) | (dataBits[i + j] || 0);
					dataBytes.push(byte);
				}

				// Split into blocks and add EC
				const blockSize = Math.floor(totalDataCodewords / EC_BLOCKS[version]);
				const ecPerBlock = EC_CODEWORDS[version];
				const blocks = [];
				const ecBlocks = [];
				let offset = 0;
				for (let i = 0; i < EC_BLOCKS[version]; i++) {
					const block = dataBytes.slice(offset, offset + blockSize);
					blocks.push(block);
					ecBlocks.push(rsEncode(block, ecPerBlock));
					offset += blockSize;
				}

				// Interleave data blocks
				const interleaved = [];
				for (let i = 0; i < blockSize; i++) {
					for (const block of blocks) {
						if (i < block.length) interleaved.push(block[i]);
					}
				}
				// Interleave EC blocks
				for (let i = 0; i < ecPerBlock; i++) {
					for (const ec of ecBlocks) {
						if (i < ec.length) interleaved.push(ec[i]);
					}
				}

				// Convert to bits
				const finalBits = [];
				for (const byte of interleaved) {
					for (let i = 7; i >= 0; i--) finalBits.push((byte >> i) & 1);
				}

				// Place data
				placeData(qr, finalBits);

				// Try all masks and pick the best (lowest penalty)
				let bestMask = 0;
				let bestPenalty = Infinity;
				for (let m = 0; m < 8; m++) {
					const testQr = createMatrix(version);
					// Copy patterns
					testQr.matrix.forEach((row, i) => row.set(qr.matrix[i]));
					testQr.reserved.forEach((row, i) => row.set(qr.reserved[i]));
					applyMask(testQr, m);
					placeFormatInfo(testQr, m);
					const penalty = calculatePenalty(testQr);
					if (penalty < bestPenalty) {
						bestPenalty = penalty;
						bestMask = m;
					}
				}

				applyMask(qr, bestMask);
				placeFormatInfo(qr, bestMask);

				return qr.matrix;
			}

			function calculatePenalty(qr) {
				const { matrix, size } = qr;
				let penalty = 0;
				// Rule 1: consecutive same-color modules
				for (let r = 0; r < size; r++) {
					let count = 1;
					for (let c = 1; c < size; c++) {
						if (matrix[r][c] === matrix[r][c - 1]) {
							count++;
							if (count === 5) penalty += 3;
							else if (count > 5) penalty += 1;
						} else {
							count = 1;
						}
					}
				}
				for (let c = 0; c < size; c++) {
					let count = 1;
					for (let r = 1; r < size; r++) {
						if (matrix[r][c] === matrix[r - 1][c]) {
							count++;
							if (count === 5) penalty += 3;
							else if (count > 5) penalty += 1;
						} else {
							count = 1;
						}
					}
				}
				return penalty;
			}

			function render(canvas, text, size) {
				const modules = encode(text);
				const moduleCount = modules.length;
				const ctx = canvas.getContext('2d');
				const cellSize = Math.floor(size / (moduleCount + 8));
				const offset = Math.floor((size - cellSize * moduleCount) / 2);

				canvas.width = size;
				canvas.height = size;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, size, size);
				ctx.fillStyle = '#000000';

				for (let r = 0; r < moduleCount; r++) {
					for (let c = 0; c < moduleCount; c++) {
						if (modules[r][c] === 1) {
							ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
						}
					}
				}
			}

			return { render };
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

			react.useEffect(() => {
				loadSettings();
			}, []);

			react.useEffect(() => {
				if (showQRModal && qrData && canvasRef.current) {
					QRCode.render(canvasRef.current, qrData.uri, 200);
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
				transition: 'border-color 0.2s',
			};

			const sectionStyle = {
				marginBottom: '20px',
				paddingBottom: '20px',
				borderBottom: '1px solid #f0f0f0',
			};

			const sectionTitleStyle = {
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				fontSize: '13px',
				fontWeight: '600',
				marginBottom: '8px',
				color: '#1a1a1a',
			};

			const sectionDescStyle = {
				margin: '0 0 12px 0',
				fontSize: '12px',
				color: '#8c8c8c',
				lineHeight: '1.5',
			};

			return (0, react_jsx_runtime.jsxs)(react.Fragment, {
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: { padding: '20px 0' },
						children: [
							(0, react_jsx_runtime.jsxs)("h3", {
								style: {
									margin: '0 0 20px 0',
									fontSize: '15px',
									fontWeight: '600',
									color: '#1a1a1a',
									display: 'flex',
									alignItems: 'center',
									gap: '8px',
								},
								children: [
									(0, react_jsx_runtime.jsx)("span", { children: "\u2699\uFE0F" }),
									"用户设置"
								]
							}),

							// OTP Section
							(0, react_jsx_runtime.jsxs)("div", {
								style: sectionStyle,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: sectionTitleStyle,
										children: [
											(0, react_jsx_runtime.jsx)("span", { children: "\uD83D\uDD10" }),
											"OTP 双因素认证"
										]
									}),
									(0, react_jsx_runtime.jsx)("p", {
										style: sectionDescStyle,
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
											fontWeight: '500',
											cursor: 'pointer',
											transition: 'opacity 0.2s',
										},
										onMouseEnter: (e) => e.target.style.opacity = '0.85',
										onMouseLeave: (e) => e.target.style.opacity = '1',
										children: otpEnabled ? "禁用 OTP" : "启用 OTP"
									}),
								]
							}),

							// Change Password Section
							(0, react_jsx_runtime.jsxs)("div", {
								style: sectionStyle,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: sectionTitleStyle,
										children: [
											(0, react_jsx_runtime.jsx)("span", { children: "\uD83D\uDD11" }),
											"修改密码"
										]
									}),
									(0, react_jsx_runtime.jsx)("p", {
										style: sectionDescStyle,
										children: "修改您的登录密码。"
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
											fontWeight: '500',
											cursor: 'pointer',
											transition: 'opacity 0.2s',
										},
										onMouseEnter: (e) => e.target.style.opacity = '0.85',
										onMouseLeave: (e) => e.target.style.opacity = '1',
										children: "修改密码"
									}) : (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: 'flex',
											flexDirection: 'column',
											gap: '12px',
											padding: '16px',
											background: '#fafafa',
											borderRadius: '8px',
										},
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
												style: { display: 'flex', gap: '8px', marginTop: '4px' },
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
															fontWeight: '500',
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
															background: 'white',
															color: '#666',
															border: '1px solid #d9d9d9',
															borderRadius: '6px',
															padding: '8px 16px',
															fontSize: '13px',
															fontWeight: '500',
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
								style: { paddingTop: '4px' },
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										onClick: logout,
										style: {
											background: 'white',
											color: '#ff4d4f',
											border: '1px solid #ff4d4f',
											borderRadius: '6px',
											padding: '8px 16px',
											fontSize: '13px',
											fontWeight: '500',
											cursor: 'pointer',
											transition: 'all 0.2s',
										},
										onMouseEnter: (e) => {
											e.target.style.background = '#ff4d4f';
											e.target.style.color = 'white';
										},
										onMouseLeave: (e) => {
											e.target.style.background = 'white';
											e.target.style.color = '#ff4d4f';
										},
										children: "退出登录"
									}),
								]
							}),

							// Status message
							status && (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: '16px',
									padding: '10px 14px',
									borderRadius: '8px',
									fontSize: '13px',
									fontWeight: '500',
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
