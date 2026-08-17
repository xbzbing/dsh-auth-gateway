window.__ModuleLoader__.load({
	id: "dsh-password-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
		
		// client/src/index.jsx
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);
		var import_react = require("react");
		var import_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		var import_jsx_runtime = require("react/jsx-runtime");
		function UserSettingsPanel({ api }) {
		  const [otpEnabled, setOtpEnabled] = (0, import_react.useState)(false);
		  const [digits, setDigits] = (0, import_react.useState)(6);
		  const [loading, setLoading] = (0, import_react.useState)(true);
		  const [status, setStatus] = (0, import_react.useState)(null);
		  const [showQRModal, setShowQRModal] = (0, import_react.useState)(false);
		  const [qrData, setQrData] = (0, import_react.useState)(null);
		  const [showChangePassword, setShowChangePassword] = (0, import_react.useState)(false);
		  const [oldPassword, setOldPassword] = (0, import_react.useState)("");
		  const [newPassword, setNewPassword] = (0, import_react.useState)("");
		  const [confirmPassword, setConfirmPassword] = (0, import_react.useState)("");
		  const [changingPassword, setChangingPassword] = (0, import_react.useState)(false);
		  const [otpCode, setOtpCode] = (0, import_react.useState)("");
		  const [verifyingOtp, setVerifyingOtp] = (0, import_react.useState)(false);
		  const [showDisableOtp, setShowDisableOtp] = (0, import_react.useState)(false);
		  const [disableOtpCode, setDisableOtpCode] = (0, import_react.useState)("");
		  const [disablingOtp, setDisablingOtp] = (0, import_react.useState)(false);
		  (0, import_react.useEffect)(() => {
		    loadSettings();
		  }, []);
		  async function loadSettings() {
		    try {
		      const data = await api.getSettings();
		      if (data.ok) {
		        const cfg = data.config?.["dsh-password-gate"] || {};
		        setOtpEnabled(cfg.otpEnabled || false);
		        setDigits(cfg.otpDigits || 6);
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: "\u52A0\u8F7D\u5931\u8D25: " + err.message });
		    } finally {
		      setLoading(false);
		    }
		  }
		  async function enableOTP() {
		    setStatus(null);
		    try {
		      const data = await api.enableOtp();
		      if (data.ok) {
		        setQrData({ secret: data.secret, uri: data.uri, svgUrl: data.svgUrl, backupCodes: data.backupCodes });
		        setShowQRModal(true);
		      } else {
		        setStatus({ type: "error", message: "\u542F\u7528\u5931\u8D25: " + (data.error || "\u672A\u77E5\u9519\u8BEF") });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: "\u542F\u7528\u5931\u8D25: " + err.message });
		    }
		  }
		  async function disableOTP() {
		    setStatus(null);
		    const code = disableOtpCode.trim();
		    if (!code) {
		      setStatus({ type: "error", message: "\u8BF7\u8F93\u5165\u5F53\u524D\u9A8C\u8BC1\u7801\u6216\u5907\u4EFD\u4EE3\u7801" });
		      return;
		    }
		    const isDigits = /^\d{6}$/.test(code);
		    const body = isDigits ? { otp: code } : { backupCode: code };
		    setDisablingOtp(true);
		    try {
		      const data = await api.disableOtp(body);
		      if (data.ok) {
		        setStatus({ type: "success", message: "OTP \u5DF2\u7981\u7528" });
		        setOtpEnabled(false);
		        setShowDisableOtp(false);
		        setDisableOtpCode("");
		      } else {
		        setStatus({ type: "error", message: "\u7981\u7528\u5931\u8D25: " + (data.error || "\u672A\u77E5\u9519\u8BEF") });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: "\u7981\u7528\u5931\u8D25: " + err.message });
		    } finally {
		      setDisablingOtp(false);
		    }
		  }
		  function closeQRModal() {
		    setShowQRModal(false);
		    setQrData(null);
		    setOtpCode("");
		    setVerifyingOtp(false);
		    setStatus(null);
		  }
		  async function verifyOTPSetup() {
		    if (otpCode.length !== digits) {
		      setStatus({ type: "error", message: "\u8BF7\u8F93\u5165 " + digits + " \u4F4D\u9A8C\u8BC1\u7801" });
		      return;
		    }
		    setVerifyingOtp(true);
		    setStatus(null);
		    try {
		      const data = await api.verifyOtpSetup(otpCode);
		      if (data.ok) {
		        setShowQRModal(false);
		        setQrData(null);
		        setOtpCode("");
		        setVerifyingOtp(false);
		        setOtpEnabled(true);
		        setStatus({ type: "success", message: "OTP \u5DF2\u542F\u7528" });
		      } else {
		        setStatus({ type: "error", message: "\u9A8C\u8BC1\u5931\u8D25: " + (data.error || "\u9A8C\u8BC1\u7801\u9519\u8BEF") });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: "\u9A8C\u8BC1\u5931\u8D25: " + err.message });
		    } finally {
		      setVerifyingOtp(false);
		    }
		  }
		  async function changePassword() {
		    if (newPassword !== confirmPassword) {
		      setStatus({ type: "error", message: "\u4E24\u6B21\u8F93\u5165\u7684\u5BC6\u7801\u4E0D\u4E00\u81F4" });
		      return;
		    }
		    if (newPassword.length < 8) {
		      setStatus({ type: "error", message: "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 8 \u4F4D" });
		      return;
		    }
		    setChangingPassword(true);
		    setStatus(null);
		    try {
		      const data = await api.changePassword(oldPassword, newPassword);
		      if (data.ok) {
		        setStatus({ type: "success", message: "\u5BC6\u7801\u4FEE\u6539\u6210\u529F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55" });
		        setShowChangePassword(false);
		        setOldPassword("");
		        setNewPassword("");
		        setConfirmPassword("");
		        setTimeout(() => {
		          location.href = "/login";
		        }, 1500);
		      } else setStatus({ type: "error", message: "\u4FEE\u6539\u5931\u8D25: " + (data.error || "\u672A\u77E5\u9519\u8BEF") });
		    } catch (err) {
		      setStatus({ type: "error", message: "\u4FEE\u6539\u5931\u8D25: " + err.message });
		    } finally {
		      setChangingPassword(false);
		    }
		  }
		  async function logout() {
		    try {
		      await api.logout();
		      location.href = "/login";
		    } catch (err) {
		      setStatus({ type: "error", message: "\u9000\u51FA\u5931\u8D25: " + err.message });
		    }
		  }
		  if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "\u52A0\u8F7D\u4E2D..." });
		  const sectionStyle = { marginBottom: "20px", paddingBottom: "20px", borderBottom: "1px solid #f0f0f0" };
		  const titleStyle = { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", marginBottom: "8px", color: "#1a1a1a" };
		  const descStyle = { margin: "0 0 12px 0", fontSize: "12px", color: "#8c8c8c", lineHeight: "1.5" };
		  const inputStyle = { border: "1px solid #d9d9d9", borderRadius: "6px", padding: "8px 12px", fontSize: "13px", outline: "none", width: "100%" };
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "20px 0" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: { margin: "0 0 20px 0", fontSize: "15px", fontWeight: "600", color: "#1a1a1a", display: "flex", alignItems: "center", gap: "8px" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2699\uFE0F" }),
		        "\u7528\u6237\u8BBE\u7F6E"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: sectionStyle, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: titleStyle, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u{1F510}" }),
		          "OTP \u53CC\u56E0\u7D20\u8BA4\u8BC1"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: descStyle, children: "\u542F\u7528\u540E\u767B\u5F55\u9700\u8981\u5BC6\u7801 + \u9A8C\u8BC1\u7801\uFF0C\u63D0\u9AD8\u5B89\u5168\u6027\u3002" }),
		        !otpEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: enableOTP, style: { background: "#52c41a", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }, children: "\u542F\u7528 OTP" }) : !showDisableOtp ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setShowDisableOtp(true), style: { background: "#ff4d4f", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }, children: "\u7981\u7528 OTP" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px", background: "#fafafa", borderRadius: "8px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "0", fontSize: "12px", color: "#666", lineHeight: "1.5" }, children: "\u8F93\u5165\u5F53\u524D 6 \u4F4D\u9A8C\u8BC1\u7801\u6216\u4E00\u4E2A\u672A\u4F7F\u7528\u7684\u5907\u4EFD\u4EE3\u7801\u4EE5\u786E\u8BA4\u7981\u7528\uFF1A" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "text",
		              placeholder: "6\u4F4D\u9A8C\u8BC1\u7801\u6216\u5907\u4EFD\u4EE3\u7801",
		              value: disableOtpCode,
		              onChange: (e) => setDisableOtpCode(e.target.value),
		              style: inputStyle,
		              autoFocus: true,
		              onKeyDown: (e) => {
		                if (e.key === "Enter") disableOTP();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", marginTop: "4px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: disableOTP, disabled: disablingOtp, style: { background: "#ff4d4f", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: disablingOtp ? "not-allowed" : "pointer", opacity: disablingOtp ? 0.6 : 1 }, children: disablingOtp ? "\u7981\u7528\u4E2D..." : "\u786E\u8BA4\u7981\u7528" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => {
		              setShowDisableOtp(false);
		              setDisableOtpCode("");
		            }, style: { background: "transparent", color: "#666", border: "1px solid #d9d9d9", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", cursor: "pointer" }, children: "\u53D6\u6D88" })
		          ] })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: sectionStyle, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: titleStyle, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u{1F511}" }),
		          "\u4FEE\u6539\u5BC6\u7801"
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: descStyle, children: "\u4FEE\u6539\u60A8\u7684\u767B\u5F55\u5BC6\u7801\u3002" }),
		        !showChangePassword ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setShowChangePassword(true), style: { background: "#1677ff", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }, children: "\u4FEE\u6539\u5BC6\u7801" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", background: "#fafafa", borderRadius: "8px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "password", placeholder: "\u5F53\u524D\u5BC6\u7801", value: oldPassword, onChange: (e) => setOldPassword(e.target.value), style: inputStyle }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "password", placeholder: "\u65B0\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF09", value: newPassword, onChange: (e) => setNewPassword(e.target.value), style: inputStyle }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "password", placeholder: "\u786E\u8BA4\u65B0\u5BC6\u7801", value: confirmPassword, onChange: (e) => setConfirmPassword(e.target.value), style: inputStyle }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px", marginTop: "4px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: changePassword, disabled: changingPassword, style: { background: "#1677ff", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: changingPassword ? "not-allowed" : "pointer", opacity: changingPassword ? 0.6 : 1 }, children: changingPassword ? "\u4FEE\u6539\u4E2D..." : "\u786E\u8BA4\u4FEE\u6539" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => {
		              setShowChangePassword(false);
		              setOldPassword("");
		              setNewPassword("");
		              setConfirmPassword("");
		            }, style: { background: "white", color: "#666", border: "1px solid #d9d9d9", borderRadius: "6px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }, children: "\u53D6\u6D88" })
		          ] })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { paddingTop: "4px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        "button",
		        {
		          onClick: logout,
		          style: { background: "white", color: "#ff4d4f", border: "1px solid #ff4d4f", borderRadius: "6px", padding: "7px 15px", fontSize: "13px", fontWeight: "500", cursor: "pointer", transition: "all 0.2s", boxSizing: "border-box" },
		          onMouseEnter: (e) => {
		            e.target.style.background = "#ff4d4f";
		            e.target.style.color = "white";
		          },
		          onMouseLeave: (e) => {
		            e.target.style.background = "white";
		            e.target.style.color = "#ff4d4f";
		          },
		          children: "\u9000\u51FA\u767B\u5F55"
		        }
		      ) }),
		      status && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: "16px", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "500", background: status.type === "success" ? "#f6ffed" : "#fff2f0", border: `1px solid ${status.type === "success" ? "#b7eb8f" : "#ffccc7"}`, color: status.type === "success" ? "#52c41a" : "#ff4d4f" }, children: status.message })
		    ] }),
		    showQRModal && qrData && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 }, onClick: closeQRModal, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: "white", borderRadius: "12px", padding: "24px", maxWidth: "400px", width: "90%", maxHeight: "80vh", overflow: "auto" }, onClick: (e) => e.stopPropagation(), children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600" }, children: "\u8BBE\u7F6E OTP \u9A8C\u8BC1\u5668" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "0 0 16px 0", fontSize: "13px", color: "#666" }, children: "\u4F7F\u7528 Google Authenticator\u3001Authy \u6216\u5176\u4ED6 TOTP \u5E94\u7528\u626B\u63CF\u4EE5\u4E0B\u4E8C\u7EF4\u7801\uFF1A" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { textAlign: "center", margin: "16px 0" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: qrData.svgUrl, alt: "OTP QR Code", style: { border: "1px solid #e8e8e8", borderRadius: "8px", width: "200px", height: "200px" } }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: "500", marginBottom: "8px" }, children: "\u5BC6\u94A5\uFF08\u624B\u52A8\u8F93\u5165\u7528\uFF09\uFF1A" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "8px 12px", background: "#f6f8fa", borderRadius: "6px", fontFamily: "monospace", fontSize: "13px", wordBreak: "break-all" }, children: qrData.secret })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", fontWeight: "500", marginBottom: "8px" }, children: "\u8F93\u5165\u9A8C\u8BC1\u7801\u4EE5\u5B8C\u6210\u8BBE\u7F6E\uFF1A" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          "input",
		          {
		            type: "text",
		            placeholder: digits + "\u4F4D\u9A8C\u8BC1\u7801",
		            maxLength: digits,
		            value: otpCode,
		            onChange: (e) => setOtpCode(e.target.value.replace(/\D/g, "")),
		            style: { border: "1px solid #d9d9d9", borderRadius: "6px", padding: "8px 12px", fontSize: "14px", outline: "none", width: "140px", textAlign: "center", letterSpacing: "6px", fontFamily: "monospace" },
		            onKeyDown: (e) => {
		              if (e.key === "Enter") verifyOTPSetup();
		            }
		          }
		        )
		      ] }),
		      status && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { margin: "12px 0", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", background: status.type === "success" ? "#f6ffed" : "#fff2f0", border: `1px solid ${status.type === "success" ? "#b7eb8f" : "#ffccc7"}`, color: status.type === "success" ? "#52c41a" : "#ff4d4f" }, children: status.message }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: verifyOTPSetup, disabled: verifyingOtp, style: { width: "100%", marginTop: "8px", padding: "10px", background: "#52c41a", color: "white", border: "none", borderRadius: "6px", fontSize: "14px", cursor: verifyingOtp ? "not-allowed" : "pointer", opacity: verifyingOtp ? 0.6 : 1 }, children: verifyingOtp ? "\u9A8C\u8BC1\u4E2D..." : "\u9A8C\u8BC1\u5E76\u542F\u7528" })
		    ] }) })
		  ] });
		}
		var inject = ["slots"];
		function apply(ctx) {
		  const api = {
		    getSettings: async () => (await fetch("/login-api/settings")).json(),
		    enableOtp: async () => (await fetch("/otp/enable", { method: "POST" })).json(),
		    verifyOtpSetup: async (otp) => (await fetch("/otp/verify-setup", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ otp })
		    })).json(),
		    disableOtp: async (payload) => (await fetch("/otp/disable", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify(payload)
		    })).json(),
		    changePassword: async (oldPassword, newPassword) => (await fetch("/login/change", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ oldPassword, newPassword })
		    })).json(),
		    logout: async () => (await fetch("/login/logout", { method: "POST" })).json()
		  };
		  const injected = () => ({ api });
		  ctx.slots.inject("settings.section", () => ctx.slots.register({
		    name: "settings.section",
		    id: "user-settings",
		    order: 20,
		    label: () => "\u7528\u6237\u8BBE\u7F6E",
		    inject: injected
		  }, UserSettingsPanel));
		}
		
		return module.exports;
	}
});

//# sourceMappingURL=index.js.map
