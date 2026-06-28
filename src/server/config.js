import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const rootDir = process.cwd();
const port = Number.parseInt(process.env.PORT || "7870", 10);
const maxUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB || "100", 10);
const botUsername = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const subscriptionStars = Number.parseInt(process.env.SUBSCRIPTION_STARS || "499", 10);
const vipStars = Number.parseInt(process.env.VIP_STARS || "1990", 10);

function splitIds(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  rootDir,
  nodeEnv: process.env.NODE_ENV || "development",
  port,
  botToken: process.env.BOT_TOKEN || "",
  botUsername,
  botAppName: process.env.BOT_APP_NAME || "",
  webAppUrl:
    process.env.WEBAPP_URL ||
    process.env.PUBLIC_URL ||
    `http://localhost:${port}`,
  sessionSecret:
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "dev-only-change-me-before-production"),
  adminTelegramIds: new Set(splitIds(process.env.ADMIN_TELEGRAM_IDS)),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || "data/app.sqlite"),
  uploadsDir: path.resolve(rootDir, process.env.UPLOADS_DIR || "data/uploads"),
  maxUploadMb,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  allowDevAuth:
    process.env.ALLOW_DEV_AUTH === "true" ||
    (process.env.NODE_ENV || "development") !== "production",
  telegramAuthMaxAgeSec: Number.parseInt(
    process.env.TELEGRAM_AUTH_MAX_AGE_SEC || "86400",
    10
  ),
  // Monetization
  freeDailyDownloadLimit: Number.parseInt(
    process.env.FREE_DAILY_DOWNLOAD_LIMIT || "5",
    10
  ),
  subscriptionDays: Number.parseInt(process.env.SUBSCRIPTION_DAYS || "30", 10),
  subscriptionStars,
  subscriptionPriceLabel: `${Math.max(1, subscriptionStars || 0)} Stars`,
  vipDays: Number.parseInt(process.env.VIP_DAYS || "0", 10),
  vipStars,
  vipPriceLabel: `${Math.max(1, vipStars || 0)} Stars`,
  // When a payment provider is not wired, checkout grants access instantly
  // (test mode) instead of creating a pending order for manual confirmation.
  allowTestCheckout:
    process.env.ALLOW_TEST_CHECKOUT === "true" ||
    (process.env.NODE_ENV || "development") !== "production"
};

export function validateProductionConfig() {
  if (config.nodeEnv !== "production") {
    return;
  }

  const missing = [];
  if (!config.botToken) missing.push("BOT_TOKEN");
  if (!config.botUsername) missing.push("BOT_USERNAME");
  if (!config.sessionSecret) missing.push("SESSION_SECRET");
  if (!config.webAppUrl.startsWith("https://")) missing.push("WEBAPP_URL=https://...");
  if (config.adminTelegramIds.size === 0) missing.push("ADMIN_TELEGRAM_IDS");

  if (missing.length > 0) {
    throw new Error(`Missing production config: ${missing.join(", ")}`);
  }
}
