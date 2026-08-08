const express = require("express");
const crypto = require("crypto");
const userRepository = require("./database/userRepository");
const { sendUserLoginCode } = require("./emailManager");
const { buildAlertFromSearch } = require("./userAlertSearchBuilder");
const {
  recordConsumerClickwrap
} = require("./legalAcceptanceService");

const router = express.Router();
const SESSION_COOKIE = "nextappt_user_session";
const LOGIN_CODE_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;
const LOGIN_CODE_MIN_INTERVAL_SECONDS = 60;
const LOGIN_CODE_MAX_PER_HOUR = 5;

function cleanEmail(value = "") {
  return userRepository.normalizeEmail(value);
}

function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeLoginCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function makeCodeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashLoginCode(code, salt) {
  return crypto.scryptSync(String(code), String(salt), 32).toString("hex");
}

function safeCompareHex(left, right) {
  try {
    const a = Buffer.from(String(left), "hex");
    const b = Buffer.from(String(right), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  return raw.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getSessionToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return parseCookies(req)[SESSION_COOKIE] || "";
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  );
  const secure =
    process.env.NODE_ENV === "production" || process.env.RENDER === "true"
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure =
    process.env.NODE_ENV === "production" || process.env.RENDER === "true"
      ? "; Secure"
      : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function requireUser(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: "Sign in required." });
    }

    const tokenHash = hashSessionToken(token);
    const user = await userRepository.getUserBySessionTokenHash(tokenHash);

    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ success: false, error: "Session expired. Please sign in again." });
    }

    req.user = user;
    req.userSessionTokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
}

router.post("/auth/request-code", async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const source = String(req.body?.source || "account").trim().slice(0, 120) || "account";

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: "Please enter a valid email." });
    }

    const user = await userRepository.captureEmail({ email, source });

    if (user.status === "disabled") {
      return res.status(403).json({ success: false, error: "This account is disabled." });
    }

    const rateState = await userRepository.getLoginCodeRateState(user.id);
    const lastSentAt = rateState.lastSentAt ? new Date(rateState.lastSentAt).getTime() : 0;
    const secondsSinceLast = lastSentAt ? Math.floor((Date.now() - lastSentAt) / 1000) : null;

    if (secondsSinceLast !== null && secondsSinceLast < LOGIN_CODE_MIN_INTERVAL_SECONDS) {
      return res.status(429).json({
        success: false,
        error: `Please wait ${LOGIN_CODE_MIN_INTERVAL_SECONDS - secondsSinceLast} seconds before requesting another code.`
      });
    }

    if (Number(rateState.hourCount || 0) >= LOGIN_CODE_MAX_PER_HOUR) {
      return res.status(429).json({
        success: false,
        error: "Too many login codes requested. Please try again later."
      });
    }

    const code = makeLoginCode();
    const codeSalt = makeCodeSalt();
    const codeHash = hashLoginCode(code, codeSalt);
    const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MINUTES * 60 * 1000);

    const loginCode = await userRepository.createLoginCode({
      userId: user.id,
      codeHash,
      codeSalt,
      expiresAt
    });

    try {
      await sendUserLoginCode({
        to: email,
        code,
        expiresAt
      });
    } catch (error) {
      await userRepository.invalidateLoginCode(loginCode.id);
      throw error;
    }

    res.json({
      success: true,
      message: "Login code sent.",
      expiresAt
    });
  } catch (error) {
    console.error("[USER AUTH REQUEST CODE]", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/auth/verify-code", async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Enter your email and 6-digit code." });
    }

    const user = await userRepository.getUserByEmail(email);
    if (!user || user.status === "disabled") {
      return res.status(400).json({ success: false, error: "Invalid or expired login code." });
    }

    const loginCode = await userRepository.getActiveLoginCode(user.id);
    if (!loginCode) {
      return res.status(400).json({ success: false, error: "Invalid or expired login code." });
    }

    const submittedHash = hashLoginCode(code, loginCode.codeSalt);
    const valid = safeCompareHex(submittedHash, loginCode.codeHash);

    if (!valid) {
      const attempt = await userRepository.incrementLoginCodeAttempt(loginCode.id);
      const locked = Number(attempt?.attemptCount || 0) >= 5;
      return res.status(400).json({
        success: false,
        error: locked
          ? "Too many incorrect attempts. Request a new login code."
          : "Invalid or expired login code."
      });
    }

    await recordConsumerClickwrap(req, user);

    const activeUser = await userRepository.activateUserWithCode({
      userId: user.id,
      loginCodeId: loginCode.id
    });

    const token = makeSessionToken();
    const tokenHash = hashSessionToken(token);
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await userRepository.createSession({
      userId: activeUser.id,
      tokenHash,
      expiresAt: sessionExpiresAt
    });

    setSessionCookie(res, token, sessionExpiresAt);

    const preferences = await userRepository.getPreferences(activeUser.id);

    res.json({
      success: true,
      user: activeUser,
      preferences,
      sessionExpiresAt
    });
  } catch (error) {
    console.error("[USER AUTH VERIFY CODE]", error);
    res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message });
  }
});

router.post("/auth/logout", async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      await userRepository.deleteSessionByTokenHash(hashSessionToken(token));
    }
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/me", requireUser, async (req, res) => {
  try {
    const [preferences, alerts] = await Promise.all([
      userRepository.getPreferences(req.user.id),
      userRepository.listAlertsForUser(req.user.id)
    ]);

    res.json({
      success: true,
      user: req.user,
      preferences,
      alerts
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/profile", requireUser, async (req, res) => {
  try {
    const user = await userRepository.updateProfile(req.user.id, {
      firstName: req.body?.firstName
    });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/preferences", requireUser, async (req, res) => {
  try {
    const preferences = await userRepository.updatePreferences(req.user.id, {
      appointmentAlertsEnabled: req.body?.appointmentAlertsEnabled,
      productUpdatesEnabled: req.body?.productUpdatesEnabled,
      marketingEnabled: req.body?.marketingEnabled
    });
    res.json({ success: true, preferences });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/alerts", requireUser, async (req, res) => {
  try {
    const alerts = await userRepository.listAlertsForUser(req.user.id);
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/alerts/from-search", requireUser, async (req, res) => {
  try {
    const alertPayload = buildAlertFromSearch(req.body || {});

    if (
      !alertPayload.metro &&
      !alertPayload.categorySlug &&
      !alertPayload.filters?.search
    ) {
      return res.status(400).json({
        success: false,
        error: "Add a city, appointment category, or search request before saving an alert."
      });
    }

    const alert = await userRepository.createAlert(
      req.user.id,
      alertPayload
    );

    res.status(201).json({
      success: true,
      alert,
      message: "Appointment alert saved."
    });
  } catch (error) {
    console.error("[USER ALERT FROM SEARCH]", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/alerts", requireUser, async (req, res) => {
  try {
    const alert = await userRepository.createAlert(req.user.id, req.body || {});
    res.status(201).json({ success: true, alert });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.patch("/alerts/:id", requireUser, async (req, res) => {
  try {
    const status = req.body?.status;
    if (!["active", "paused"].includes(status)) {
      return res.status(400).json({ success: false, error: "Status must be active or paused." });
    }

    const updated = await userRepository.setAlertStatus(req.user.id, req.params.id, status);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Alert not found." });
    }

    const alerts = await userRepository.listAlertsForUser(req.user.id);
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/alerts/:id", requireUser, async (req, res) => {
  try {
    const deleted = await userRepository.deleteAlert(req.user.id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Alert not found." });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;