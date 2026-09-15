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

		// client/src/update-notice.js
		function readVersion(data) {
		  return {
		    version: typeof data?.version === "string" ? data.version : "",
		    // Only ever an http(s) URL: the gateway normalizes it (lib/version.js
		    // normalizeRepository), and anything else is dropped rather than rendered
		    // into an href.
		    repository: /^https?:\/\//.test(data?.repository) ? data.repository : "",
		    update: data?.update || {}
		  };
		}
		function failedUpdate(reason) {
		  return { latest: null, updateAvailable: null, checkedAt: null, error: reason };
		}
		function afterCheckAttempt(previous, { data, error } = {}) {
		  if (data?.ok === true) return readVersion(data);
		  return { ...previous || readVersion(null), update: failedUpdate(error ?? "unauthenticated") };
		}
		function updateNotice(update, t, repository) {
		  if (update?.updateAvailable === true) {
		    return {
		      tone: "banner",
		      text: t("about.updateAvailable", { version: update.latest || "" }),
		      href: repository ? repository + "/releases" : ""
		    };
		  }
		  if (update?.updateAvailable === false) {
		    return { tone: "muted", text: t("about.upToDate"), href: "" };
		  }
		  if (typeof update?.error === "string" && update.error !== "") {
		    return { tone: "muted", text: t("about.checkFailed"), href: "" };
		  }
		  return null;
		}

		// client/src/cookie-secure.js
		function cookieSecureState(mode, protocol) {
		  const m = mode === true || mode === false ? mode : "auto";
		  const https = protocol === "https:";
		  if (m === true) return https ? "forced-https" : "forced-http";
		  if (m === false) return "off";
		  return https ? "auto-https" : "auto-http";
		}
		function cookieSecureEffective(state) {
		  return state === "auto-https" || state === "forced-https";
		}

		// client/src/index.jsx
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
		var NS = "dsh-auth-gateway";
		var zh = {
		  "nav": "\u8BA4\u8BC1\u8BBE\u7F6E",
		  "header.desc": "\u7BA1\u7406\u767B\u5F55\u5BC6\u7801\u3001\u53CC\u56E0\u7D20\u8BA4\u8BC1\u4E0E\u767B\u5F55\u4F1A\u8BDD\u3002",
		  "loading": "\u52A0\u8F7D\u4E2D...",
		  "otp.title": "OTP \u53CC\u56E0\u7D20\u8BA4\u8BC1",
		  "otp.enabled": "\u5DF2\u542F\u7528",
		  "otp.disabled": "\u672A\u542F\u7528",
		  "otp.desc": "\u542F\u7528\u540E\u767B\u5F55\u9700\u8981\u5BC6\u7801 + \u9A8C\u8BC1\u7801\uFF1B\u517C\u5BB9 Google Authenticator\u3001Authy \u7B49 TOTP \u5E94\u7528\uFF0C\u5E76\u63D0\u4F9B\u4E00\u6B21\u6027\u5907\u4EFD\u4EE3\u7801\u3002",
		  "otp.enable": "\u542F\u7528 OTP",
		  "otp.disable": "\u7981\u7528 OTP",
		  "otp.disable.confirm": "\u8F93\u5165\u5F53\u524D {digits} \u4F4D\u9A8C\u8BC1\u7801\u6216\u4E00\u4E2A\u672A\u4F7F\u7528\u7684\u5907\u4EFD\u4EE3\u7801\u4EE5\u786E\u8BA4\u7981\u7528\uFF1A",
		  "otp.disable.confirmBtn": "\u786E\u8BA4\u7981\u7528",
		  "otp.disable.progress": "\u7981\u7528\u4E2D...",
		  "otp.codePlaceholder": "\u9A8C\u8BC1\u7801\u6216\u5907\u4EFD\u4EE3\u7801",
		  "password.title": "\u767B\u5F55\u5BC6\u7801",
		  "password.desc": "\u4FEE\u6539\u540E\u6240\u6709\u4F1A\u8BDD\u5C06\u4E0B\u7EBF\uFF0C\u9700\u8981\u91CD\u65B0\u767B\u5F55\u3002",
		  "password.change": "\u4FEE\u6539\u5BC6\u7801",
		  "password.old": "\u5F53\u524D\u5BC6\u7801",
		  "password.new": "\u65B0\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF0C\u542B\u5927\u5C0F\u5199\u5B57\u6BCD\u6216\u7279\u6B8A\u5B57\u7B26\uFF09",
		  "password.confirm": "\u786E\u8BA4\u65B0\u5BC6\u7801",
		  "password.submit": "\u786E\u8BA4\u4FEE\u6539",
		  "password.progress": "\u4FEE\u6539\u4E2D...",
		  "session.title": "\u4F1A\u8BDD\u7BA1\u7406",
		  "session.loggedIn": "\u5DF2\u767B\u5F55",
		  "session.desc": "\u4F1A\u8BDD\u6709\u6548\u671F 30 \u5929\uFF1Bdsh \u91CD\u542F\u540E\u9700\u91CD\u65B0\u767B\u5F55\u3002",
		  "session.logout": "\u9000\u51FA\u767B\u5F55",
		  "cookie.title": "Cookie \u5B89\u5168",
		  "cookie.pill.effective": "Secure \u751F\u6548",
		  "cookie.pill.ineffective": "Secure \u672A\u751F\u6548",
		  "cookie.pill.off": "\u5DF2\u5173\u95ED",
		  "cookie.desc": "Secure \u5C5E\u6027\u53EA\u5141\u8BB8\u6D4F\u89C8\u5668\u7ECF\u52A0\u5BC6\u94FE\u8DEF\uFF08HTTPS\uFF09\u53D1\u9001\u4F1A\u8BDD Cookie\uFF1B\u660E\u6587 HTTP \u4E0B\u5F3A\u5236\u5F00\u542F\u4F1A\u4F7F\u767B\u5F55\u7ACB\u5373\u5931\u6548\u3002",
		  "cookie.state.auto-https": "\u81EA\u52A8\u6A21\u5F0F\uFF1A\u5F53\u524D\u8FDE\u63A5\u4E3A HTTPS\uFF0CSecure \u5DF2\u751F\u6548\u3002",
		  "cookie.state.auto-http": "\u81EA\u52A8\u6A21\u5F0F\uFF1A\u5F53\u524D\u4E3A\u660E\u6587 HTTP\uFF0CSecure \u672A\u751F\u6548\uFF1B\u524D\u7F6E TLS\uFF08\u53CD\u5411\u4EE3\u7406\u6216\u8BC1\u4E66\uFF09\u540E\u81EA\u52A8\u542F\u7528\u3002",
		  "cookie.state.forced-https": "\u5DF2\u5F3A\u5236\u5F00\u542F\uFF1A\u5F53\u524D HTTPS \u8FDE\u63A5\u4E0B Secure \u751F\u6548\u3002",
		  "cookie.state.forced-http": "\u5DF2\u5F3A\u5236\u5F00\u542F\uFF1A\u4F46\u5F53\u524D\u4E3A\u660E\u6587 HTTP\uFF0C\u6D4F\u89C8\u5668\u5C06\u62D2\u7EDD\u4FDD\u5B58 Secure Cookie\uFF0C\u767B\u5F55\u4F1A\u7ACB\u5373\u5931\u6548\u2014\u2014\u8BF7\u5148\u542F\u7528 TLS\uFF0C\u6216\u5C06\u914D\u7F6E\u6539\u56DE auto\u3002",
		  "cookie.state.off": "\u5DF2\u663E\u5F0F\u5173\u95ED\uFF1ACookie \u53EF\u7ECF\u660E\u6587\u94FE\u8DEF\u53D1\u9001\uFF08\u4EC5\u5EFA\u8BAE\u5728\u53EF\u4FE1\u5185\u7F51\u4F7F\u7528\uFF1B\u660E\u6587\u4E0B\u4EFB\u4F55\u76D1\u542C\u8005\u90FD\u80FD\u6355\u83B7\u4F1A\u8BDD\uFF09\u3002",
		  "cookie.configHint": "\u7531\u90E8\u7F72\u914D\u7F6E cookieSecure \u63A7\u5236\uFF08auto / true / false\uFF1B\u5F53\u524D\uFF1A{mode}\uFF09",
		  "cookie.source.panel": "\u6765\u6E90\uFF1A\u9762\u677F\u8BBE\u7F6E\uFF08\u5DF2\u6301\u4E45\u5316\uFF0C\u4F18\u5148\u4E8E\u90E8\u7F72\u914D\u7F6E\uFF1B\u53EF\u201C\u6062\u590D\u4E3A\u90E8\u7F72\u914D\u7F6E\u201D\u64A4\u9500\uFF09",
		  "cookie.source.deployment": "\u6765\u6E90\uFF1A\u90E8\u7F72\u914D\u7F6E",
		  "cookie.edit.mode.auto": "\u81EA\u52A8\uFF08\u8DDF\u968F\u8FDE\u63A5\uFF09",
		  "cookie.edit.mode.true": "\u5F3A\u5236\u5F00\u542F",
		  "cookie.edit.mode.false": "\u5173\u95ED",
		  "cookie.edit.save": "\u4FDD\u5B58",
		  "cookie.edit.saving": "\u4FDD\u5B58\u4E2D...",
		  "cookie.edit.saved": "\u5DF2\u4FDD\u5B58\uFF0C\u65B0\u7B56\u7565\u7ACB\u5373\u751F\u6548",
		  "cookie.edit.restored": "\u5DF2\u6062\u590D\u4E3A\u90E8\u7F72\u914D\u7F6E\uFF0C\u7B56\u7565\u7531\u90E8\u7F72\u914D\u7F6E\u51B3\u5B9A",
		  "cookie.edit.reset": "\u6062\u590D\u4E3A\u90E8\u7F72\u914D\u7F6E",
		  "cookie.edit.failed.invalid-mode": "\u65E0\u6548\u7684\u6A21\u5F0F\u503C",
		  "cookie.edit.failed.storage-unavailable": "\u5F53\u524D\u90E8\u7F72\u4E0D\u652F\u6301\u9762\u677F\u4FEE\u6539\uFF08\u51ED\u636E\u8BB0\u5F55\u670D\u52A1\u4E0D\u53EF\u7528\uFF09",
		  "cookie.edit.failed.storage-failed": "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
		  "cookie.edit.failed.network": "\u7F51\u7EDC\u9519\u8BEF\uFF0C\u672A\u4FDD\u5B58",
		  "cookie.save.warn.force-on-http": "\u5F53\u524D\u5165\u53E3\u975E TLS\uFF1A\u5F3A\u5236\u5F00\u542F\u540E\uFF0C\u7ECF\u6B64\u660E\u6587\u5165\u53E3\u767B\u5F55\u5C06\u7ACB\u5373\u5931\u6548\uFF08\u6D4F\u89C8\u5668\u62D2\u7EDD\u4FDD\u5B58 Secure Cookie\uFF09\u3002\u8BF7\u6539\u7528 HTTPS \u5165\u53E3\u8BBE\u7F6E\uFF0C\u6216\u5148\u4E3A\u7F51\u5173\u524D\u7F6E TLS\uFF08\u53CD\u5411\u4EE3\u7406\u9700\u900F\u4F20 X-Forwarded-Proto: https\uFF09\u3002",
		  "cookie.save.note.secure-leftover": "\u63D0\u793A\uFF1A\u82E5\u6D4F\u89C8\u5668\u6B64\u524D\u7ECF HTTPS \u8BBF\u95EE\u8FC7\u672C\u7F51\u5173\uFF0C\u4ECD\u4FDD\u7559\u7740\u5E26 Secure \u7684\u65E7\u4F1A\u8BDD Cookie\u2014\u2014\u672C\u660E\u6587\u5165\u53E3\u65E0\u6CD5\u8986\u76D6\u5B83\u3002\u8BF7\u6539\u7528 HTTPS \u5165\u53E3\u91CD\u65B0\u6267\u884C\u6B64\u64CD\u4F5C\uFF0C\u6216\u5728\u6D4F\u89C8\u5668\u4E2D\u6E05\u9664\u672C\u7AD9\u70B9 Cookie\u3002",
		  "about.title": "\u5173\u4E8E",
		  "about.version": "\u5F53\u524D\u7248\u672C",
		  "about.unknown": "\u672A\u77E5",
		  "about.repository": "\u4ED3\u5E93",
		  "about.repositoryLink": "GitHub",
		  "about.checking": "\u6B63\u5728\u68C0\u67E5\u66F4\u65B0...",
		  "about.check": "\u68C0\u67E5\u66F4\u65B0",
		  "about.upToDate": "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
		  "about.updateAvailable": "\u53D1\u73B0\u65B0\u7248\u672C v{version}",
		  "about.releaseNotes": "\u67E5\u770B\u66F4\u65B0",
		  "about.checkFailed": "\u6682\u65F6\u65E0\u6CD5\u68C0\u67E5\u66F4\u65B0",
		  "dialog.title": "\u8BBE\u7F6E OTP \u9A8C\u8BC1\u5668",
		  "dialog.desc": "\u4F7F\u7528 Google Authenticator\u3001Authy \u6216\u5176\u4ED6 TOTP \u5E94\u7528\u626B\u63CF\u4EE5\u4E0B\u4E8C\u7EF4\u7801\uFF1A",
		  "dialog.secret": "\u5BC6\u94A5\uFF08\u624B\u52A8\u8F93\u5165\u7528\uFF09",
		  "dialog.code": "\u8F93\u5165\u9A8C\u8BC1\u7801\u4EE5\u5B8C\u6210\u8BBE\u7F6E",
		  "dialog.codePlaceholder": "{digits}\u4F4D\u9A8C\u8BC1\u7801",
		  "dialog.verify": "\u9A8C\u8BC1\u5E76\u542F\u7528",
		  "dialog.verifying": "\u9A8C\u8BC1\u4E2D...",
		  "dialog.cancel": "\u53D6\u6D88",
		  "dialog.enabledDesc": "\u6240\u6709\u4F1A\u8BDD\u5DF2\u4E0B\u7EBF\u3002\u8BF7\u4FDD\u5B58\u4EE5\u4E0B\u4E00\u6B21\u6027\u5907\u4EFD\u4EE3\u7801\uFF08\u6BCF\u4E2A\u53EA\u80FD\u4F7F\u7528\u4E00\u6B21\uFF09\uFF0C\u7136\u540E\u91CD\u65B0\u767B\u5F55\u3002",
		  "dialog.backupCodesTitle": "\u5907\u4EFD\u4EE3\u7801",
		  "dialog.doneBtn": "\u5B8C\u6210\u5E76\u91CD\u65B0\u767B\u5F55",
		  "status.otpEnabled": "OTP \u5DF2\u542F\u7528",
		  "status.otpDisabled": "OTP \u5DF2\u7981\u7528",
		  "status.passwordChanged": "\u5BC6\u7801\u4FEE\u6539\u6210\u529F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55",
		  "error.loadSettings": "\u52A0\u8F7D\u5931\u8D25: {message}",
		  "error.enableOtp": "\u542F\u7528\u5931\u8D25: {message}",
		  "error.disableOtp": "\u7981\u7528\u5931\u8D25: {message}",
		  "error.disableOtpInvalid": "\u9A8C\u8BC1\u7801\u9519\u8BEF\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u4F7F\u7528\u8BA4\u8BC1\u5668\u4E2D\u7684\u6700\u65B0\u9A8C\u8BC1\u7801\u91CD\u8BD5\u3002",
		  "error.verifyOtp": "\u9A8C\u8BC1\u5931\u8D25: {message}",
		  "error.changePassword": "\u4FEE\u6539\u5931\u8D25: {message}",
		  "error.logout": "\u9000\u51FA\u5931\u8D25: {message}",
		  "error.otpCodeMissing": "\u8BF7\u8F93\u5165\u5F53\u524D\u9A8C\u8BC1\u7801\u6216\u5907\u4EFD\u4EE3\u7801",
		  "error.otpCodeLength": "\u8BF7\u8F93\u5165 {digits} \u4F4D\u9A8C\u8BC1\u7801",
		  "error.passwordMismatch": "\u4E24\u6B21\u8F93\u5165\u7684\u5BC6\u7801\u4E0D\u4E00\u81F4",
		  "error.passwordTooShort": "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 8 \u4F4D",
		  "error.unknown": "\u672A\u77E5\u9519\u8BEF",
		  "error.invalidCode": "\u9A8C\u8BC1\u7801\u9519\u8BEF"
		};
		var en = {
		  "nav": "Authentication Settings",
		  "header.desc": "Manage the login password, two-factor authentication and the active session.",
		  "loading": "Loading...",
		  "otp.title": "Two-factor authentication (OTP)",
		  "otp.enabled": "Enabled",
		  "otp.disabled": "Disabled",
		  "otp.desc": "When enabled, login requires a password plus a verification code; works with Google Authenticator, Authy and other TOTP apps, and provides one-time backup codes.",
		  "otp.enable": "Enable OTP",
		  "otp.disable": "Disable OTP",
		  "otp.disable.confirm": "Enter the current {digits}-digit code or an unused backup code to confirm:",
		  "otp.disable.confirmBtn": "Disable",
		  "otp.disable.progress": "Disabling...",
		  "otp.codePlaceholder": "Code or backup code",
		  "password.title": "Login password",
		  "password.desc": "All sessions will be revoked and you will need to sign in again.",
		  "password.change": "Change password",
		  "password.old": "Current password",
		  "password.new": "New password (8+ chars, mixed case or special)",
		  "password.confirm": "Confirm new password",
		  "password.submit": "Update",
		  "password.progress": "Updating...",
		  "session.title": "Session Management",
		  "session.loggedIn": "Signed in",
		  "session.desc": "Sessions last 30 days; a dsh restart signs everyone out.",
		  "session.logout": "Sign out",
		  "cookie.title": "Cookie Security",
		  "cookie.pill.effective": "Secure on",
		  "cookie.pill.ineffective": "Secure off",
		  "cookie.pill.off": "Disabled",
		  "cookie.desc": "The Secure attribute lets the browser send the session cookie over an encrypted (HTTPS) link only; forcing it on a plain-HTTP link breaks the login instead of protecting it.",
		  "cookie.state.auto-https": "Auto mode: this connection is HTTPS, so Secure is in effect.",
		  "cookie.state.auto-http": "Auto mode: this connection is plain HTTP, so Secure is off; it engages automatically once TLS (reverse proxy or certificate) fronts the gateway.",
		  "cookie.state.forced-https": "Forced on: HTTPS connection, Secure is in effect.",
		  "cookie.state.forced-http": "Forced on, but this connection is plain HTTP: the browser will refuse to store the Secure cookie and logins fail immediately \u2014 enable TLS first, or set the config back to auto.",
		  "cookie.state.off": "Explicitly off: the cookie may travel in clear text (trusted LAN only; any listener on the link can capture the session).",
		  "cookie.configHint": "Controlled by the deployment config cookieSecure (auto / true / false; current: {mode})",
		  "cookie.source.panel": "Source: panel override (persisted, takes precedence over the deployment config; \u201CRestore deployment config\u201D undoes it)",
		  "cookie.source.deployment": "Source: deployment config",
		  "cookie.edit.mode.auto": "Auto (follow the connection)",
		  "cookie.edit.mode.true": "Force on",
		  "cookie.edit.mode.false": "Off",
		  "cookie.edit.save": "Save",
		  "cookie.edit.saving": "Saving...",
		  "cookie.edit.saved": "Saved \u2014 the new policy applies immediately",
		  "cookie.edit.restored": "Restored \u2014 the deployment config rules again",
		  "cookie.edit.reset": "Restore deployment config",
		  "cookie.edit.failed.invalid-mode": "Invalid mode value",
		  "cookie.edit.failed.storage-unavailable": "This deployment cannot store panel changes (credential-record service unavailable)",
		  "cookie.edit.failed.storage-failed": "Save failed \u2014 retry later",
		  "cookie.edit.failed.network": "Network error \u2014 not saved",
		  "cookie.save.warn.force-on-http": "This entry is not TLS: forcing Secure on breaks logins over this plaintext entry (browsers refuse to store Secure cookies). Use an HTTPS entry instead, or front the gateway with TLS (a reverse proxy must forward X-Forwarded-Proto: https).",
		  "cookie.save.note.secure-leftover": "Note: if this browser previously reached the gateway over HTTPS, a Secure session cookie may still be stored \u2014 a plaintext entry cannot overwrite it. Repeat this change from an HTTPS entry, or clear this site's cookies in the browser.",
		  "about.title": "About",
		  "about.version": "Current version",
		  "about.unknown": "unknown",
		  "about.repository": "Repository",
		  "about.repositoryLink": "GitHub",
		  "about.checking": "Checking for updates...",
		  "about.check": "Check for updates",
		  "about.upToDate": "Up to date",
		  "about.updateAvailable": "New version v{version} available",
		  "about.releaseNotes": "View release",
		  "about.checkFailed": "Update check unavailable",
		  "dialog.title": "Set up OTP authenticator",
		  "dialog.desc": "Scan the QR code with Google Authenticator, Authy or another TOTP app:",
		  "dialog.secret": "Secret key (for manual entry)",
		  "dialog.code": "Enter the code to finish setup",
		  "dialog.codePlaceholder": "{digits}-digit code",
		  "dialog.verify": "Verify & enable",
		  "dialog.verifying": "Verifying...",
		  "dialog.cancel": "Cancel",
		  "dialog.enabledDesc": "All sessions were signed out. Save these one-time backup codes (each can be used once), then sign in again.",
		  "dialog.backupCodesTitle": "Backup codes",
		  "dialog.doneBtn": "Done \u2014 sign in again",
		  "status.otpEnabled": "OTP enabled",
		  "status.otpDisabled": "OTP disabled",
		  "status.passwordChanged": "Password updated \u2014 please sign in again",
		  "error.loadSettings": "Failed to load: {message}",
		  "error.enableOtp": "Failed to enable: {message}",
		  "error.disableOtp": "Failed to disable: {message}",
		  "error.disableOtpInvalid": "Invalid or expired code \u2014 use the latest code from your authenticator and try again.",
		  "error.verifyOtp": "Verification failed: {message}",
		  "error.changePassword": "Failed to update: {message}",
		  "error.logout": "Failed to sign out: {message}",
		  "error.otpCodeMissing": "Enter the current code or a backup code",
		  "error.otpCodeLength": "Enter the {digits}-digit code",
		  "error.passwordMismatch": "Passwords do not match",
		  "error.passwordTooShort": "Password must be at least 8 characters",
		  "error.unknown": "Unknown error",
		  "error.invalidCode": "Invalid code"
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
		var COOKIE_SECURE_FAILURE_CODES = {
		  "invalid-mode": "invalid-mode",
		  "storage-unavailable": "storage-unavailable",
		  "storage-failed": "storage-failed"
		};
		function Pill({ children, tone = "neutral" }) {
		  const toneStyle = tone === "success" ? { color: T.success, background: T.successBg } : tone === "warn" ? { color: T.danger, background: T.dangerSoft } : { color: T.textSecondary, background: T.hover };
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
		function UserSettingsPanel({ api, t }) {
		  const [otpEnabled, setOtpEnabled] = (0, import_react.useState)(false);
		  const [digits, setDigits] = (0, import_react.useState)(6);
		  const [loading, setLoading] = (0, import_react.useState)(true);
		  const [status, setStatus] = (0, import_react.useState)(null);
		  const [showQRModal, setShowQRModal] = (0, import_react.useState)(false);
		  const [qrData, setQrData] = (0, import_react.useState)(null);
		  const [cookieSecure, setCookieSecure] = (0, import_react.useState)("auto");
		  const [cookieSecureSource, setCookieSecureSource] = (0, import_react.useState)("deployment");
		  const [cookieSecureDraft, setCookieSecureDraft] = (0, import_react.useState)(null);
		  const [savingCookieSecure, setSavingCookieSecure] = (0, import_react.useState)(false);
		  const [cookieSecureHint, setCookieSecureHint] = (0, import_react.useState)(null);
		  const [cookieSecureRequestSecure, setCookieSecureRequestSecure] = (0, import_react.useState)(false);
		  const [isHttps] = (0, import_react.useState)(() => typeof window !== "undefined" && window.location.protocol === "https:");
		  const [setupDone, setSetupDone] = (0, import_react.useState)(false);
		  const [backupCodes, setBackupCodes] = (0, import_react.useState)([]);
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
		  const [versionInfo, setVersionInfo] = (0, import_react.useState)(null);
		  const [checkingUpdate, setCheckingUpdate] = (0, import_react.useState)(false);
		  (0, import_react.useEffect)(() => {
		    loadSettings();
		    loadVersion();
		  }, []);
		  async function loadVersion() {
		    try {
		      const data = await api.getVersion();
		      setVersionInfo(readVersion(data?.ok ? data : null));
		    } catch {
		      setVersionInfo(readVersion(null));
		    }
		  }
		  async function checkForUpdates() {
		    setCheckingUpdate(true);
		    try {
		      const data = await api.checkForUpdates();
		      setVersionInfo((prev) => afterCheckAttempt(prev, data?.ok ? { data } : { error: "unauthenticated" }));
		    } catch (err) {
		      setVersionInfo((prev) => afterCheckAttempt(prev, { error: err?.message || "network" }));
		    } finally {
		      setCheckingUpdate(false);
		    }
		  }
		  async function saveCookieSecure() {
		    if (cookieSecureDraft === true && !cookieSecureRequestSecure) {
		      setCookieSecureHint({ tone: "warn", text: t("cookie.save.warn.force-on-http") });
		      return;
		    }
		    setSavingCookieSecure(true);
		    setCookieSecureHint(null);
		    try {
		      const data = await api.setCookieSecure(cookieSecureDraft);
		      if (data?.ok === true) {
		        const mode = data.cookieSecure === true || data.cookieSecure === false ? data.cookieSecure : "auto";
		        setCookieSecure(mode);
		        setCookieSecureSource(data.cookieSecureSource === "panel" ? "panel" : "deployment");
		        setCookieSecureDraft(null);
		        const leftover = mode !== true && !cookieSecureRequestSecure ? " " + t("cookie.save.note.secure-leftover") : "";
		        setCookieSecureHint({ tone: "success", text: t("cookie.edit.saved") + leftover });
		      } else {
		        const code = COOKIE_SECURE_FAILURE_CODES[data?.error] ?? "network";
		        setCookieSecureHint({ tone: "warn", text: t(`cookie.edit.failed.${code}`) });
		      }
		    } catch {
		      setCookieSecureHint({ tone: "warn", text: t("cookie.edit.failed.network") });
		    } finally {
		      setSavingCookieSecure(false);
		    }
		  }
		  async function resetCookieSecure() {
		    setSavingCookieSecure(true);
		    setCookieSecureHint(null);
		    try {
		      const data = await api.resetCookieSecure();
		      if (data?.ok === true) {
		        const mode = data.cookieSecure === true || data.cookieSecure === false ? data.cookieSecure : "auto";
		        setCookieSecure(mode);
		        setCookieSecureSource(data.cookieSecureSource === "panel" ? "panel" : "deployment");
		        setCookieSecureDraft(null);
		        const leftover = mode !== true && !cookieSecureRequestSecure ? " " + t("cookie.save.note.secure-leftover") : "";
		        setCookieSecureHint({ tone: "success", text: t("cookie.edit.restored") + leftover });
		      } else {
		        setCookieSecureHint({ tone: "warn", text: t("cookie.edit.failed.network") });
		      }
		    } catch {
		      setCookieSecureHint({ tone: "warn", text: t("cookie.edit.failed.network") });
		    } finally {
		      setSavingCookieSecure(false);
		    }
		  }
		  async function loadSettings() {
		    try {
		      const data = await api.getSettings();
		      if (data.ok) {
		        const cfg = data.config?.["dsh-auth-gateway"] || {};
		        setOtpEnabled(cfg.otpEnabled || false);
		        setDigits(cfg.otpDigits || 6);
		        const mode = cfg.cookieSecure === true || cfg.cookieSecure === false ? cfg.cookieSecure : "auto";
		        setCookieSecure(mode);
		        setCookieSecureSource(cfg.cookieSecureSource === "panel" ? "panel" : "deployment");
		        setCookieSecureRequestSecure(cfg.requestSecure === void 0 ? isHttps : cfg.requestSecure === true);
		        setCookieSecureDraft(null);
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.loadSettings", { message: err.message }) });
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
		        setStatus({ type: "error", message: t("error.enableOtp", { message: data.error || t("error.unknown") }) });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.enableOtp", { message: err.message }) });
		    }
		  }
		  async function disableOTP() {
		    setStatus(null);
		    const code = disableOtpCode.trim();
		    if (!code) {
		      setStatus({ type: "error", message: t("error.otpCodeMissing") });
		      return;
		    }
		    const isDigits = new RegExp("^\\d{" + digits + "}$").test(code);
		    const body = isDigits ? { otp: code } : { backupCode: code };
		    setDisablingOtp(true);
		    try {
		      const data = await api.disableOtp(body);
		      if (data.ok) {
		        setStatus({ type: "success", message: t("status.otpDisabled") });
		        setOtpEnabled(false);
		        setShowDisableOtp(false);
		        setDisableOtpCode("");
		      } else {
		        const message = data.error === "invalid-otp" ? t("error.disableOtpInvalid") : t("error.disableOtp", { message: data.error || t("error.unknown") });
		        setStatus({ type: "error", message });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.disableOtp", { message: err.message }) });
		    } finally {
		      setDisablingOtp(false);
		    }
		  }
		  function closeQRModal() {
		    setShowQRModal(false);
		    setQrData(null);
		    setOtpCode("");
		    setVerifyingOtp(false);
		    setSetupDone(false);
		    setBackupCodes([]);
		    setStatus(null);
		  }
		  async function verifyOTPSetup() {
		    if (otpCode.length !== digits) {
		      setStatus({ type: "error", message: t("error.otpCodeLength", { digits }) });
		      return;
		    }
		    setVerifyingOtp(true);
		    setStatus(null);
		    try {
		      const data = await api.verifyOtpSetup(otpCode);
		      if (data.ok) {
		        setOtpEnabled(true);
		        setBackupCodes(data.backupCodes || []);
		        setSetupDone(true);
		        setOtpCode("");
		      } else {
		        setStatus({ type: "error", message: t("error.verifyOtp", { message: data.error || t("error.invalidCode") }) });
		      }
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.verifyOtp", { message: err.message }) });
		    } finally {
		      setVerifyingOtp(false);
		    }
		  }
		  async function changePassword() {
		    if (newPassword !== confirmPassword) {
		      setStatus({ type: "error", message: t("error.passwordMismatch") });
		      return;
		    }
		    if (newPassword.length < 8) {
		      setStatus({ type: "error", message: t("error.passwordTooShort") });
		      return;
		    }
		    setChangingPassword(true);
		    setStatus(null);
		    try {
		      const data = await api.changePassword(oldPassword, newPassword);
		      if (data.ok) {
		        setStatus({ type: "success", message: t("status.passwordChanged") });
		        setShowChangePassword(false);
		        setOldPassword("");
		        setNewPassword("");
		        setConfirmPassword("");
		        setTimeout(() => {
		          location.href = BASE + "/login";
		        }, 1500);
		      } else setStatus({ type: "error", message: t("error.changePassword", { message: data.error || t("error.unknown") }) });
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.changePassword", { message: err.message }) });
		    } finally {
		      setChangingPassword(false);
		    }
		  }
		  async function logout() {
		    try {
		      await api.logout();
		      location.href = BASE + "/login";
		    } catch (err) {
		      setStatus({ type: "error", message: t("error.logout", { message: err.message }) });
		    }
		  }
		  if (loading) {
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "24px 0", fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: t("loading") });
		  }
		  const notice = updateNotice(versionInfo?.update, t, versionInfo?.repository ?? "");
		  const secureState = cookieSecureState(cookieSecure, isHttps ? "https:" : "http:");
		  const secureEffective = cookieSecureEffective(secureState);
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
		        t("nav"),
		        versionInfo !== null && versionInfo.version !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: {
		          fontSize: "12px",
		          lineHeight: "18px",
		          padding: "0 8px",
		          borderRadius: "9px",
		          background: T.hover,
		          color: T.textSecondary,
		          fontWeight: 400
		        }, children: [
		          "v",
		          versionInfo.version
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: "0 0 16px" }, children: t("header.desc") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: CARD_TITLE, children: [
		            "\u{1F510} ",
		            t("otp.title")
		          ] }),
		          otpEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { tone: "success", children: t("otp.enabled") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { children: t("otp.disabled") })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: DESC, children: t("otp.desc") }),
		        !otpEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: enableOTP, children: t("otp.enable") }) : !showDisableOtp ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "dangerOutline", onClick: () => setShowDisableOtp(true), children: t("otp.disable") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		          display: "flex",
		          flexDirection: "column",
		          gap: "10px",
		          padding: "12px",
		          background: T.bg2,
		          borderRadius: "10px",
		          border: `1px solid ${T.border}`
		        }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: t("otp.disable.confirm", { digits }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "input",
		            {
		              type: "text",
		              placeholder: t("otp.codePlaceholder"),
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
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "danger", onClick: disableOTP, disabled: disablingOtp, children: disablingOtp ? t("otp.disable.progress") : t("otp.disable.confirmBtn") }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: () => {
		              setShowDisableOtp(false);
		              setDisableOtpCode("");
		            }, children: t("dialog.cancel") })
		          ] })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		        display: "flex",
		        gap: "12px",
		        flexWrap: "wrap",
		        alignItems: "stretch",
		        marginBottom: "12px"
		      }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		          flex: "1 1 0",
		          minWidth: "200px",
		          display: "flex",
		          flexDirection: "column",
		          border: `1px solid ${T.border}`,
		          borderRadius: "10px",
		          padding: "12px"
		        }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: CARD_TITLE, children: [
		            "\u{1F511} ",
		            t("password.title")
		          ] }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: "0 0 10px" }, children: t("password.desc") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: "auto", paddingTop: "8px" }, children: !showChangePassword ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: () => setShowChangePassword(true), children: t("password.change") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
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
		                placeholder: t("password.old"),
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
		                placeholder: t("password.new"),
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
		                placeholder: t("password.confirm"),
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
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: changePassword, disabled: changingPassword, children: changingPassword ? t("password.progress") : t("password.submit") }),
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: () => {
		                setShowChangePassword(false);
		                setOldPassword("");
		                setNewPassword("");
		                setConfirmPassword("");
		              }, children: t("dialog.cancel") })
		            ] })
		          ] }) })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		          flex: "1 1 0",
		          minWidth: "200px",
		          display: "flex",
		          flexDirection: "column",
		          border: `1px solid ${T.border}`,
		          borderRadius: "10px",
		          padding: "12px"
		        }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: CARD_TITLE, children: [
		              "\u{1F512} ",
		              t("session.title")
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { children: t("session.loggedIn") })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: "0 0 10px" }, children: t("session.desc") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: "auto", paddingTop: "8px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "dangerOutline", onClick: logout, children: t("session.logout") }) })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: CARD_TITLE, children: [
		            "\u{1F6E1}\uFE0F ",
		            t("cookie.title")
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, { tone: secureEffective ? "success" : secureState === "auto-http" ? "neutral" : "warn", children: secureEffective ? t("cookie.pill.effective") : secureState === "off" ? t("cookie.pill.off") : t("cookie.pill.ineffective") })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: DESC, children: t("cookie.desc") }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: 0 }, children: t(`cookie.state.${secureState}`) }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { margin: "8px 0 0", fontSize: "12px", lineHeight: "18px", color: T.textTertiary }, children: [
		          t("cookie.configHint", { mode: String(cookieSecure) }),
		          " \xB7 ",
		          cookieSecureSource === "panel" ? t("cookie.source.panel") : t("cookie.source.deployment")
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		            "select",
		            {
		              value: String(cookieSecureDraft ?? cookieSecure),
		              onChange: (e) => {
		                const v = e.target.value;
		                setCookieSecureDraft(v === "true" ? true : v === "false" ? false : "auto");
		              },
		              style: {
		                height: "32px",
		                padding: "0 10px",
		                borderRadius: "8px",
		                border: `1px solid ${T.border}`,
		                background: T.bg1,
		                color: T.textPrimary,
		                fontSize: "13px",
		                lineHeight: "20px",
		                fontFamily: "inherit",
		                cursor: "pointer",
		                outline: "none",
		                minWidth: "150px"
		              },
		              children: [
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "auto", children: t("cookie.edit.mode.auto") }),
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "true", children: t("cookie.edit.mode.true") }),
		                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "false", children: t("cookie.edit.mode.false") })
		              ]
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: saveCookieSecure, disabled: savingCookieSecure || cookieSecureDraft === null || cookieSecureDraft === cookieSecure, children: savingCookieSecure ? t("cookie.edit.saving") : t("cookie.edit.save") }),
		          cookieSecureSource === "panel" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: resetCookieSecure, disabled: savingCookieSecure, children: t("cookie.edit.reset") }),
		          cookieSecureHint !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
		            fontSize: "12px",
		            lineHeight: "18px",
		            color: cookieSecureHint.tone === "warn" ? T.danger : T.textSecondary
		          }, children: cookieSecureHint.text })
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: CARD, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: CARD_TITLE, children: [
		          "\u2139\uFE0F ",
		          t("about.title")
		        ] }) }),
		        versionInfo === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: 0 }, children: t("about.checking") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: "13px", lineHeight: "20px" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: T.textSecondary }, children: [
		              t("about.version"),
		              " ",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: T.textPrimary, fontFamily: T.fontCode }, children: versionInfo.version === "" ? t("about.unknown") : "v" + versionInfo.version })
		            ] }),
		            versionInfo.repository !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: T.textSecondary }, children: [
		              t("about.repository"),
		              " ",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		                "a",
		                {
		                  href: versionInfo.repository,
		                  target: "_blank",
		                  rel: "noopener noreferrer",
		                  style: { color: T.brand, textDecoration: "none" },
		                  children: t("about.repositoryLink")
		                }
		              )
		            ] })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: "12px" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: checkForUpdates, disabled: checkingUpdate, children: checkingUpdate ? t("about.checking") : t("about.check") }) }),
		          !checkingUpdate && notice !== null && (notice.tone === "banner" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		            marginTop: "12px",
		            padding: "10px 14px",
		            borderRadius: "10px",
		            fontSize: "13px",
		            lineHeight: "20px",
		            background: T.successBg,
		            color: T.success
		          }, children: [
		            notice.text,
		            notice.href !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		              " ",
		              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		                "a",
		                {
		                  href: notice.href,
		                  target: "_blank",
		                  rel: "noopener noreferrer",
		                  style: { color: T.success, textDecoration: "underline" },
		                  children: t("about.releaseNotes")
		                }
		              )
		            ] })
		          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...DESC, margin: "10px 0 0" }, children: notice.text }))
		        ] })
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
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 500, color: T.textPrimary }, children: t("dialog.title") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "ghost", onClick: closeQRModal, style: { height: "28px", width: "28px", padding: 0, borderRadius: "8px" }, children: "\u2715" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "0 24px" }, children: setupDone ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
		            margin: "8px 0 16px",
		            padding: "10px 12px",
		            borderRadius: "10px",
		            fontSize: "13px",
		            lineHeight: "20px",
		            color: T.success,
		            background: T.successBg,
		            border: `1px solid ${T.border}`
		          }, children: [
		            t("status.otpEnabled"),
		            " \u2014 ",
		            t("dialog.enabledDesc")
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }, children: t("dialog.backupCodesTitle") }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
		              padding: "8px 12px",
		              background: T.bg1,
		              border: `1px solid ${T.border}`,
		              borderRadius: "8px",
		              fontFamily: T.fontCode,
		              fontSize: "13px",
		              lineHeight: "22px",
		              color: T.textPrimary
		            }, children: backupCodes.join("\n") })
		          ] })
		        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "8px 0 16px", fontSize: "13px", lineHeight: "20px", color: T.textSecondary }, children: t("dialog.desc") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { textAlign: "center", margin: "16px 0" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: qrData.svgUrl, alt: "OTP QR Code", style: { border: `1px solid ${T.border}`, borderRadius: "8px", width: "200px", height: "200px" } }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { margin: "16px 0" }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }, children: t("dialog.secret") }),
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
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: T.textSecondary, marginBottom: "6px" }, children: t("dialog.code") }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		              "input",
		              {
		                type: "text",
		                placeholder: t("dialog.codePlaceholder", { digits }),
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
		        ] }) }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 24px 24px", marginTop: "20px" }, children: setupDone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: () => {
		          location.href = BASE + "/login";
		        }, children: t("dialog.doneBtn") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: closeQRModal, children: t("dialog.cancel") }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", onClick: verifyOTPSetup, disabled: verifyingOtp, children: verifyingOtp ? t("dialog.verifying") : t("dialog.verify") })
		        ] }) })
		      ] })
		    ] })
		  ] });
		}
		var inject = ["slots", "locale", "connection"];
		function installLanTrust(ctx) {
		  if (typeof location === "undefined" || !location.hostname) return;
		  const hn = location.hostname;
		  const loopback = hn === "localhost" || hn === "127.0.0.1" || hn === "::1" || hn === "[::1]" || hn === "0.0.0.0";
		  if (loopback) return;
		  let handle;
		  try {
		    handle = ctx.connection;
		  } catch {
		    return;
		  }
		  if (!handle || Object.getOwnPropertyDescriptor(handle, "isLoopback")?.get) return;
		  Object.defineProperty(handle, "isLoopback", {
		    get: () => true,
		    set: () => {
		    },
		    configurable: true,
		    enumerable: true
		  });
		}
		var BASE = typeof window !== "undefined" && window.__dshAuthGatewayBasePath__ || "";
		function apply(ctx) {
		  installLanTrust(ctx);
		  ctx.locale.register(NS, { zh, en });
		  const t = ctx.locale.bind(NS);
		  const api = {
		    getSettings: async () => (await fetch(BASE + "/login-api/settings")).json(),
		    getVersion: async () => (await fetch(BASE + "/login-api/version")).json(),
		    // Explicit on-demand check: the only path that makes the gateway contact
		    // the registry when automatic checks are off (the default).
		    checkForUpdates: async () => (await fetch(BASE + "/login-api/version?refresh=1")).json(),
		    enableOtp: async () => (await fetch(BASE + "/otp/enable", { method: "POST" })).json(),
		    verifyOtpSetup: async (otp) => (await fetch(BASE + "/otp/verify-setup", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ otp })
		    })).json(),
		    disableOtp: async (payload) => (await fetch(BASE + "/otp/disable", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify(payload)
		    })).json(),
		    changePassword: async (oldPassword, newPassword) => (await fetch(BASE + "/login/change", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ oldPassword, newPassword })
		    })).json(),
		    setCookieSecure: async (mode) => (await fetch(BASE + "/login-api/cookie-secure", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ mode })
		    })).json(),
		    resetCookieSecure: async () => (await fetch(BASE + "/login-api/cookie-secure", {
		      method: "POST",
		      headers: { "content-type": "application/json" },
		      body: JSON.stringify({ reset: true })
		    })).json(),
		    logout: async () => (await fetch(BASE + "/login/logout", { method: "POST" })).json()
		  };
		  const injected = () => ({ api });
		  ctx.slots.inject("settings.section", () => ctx.slots.register({
		    name: "settings.section",
		    id: "user-settings",
		    order: 100,
		    label: () => t("nav"),
		    locale: NS,
		    inject: injected
		  }, UserSettingsPanel));
		}

		return module.exports;
	}
});

//# sourceMappingURL=index.js.map
