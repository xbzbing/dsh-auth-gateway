window.__ModuleLoader__.load({
	id: "dsh-auth-gateway",
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
		var T = {
		  bg1: "var(--dsw-alias-bg-layer-1)",
		  bg2: "var(--dsw-alias-bg-layer-2)",
		  border: "var(--dsw-alias-border-l2)",
		  textPrimary: "var(--dsw-alias-label-primary)",
		  textSecondary: "var(--dsw-alias-label-secondary)",
		  textTertiary: "var(--dsw-alias-label-tertiary)",
		  brand: "var(--dsw-alias-brand-primary)",
		  primaryFill: "var(--dsw-alias-button-primary-fill)",
		  primaryHover: "var(--dsw-alias-button-primary-hover)",
		  primaryForeground: "var(--dsw-alias-label-primary-foreground)",
		  hover: "var(--dsw-alias-interactive-bg-hover)",
		  hoverDanger: "var(--dsw-alias-interactive-bg-hover-danger)",
		  danger: "var(--dsw-alias-state-error-primary)",
		  dangerSoft: "var(--dsw-alias-state-error-secondary)",
		  success: "var(--dsw-alias-state-success-primary)",
		  successBg: "var(--dsw-alias-state-success-tertiary)",
		  shadow3: "var(--dsw-shadow-lv3)",
		  mask1: "var(--dsw-alias-bg-mask-1)",
		  maskBlur: "var(--dsw-mask-blur)",
		  fontCode: "var(--ds-font-family-code)"
		};
		var CARD = {
		  background: T.bg1,
		  border: `1px solid ${T.border}`,
		  borderRadius: "12px",
		  padding: "16px",
		  marginBottom: "12px"
		};
		var CARD_TITLE = {
		  fontSize: "14px",
		  lineHeight: "22px",
		  fontWeight: 500,
		  color: T.textPrimary
		};
		var DESC = {
		  margin: "0 0 12px",
		  fontSize: "13px",
		  lineHeight: "20px",
		  color: T.textSecondary
		};
		var INPUT = {
		  height: "32px",
		  padding: "0 12px",
		  borderRadius: "8px",
		  border: `1px solid ${T.border}`,
		  background: T.bg1,
		  color: T.textPrimary,
		  fontSize: "14px",
		  lineHeight: "22px",
		  outline: "none",
		  width: "100%",
		  boxSizing: "border-box",
		  fontFamily: "inherit",
		  transition: "border-color .15s ease"
		};
		var focusProps = {
		  onFocus: (e) => {
		    e.currentTarget.style.borderColor = T.brand;
		  },
		  onBlur: (e) => {
		    e.currentTarget.style.borderColor = "";
		  }
		};
		function Button({ variant = "primary", disabled, onClick, children, full, style }) {
		  const kinds = {
		    primary: { background: T.primaryFill, color: T.primaryForeground, hover: T.primaryHover },
		    ghost: { background: "transparent", color: T.textPrimary, hover: T.hover },
		    outline: { background: "transparent", color: T.textPrimary, hover: T.hover, border: `1px solid ${T.border}` },
		    danger: { background: T.danger, color: "#fff", hover: T.dangerSoft },
		    dangerOutline: { background: "transparent", color: T.danger, hover: T.hoverDanger, border: `1px solid ${T.danger}` }
		  };
		  const k = kinds[variant];
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		    "button",
		    {
		      type: "button",
		      disabled,
		      onClick,
		      onMouseEnter: (e) => {
		        if (!disabled) e.currentTarget.style.background = k.hover;
		      },
		      onMouseLeave: (e) => {
		        if (!disabled) e.currentTarget.style.background = k.background;
		      },
		      style: {
		        display: "inline-flex",
		        alignItems: "center",
		        justifyContent: "center",
		        gap: "6px",
		        height: "32px",
		        padding: "0 14px",
		        borderRadius: "8px",
		        fontSize: "13px",
		        lineHeight: "20px",
		        fontWeight: 500,
		        cursor: disabled ? "not-allowed" : "pointer",
		        border: "none",
		        fontFamily: "inherit",
		        boxSizing: "border-box",
		        transition: "background .15s ease",
		        ...k,
		        ...full ? { width: "100%" } : {},
		        ...disabled ? { opacity: 0.5 } : {},
		        ...style
		      },
		      children
		    }
		  );
		}
		function Pill({ children, tone = "neutral" }) {
		  const toneStyle = tone === "success" ? { color: T.success, background: T.successBg } : { color: T.textSecondary, background: T.hover };
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
		    display: "inline-flex",
		    alignItems: "center",
		    height: "22px",
		    padding: "0 10px",
		    borderRadius: "11px",
		    fontSize: "12px",
		    lineHeight: "18px",
		    ...toneStyle
		  }, children });
		}
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
		        const cfg = data.config?.["dsh-auth-gateway"] || {};
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
		    const isDigits = new RegExp("^\\d{" + digits + "}$").test(code);
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
		  if (loading) {
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "24px 0", fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: "\u52A0\u8F7D\u4E2D..." });
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { paddingTop: "4px" }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { style: {
		        margin: "0 0 4px",
		        fontSize: "16px",
		        lineHeight: "24px",
		        fontWeight: 500,
		        color: T.textPrimary,
		        display: "flex",
		        alignItems: "center",
		        gap: "8px"
		      }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2699\uFE0F" }),
		        "\u8BA4\u8BC1\u8BBE\u7F6E"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: "0 0 16px" }, children: "\u7BA1\u7406\u767B\u5F55\u5BC6\u7801\u3001\u53CC\u56E0\u7D20\u8BA4\u8BC1\u4E0E\u767B\u5F55\u4F1A\u8BDD\u3002" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: CARD_TITLE, children: "\u{1F510} OTP \u53CC\u56E0\u7D20\u8BA4\u8BC1" }),
		          otpEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { tone: "success", children: "\u5DF2\u542F\u7528" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { children: "\u672A\u542F\u7528" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: DESC, children: "\u542F\u7528\u540E\u767B\u5F55\u9700\u8981\u5BC6\u7801 + \u9A8C\u8BC1\u7801\uFF1B\u517C\u5BB9 Google Authenticator\u3001Authy \u7B49 TOTP \u5E94\u7528\uFF0C\u5E76\u63D0\u4F9B\u4E00\u6B21\u6027\u5907\u4EFD\u4EE3\u7801\u3002" }),
		        !otpEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: enableOTP, children: "\u542F\u7528 OTP" }) : !showDisableOtp ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "dangerOutline", onClick: () => setShowDisableOtp(true), children: "\u7981\u7528 OTP" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		          display: "flex",
		          flexDirection: "column",
		          gap: "10px",
		          padding: "12px",
		          background: T.bg2,
		          borderRadius: "10px",
		          border: `1px solid ${T.border}`
		        }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { margin: 0, fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: [
		            "\u8F93\u5165\u5F53\u524D ",
		            digits,
		            " \u4F4D\u9A8C\u8BC1\u7801\u6216\u4E00\u4E2A\u672A\u4F7F\u7528\u7684\u5907\u4EFD\u4EE3\u7801\u4EE5\u786E\u8BA4\u7981\u7528\uFF1A"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "text",
		              placeholder: "\u9A8C\u8BC1\u7801\u6216\u5907\u4EFD\u4EE3\u7801",
		              value: disableOtpCode,
		              onChange: (e) => setDisableOtpCode(e.target.value),
		              style: INPUT,
		              autoFocus: true,
		              ...focusProps,
		              onKeyDown: (e) => {
		                if (e.key === "Enter") disableOTP();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "danger", onClick: disableOTP, disabled: disablingOtp, children: disablingOtp ? "\u7981\u7528\u4E2D..." : "\u786E\u8BA4\u7981\u7528" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: () => {
		              setShowDisableOtp(false);
		              setDisableOtpCode("");
		            }, children: "\u53D6\u6D88" })
		          ] })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: CARD_TITLE, children: "\u{1F511} \u767B\u5F55\u5BC6\u7801" }) }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: DESC, children: "\u4FEE\u6539\u540E\u6240\u6709\u4F1A\u8BDD\u5C06\u4E0B\u7EBF\uFF0C\u9700\u8981\u91CD\u65B0\u767B\u5F55\u3002" }),
		        !showChangePassword ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: () => setShowChangePassword(true), children: "\u4FEE\u6539\u5BC6\u7801" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		          display: "flex",
		          flexDirection: "column",
		          gap: "10px",
		          padding: "12px",
		          background: T.bg2,
		          borderRadius: "10px",
		          border: `1px solid ${T.border}`
		        }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "password",
		              placeholder: "\u5F53\u524D\u5BC6\u7801",
		              value: oldPassword,
		              onChange: (e) => setOldPassword(e.target.value),
		              style: INPUT,
		              ...focusProps
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "password",
		              placeholder: "\u65B0\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF0C\u542B\u5927\u5C0F\u5199\u5B57\u6BCD\u6216\u7279\u6B8A\u5B57\u7B26\uFF09",
		              value: newPassword,
		              onChange: (e) => setNewPassword(e.target.value),
		              style: INPUT,
		              ...focusProps
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "password",
		              placeholder: "\u786E\u8BA4\u65B0\u5BC6\u7801",
		              value: confirmPassword,
		              onChange: (e) => setConfirmPassword(e.target.value),
		              style: INPUT,
		              ...focusProps,
		              onKeyDown: (e) => {
		                if (e.key === "Enter") changePassword();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: changePassword, disabled: changingPassword, children: changingPassword ? "\u4FEE\u6539\u4E2D..." : "\u786E\u8BA4\u4FEE\u6539" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: () => {
		              setShowChangePassword(false);
		              setOldPassword("");
		              setNewPassword("");
		              setConfirmPassword("");
		            }, children: "\u53D6\u6D88" })
		          ] })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: CARD_TITLE, children: "\u{1F512} \u767B\u5F55\u4F1A\u8BDD" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { children: "\u5DF2\u767B\u5F55" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: DESC, children: "\u4F1A\u8BDD\u6709\u6548\u671F 30 \u5929\uFF1Bdsh \u91CD\u542F\u540E\u9700\u91CD\u65B0\u767B\u5F55\u3002" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "dangerOutline", onClick: logout, children: "\u9000\u51FA\u767B\u5F55" })
		      ] }),
		      status && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
		        marginTop: "12px",
		        padding: "10px 14px",
		        borderRadius: "10px",
		        fontSize: "13px",
		        lineHeight: "20px",
		        background: status.type === "success" ? T.successBg : T.hoverDanger,
		        color: status.type === "success" ? T.success : T.danger
		      }, children: status.message })
		    ] }),
		    showQRModal && qrData && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		      position: "fixed",
		      inset: 0,
		      zIndex: 1e3,
		      display: "flex",
		      alignItems: "center",
		      justifyContent: "center",
		      padding: "24px"
		    }, onClick: closeQRModal, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "absolute", inset: 0, background: T.mask1, backdropFilter: T.maskBlur } }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		        position: "relative",
		        boxSizing: "border-box",
		        background: T.bg2,
		        borderRadius: "24px",
		        boxShadow: T.shadow3,
		        border: `1px solid ${T.border}`,
		        width: "min(400px, 100%)",
		        maxHeight: "calc(100vh - 48px)",
		        overflow: "auto"
		      }, onClick: (e) => e.stopPropagation(), children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "20px 24px 4px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 500, color: T.textPrimary }, children: "\u8BBE\u7F6E OTP \u9A8C\u8BC1\u5668" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", onClick: closeQRModal, style: { height: "28px", width: "28px", padding: 0, borderRadius: "8px" }, children: "\u2715" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "0 24px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "8px 0 16px", fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: "\u4F7F\u7528 Google Authenticator\u3001Authy \u6216\u5176\u4ED6 TOTP \u5E94\u7528\u626B\u63CF\u4EE5\u4E0B\u4E8C\u7EF4\u7801\uFF1A" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { textAlign: "center", margin: "16px 0" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: qrData.svgUrl, alt: "OTP QR Code", style: { border: `1px solid ${T.border}`, borderRadius: "8px", width: "200px", height: "200px" } }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }, children: "\u5BC6\u94A5\uFF08\u624B\u52A8\u8F93\u5165\u7528\uFF09" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
		              padding: "8px 12px",
		              background: T.bg1,
		              border: `1px solid ${T.border}`,
		              borderRadius: "8px",
		              fontFamily: T.fontCode,
		              fontSize: "13px",
		              lineHeight: "20px",
		              color: T.textPrimary,
		              wordBreak: "break-all"
		            }, children: qrData.secret })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }, children: "\u8F93\u5165\u9A8C\u8BC1\u7801\u4EE5\u5B8C\u6210\u8BBE\u7F6E" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		              "input",
		              {
		                type: "text",
		                placeholder: digits + "\u4F4D\u9A8C\u8BC1\u7801",
		                maxLength: digits,
		                value: otpCode,
		                onChange: (e) => setOtpCode(e.target.value.replace(/\D/g, "")),
		                style: { ...INPUT, width: "140px", textAlign: "center", letterSpacing: "6px", fontFamily: T.fontCode },
		                ...focusProps,
		                onKeyDown: (e) => {
		                  if (e.key === "Enter") verifyOTPSetup();
		                }
		              }
		            )
		          ] }),
		          status && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
		            margin: "12px 0",
		            padding: "8px 12px",
		            borderRadius: "8px",
		            fontSize: "12px",
		            lineHeight: "18px",
		            background: status.type === "success" ? T.successBg : T.hoverDanger,
		            color: status.type === "success" ? T.success : T.danger
		          }, children: status.message })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 24px", marginTop: "20px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: closeQRModal, children: "\u53D6\u6D88" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: verifyOTPSetup, disabled: verifyingOtp, children: verifyingOtp ? "\u9A8C\u8BC1\u4E2D..." : "\u9A8C\u8BC1\u5E76\u542F\u7528" })
		        ] })
		      ] })
		    ] })
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
		    label: () => "\u8BA4\u8BC1\u8BBE\u7F6E",
		    inject: injected
		  }, UserSettingsPanel));
		}
		
		return module.exports;
	}
});

//# sourceMappingURL=index.js.map
