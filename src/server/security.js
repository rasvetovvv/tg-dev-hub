import crypto from "node:crypto";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64url(input) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqualHex(a, b) {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function createSessionToken(user, secret, ttlSec = 60 * 60 * 24 * 7) {
  const payload = {
    sub: user.id,
    telegramId: String(user.telegram_id),
    exp: Math.floor(Date.now() / 1000) + ttlSec
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token, secret) {
  if (!token || !token.includes(".")) {
    throw new Error("Invalid session token");
  }

  const [encoded, signature] = token.split(".");
  if (!safeEqualHex(sign(encoded, secret), signature)) {
    throw new Error("Invalid session signature");
  }

  const payload = JSON.parse(fromBase64url(encoded).toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Session expired");
  }

  return payload;
}

export function verifyTelegramInitData(initData, botToken, maxAgeSec) {
  if (!botToken) {
    throw new Error("BOT_TOKEN is required for Telegram auth");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  if (!hash) {
    throw new Error("Telegram hash is missing");
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(calculatedHash, hash)) {
    throw new Error("Telegram signature mismatch");
  }

  const authDate = Number.parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    throw new Error("Telegram auth data is too old");
  }

  const userJson = params.get("user");
  if (!userJson) {
    throw new Error("Telegram user payload is missing");
  }

  return JSON.parse(userJson);
}

export function toPublicUser(user, config) {
  const telegramId = String(user.telegram_id);

  return {
    id: user.id,
    telegramId,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    username: user.username || "",
    photoUrl: user.photo_url || "",
    isVerified: Boolean(user.is_verified),
    isTrusted: Boolean(user.is_trusted),
    isTopSeller: Boolean(user.is_top_seller),
    isBanned: Boolean(user.is_banned),
    isAdmin: isAdminTelegramId(user, config)
  };
}

export function isAdminTelegramId(user, config) {
  const telegramId = String(user?.telegram_id || user?.telegramId || "");
  const isDevFallbackAdmin =
    config.nodeEnv !== "production" &&
    config.allowDevAuth &&
    config.adminTelegramIds.size === 0 &&
    telegramId === "100000001";

  return config.adminTelegramIds.has(telegramId) || isDevFallbackAdmin;
}
