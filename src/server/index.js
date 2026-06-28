import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { Telegraf } from "telegraf";

import { config, validateProductionConfig } from "./config.js";
import {
  notificationKeyboard,
  registerBotCommands,
  setBotCommandMenu
} from "./botCommands.js";
import {
  addProjectFiles,
  addProjectScreenshots,
  addFavorite,
  addReview,
  archiveProject,
  createBroadcastNotifications,
  createAuthorProjectNotification,
  createAuthorReport,
  createNewProjectNotifications,
  createProject,
  createReport,
  deleteProjectScreenshot,
  deleteProjectExtraFile,
  deleteProjectVersion,
  deleteReview,
  getProjectExtraFile,
  getProjectById,
  getProjectBySlug,
  getProjectFile,
  getStats,
  getPublicUserProfile,
  getUserById,
  hasBlockedProjectFiles,
  initDatabase,
  listAdminDownloads,
  listAdminProjects,
  listAdminReports,
  listAdminReviews,
  listAdminUsers,
  listProjectFavoriteUsers,
  listDownloads,
  listFilterOptions,
  listUserOwnedProjects,
  listNotifications,
  listProjects,
  markNotificationRead,
  publishProjectVersion,
  recordDownload,
  recordProjectView,
  removeFavorite,
  setProjectPinned,
  setProjectWeeklyPick,
  setProjectSeasonalSale,
  setProjectExtraFileHidden,
  setProjectStatus,
  setProjectVersionHidden,
  setReportStatus,
  setReviewStatus,
  setUserBanned,
  setUserBadges,
  setUserVerified,
  updateProjectExtraFileReview,
  updateProjectVersionReview,
  updateProject,
  upsertTelegramUser
} from "./db.js";
import {
  buyVip,
  completeStarsPayload,
  confirmPurchase,
  createCustomRequest,
  createPromoCode,
  deactivatePromoCode,
  enrichProject,
  enrichProjects,
  evaluateDownloadAccess,
  getAccountState,
  grantByTelegramId,
  initMonetization,
  listCustomRequests,
  listPromoCodes,
  listPurchases,
  listUserPurchases,
  listUserRequests,
  purchaseProject,
  redeemPromo,
  setCustomRequestStatus,
  setProjectAccessTier,
  subscribe
} from "./monetization.js";
import { prepareUploadedFile, prepareUploadedFiles } from "./fileSecurity.js";
import {
  createSessionToken,
  isAdminTelegramId,
  toPublicUser,
  verifySessionToken,
  verifyTelegramInitData
} from "./security.js";
import {
  createStoredFilename,
  ensureRuntimeDirs,
  removeFileIfExists,
  resolveUploadPath,
  screenshotMimeTypes
} from "./storage.js";

validateProductionConfig();
ensureRuntimeDirs(config);
initDatabase(config);
initMonetization();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../dist/client");
const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(
  "/uploads/screenshots",
  express.static(path.join(config.uploadsDir, "screenshots"), {
    maxAge: config.nodeEnv === "production" ? "7d" : 0
  })
);
app.use(
  "/uploads/signatures",
  express.static(path.join(config.uploadsDir, "signatures"), {
    maxAge: config.nodeEnv === "production" ? "7d" : 0
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const folder = file.fieldname === "screenshots" ? "screenshots" : "packages";
      cb(null, path.join(config.uploadsDir, folder));
    },
    filename(req, file, cb) {
      cb(null, createStoredFilename(file.originalname));
    }
  }),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 16
  },
  fileFilter(req, file, cb) {
    if (file.fieldname === "screenshots" && !screenshotMimeTypes.has(file.mimetype)) {
      cb(new Error("Screenshots must be PNG, JPG, WEBP, or GIF"));
      return;
    }
    cb(null, true);
  }
});

function readToken(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  return req.query.token || "";
}

function requireAuth(req, res, next) {
  try {
    const payload = verifySessionToken(readToken(req), config.sessionSecret);
    const user = getUserById(payload.sub);

    if (!user) {
      res.status(401).json({ error: "User was not found" });
      return;
    }

    req.user = user;
    req.publicUser = toPublicUser(user, config);

    if (user.is_banned && !req.publicUser.isAdmin) {
      res.status(403).json({
        error: user.ban_reason || "Your account is banned"
      });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: "Auth required" });
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminTelegramId(req.user, config)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  req.publicUser = { ...req.publicUser, isAdmin: true };
  next();
}

function isAutoApprovedAuthor(user) {
  return Boolean(user?.is_verified || user?.is_trusted || user?.is_top_seller);
}

function isProjectOwner(user, project) {
  return Boolean(project?.createdBy?.id && Number(project.createdBy.id) === Number(user?.id));
}

function canEditProject(user, project) {
  return isAdminTelegramId(user, config) || isProjectOwner(user, project);
}

function requireProjectEditor(req, res, next) {
  const project = getProjectById(req.params.id, req.user.id, { includeHidden: true });
  if (!project) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }
  if (!canEditProject(req.user, project)) {
    res.status(403).json({ error: "Only the project author or admin can edit this project." });
    return;
  }
  req.project = project;
  req.isProjectAdmin = isAdminTelegramId(req.user, config);
  next();
}

function ownerReviewStatus(user, project) {
  if (isAdminTelegramId(user, config) || isAutoApprovedAuthor(user)) return project.status || "published";
  return "pending";
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    }
  } catch {
    // FormData usually sends comma-separated text.
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `project-${Date.now()}`;
}

function valueOrExisting(body, key, existing, existingKey = key) {
  return body[key] === undefined ? existing?.[existingKey] || "" : body[key];
}

function parseProjectPayload(body, existing = null) {
  const title = String(valueOrExisting(body, "title", existing) || "").trim();
  if (title.length < 2) {
    const error = new Error("Title is required");
    error.status = 400;
    throw error;
  }

  const licenseType = String(valueOrExisting(body, "licenseType", existing) || "free").trim();
  const status = String(valueOrExisting(body, "status", existing) || "published").trim();
  const priceCents = Math.max(
    0,
    Number.parseInt(valueOrExisting(body, "priceCents", existing) || "0", 10) || 0
  );
  const tierFallback = existing?.accessTier || existing?.access_tier || (priceCents > 0 ? "paid" : "free");
  const accessTierRaw = String(valueOrExisting(body, "accessTier", existing, "accessTier") || tierFallback).trim();
  const normalizedAccessTier = ["free", "paid", "subscription", "vip"].includes(accessTierRaw)
    ? accessTierRaw
    : tierFallback;

  return {
    accessTier: normalizedAccessTier === "free" && priceCents > 0 ? "paid" : normalizedAccessTier,
    title,
    slug: slugify(valueOrExisting(body, "slug", existing) || title),
    summary: String(valueOrExisting(body, "summary", existing) || "").trim(),
    description: String(valueOrExisting(body, "description", existing) || "").trim(),
    changelog: String(valueOrExisting(body, "changelog", existing) || "").trim(),
    installation: String(valueOrExisting(body, "installation", existing) || "").trim(),
    requirements: String(valueOrExisting(body, "requirements", existing) || "").trim(),
    nodeVersion: String(valueOrExisting(body, "nodeVersion", existing) || "").trim(),
    pythonVersion: String(valueOrExisting(body, "pythonVersion", existing) || "").trim(),
    osSupport: String(valueOrExisting(body, "osSupport", existing) || "").trim(),
    runExamples: String(valueOrExisting(body, "runExamples", existing) || "").trim(),
    licenseType: ["free", "personal", "commercial"].includes(licenseType)
      ? licenseType
      : "free",
    status: ["draft", "pending", "published", "hidden", "archived"].includes(status)
      ? status
      : "published",
    codePreview: String(valueOrExisting(body, "codePreview", existing) || "").trim(),
    languages: parseList(valueOrExisting(body, "languages", existing)),
    tags: parseList(valueOrExisting(body, "tags", existing)),
    collections: parseList(valueOrExisting(body, "collections", existing)),
    categories: parseList(valueOrExisting(body, "categories", existing)),
    repositoryUrl: String(valueOrExisting(body, "repositoryUrl", existing) || "").trim(),
    demoUrl: String(valueOrExisting(body, "demoUrl", existing) || "").trim(),
    docsUrl: String(valueOrExisting(body, "docsUrl", existing) || "").trim(),
    videoUrl: String(valueOrExisting(body, "videoUrl", existing) || "").trim(),
    version: String(valueOrExisting(body, "version", existing) || "").trim(),
    priceCents,
    priceLabel: ""
  };
}

function parseVersionPayload(body) {
  return {
    version: String(body.version || "").trim(),
    changelog: String(body.changelog || "").trim()
  };
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosDate, dosTime };
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = zipDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildReadme(project) {
  return [
    `# ${project.title}`,
    project.summary || "",
    project.description ? `## Описание\n${project.description}` : "",
    project.installation ? `## Установка\n${project.installation}` : "",
    project.requirements ? `## Требования\n${project.requirements}` : "",
    project.runExamples ? `## Примеры запуска\n${project.runExamples}` : "",
    project.repositoryUrl ? `## GitHub\n${project.repositoryUrl}` : "",
    `## Лицензия\n${project.licenseType || "free"}`
  ].filter(Boolean).join("\n\n");
}

function safeArchiveName(value, fallback = "project") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

// Returns true when the viewer may download; otherwise responds and returns false.
function guardDownloadAccess(req, res, project) {
  enrichProject(req.user.id, project);
  const account = getAccountState(req.user, config);
  const access = evaluateDownloadAccess(req.user, project, account);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.message, reason: access.reason });
    return false;
  }
  return true;
}

function sendProjectDownload(req, res, projectId, versionId = null) {
  const project = getProjectById(projectId, req.user.id);
  if (!project || project.status !== "published" || project.hiddenAt) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }

  if (!guardDownloadAccess(req, res, project)) return;

  const original = getProjectFile(project.id, versionId);
  if (original?.file_path) {
    const filePath = resolveUploadPath(config, original.file_path);
    if (fs.existsSync(filePath)) {
      recordDownload(req.user.id, project.id, original.version_id || versionId || null);
      res.download(filePath, original.file_name || project.fileName || "download");
      return;
    }
  }

  if (!versionId && project.repositoryUrl) {
    recordDownload(req.user.id, project.id, null);
    res.redirect(project.repositoryUrl);
    return;
  }

  res.status(404).json({ error: "No downloadable file or repository URL" });
}

function sendExtraFileDownload(req, res, projectId, fileId) {
  const project = getProjectById(projectId, req.user.id);
  if (!project || project.status !== "published" || project.hiddenAt) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }

  if (!guardDownloadAccess(req, res, project)) return;

  const original = getProjectExtraFile(project.id, fileId);
  if (!original?.file_path) {
    res.status(404).json({ error: "File was not found" });
    return;
  }

  const filePath = resolveUploadPath(config, original.file_path);
  if (fs.existsSync(filePath)) {
    recordDownload(req.user.id, project.id, null, original.file_id);
    res.download(filePath, original.file_name || "download");
    return;
  }

  res.status(404).json({ error: "File is missing on disk" });
}

function sendAutoArchiveDownload(req, res, projectId) {
  const project = getProjectById(projectId, req.user.id, { includeHidden: false });
  if (!project || project.status !== "published" || project.hiddenAt) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }

  if (!guardDownloadAccess(req, res, project)) return;

  const entries = [
    { name: "README.md", data: buildReadme(project) },
    { name: "LICENSE.txt", data: `${project.licenseType || "free"}\n` }
  ];
  const original = getProjectFile(project.id, req.query.versionId || null);
  let signatureText = [
    "Dev Hub autoarchive signature",
    `Project: ${project.title}`,
    `Project ID: ${project.id}`,
    `Version: ${project.version || "latest"}`,
    `Generated at: ${new Date().toISOString()}`
  ];

  if (original?.file_path) {
    const filePath = resolveUploadPath(config, original.file_path);
    if (fs.existsSync(filePath)) {
      entries.push({
        name: `source/${safeArchiveName(original.file_name || project.fileName || "source.bin")}`,
        data: fs.readFileSync(filePath)
      });
      signatureText = [
        ...signatureText,
        `Original file: ${original.file_name || project.fileName || ""}`,
        `Stored path: ${original.file_path}`
      ];
    }
  }

  if (project.fileSha256) {
    signatureText.push(`SHA-256: ${project.fileSha256}`);
  }
  if (project.fileScanStatus) {
    signatureText.push(`Scan status: ${project.fileScanStatus}`);
  }

  entries.push({ name: "SIGNATURE.txt", data: `${signatureText.join("\n")}\n` });

  const archive = buildZip(entries);
  recordDownload(req.user.id, project.id, original?.version_id || req.query.versionId || null);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeArchiveName(project.slug || project.title)}-devhub.zip"`
  );
  res.send(archive);
}

async function sendTelegramMessage(telegramId, title, message, extra = {}) {
  if (!config.botToken) return "skipped";

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramId,
      text: [title, message].filter(Boolean).join("\n\n"),
      ...extra
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  }

  return "sent";
}

async function sendTelegramNotifications(users, title, message) {
  let telegramSent = 0;
  let telegramFailed = 0;
  let telegramSkipped = 0;

  for (const user of users) {
    try {
      const status = await sendTelegramMessage(
        user.telegram_id,
        title,
        message,
        notificationKeyboard(config)
      );
      if (status === "sent") telegramSent += 1;
      if (status === "skipped") telegramSkipped += 1;
    } catch (error) {
      telegramFailed += 1;
      console.warn(`Telegram notification to ${user.telegram_id} failed:`, error.message);
    }
  }

  return { telegramSent, telegramFailed, telegramSkipped };
}

async function notifyNewProject(project, creatorId = null) {
  if (!project || project.status !== "published" || project.hiddenAt) {
    return { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 };
  }

  const users = createNewProjectNotifications(project.id, creatorId);
  const telegram = await sendTelegramNotifications(
    users,
    `Новый проект: ${project.title}`,
    project.summary || "В каталоге появился новый проект."
  );

  return { notifications: users.length, ...telegram };
}

async function notifySavedProjectUpdate(project, version, changelog) {
  if (!project) {
    return { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 };
  }

  const users = listProjectFavoriteUsers(project.id);
  const telegram = await sendTelegramNotifications(
    users,
    `Новая версия: ${project.title}`,
    changelog || version || "Сохраненный проект получил обновление."
  );

  return { notifications: users.length, ...telegram };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, stats: getStats(), limits: { maxUploadMb: config.maxUploadMb } });
});

app.post("/api/auth/telegram", (req, res, next) => {
  try {
    const telegramUser = verifyTelegramInitData(
      req.body.initData || "",
      config.botToken,
      config.telegramAuthMaxAgeSec
    );
    const user = upsertTelegramUser(telegramUser);

    res.json({
      token: createSessionToken(user, config.sessionSecret),
      user: toPublicUser(user, config)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/dev", (req, res) => {
  if (!config.allowDevAuth) {
    res.status(403).json({ error: "Dev auth is disabled" });
    return;
  }

  const firstAdminId = [...config.adminTelegramIds][0] || "100000001";
  const user = upsertTelegramUser({
    id: firstAdminId,
    first_name: "Local",
    last_name: "Admin",
    username: "local_admin",
    photo_url: ""
  });

  res.json({
    token: createSessionToken(user, config.sessionSecret),
    user: toPublicUser(user, config)
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    user: req.publicUser,
    stats: getStats(),
    account: getAccountState(req.user, config),
    limits: { maxUploadMb: config.maxUploadMb }
  });
});

app.get("/api/languages", requireAuth, (req, res) => {
  res.json(listFilterOptions());
});

app.get("/api/users/:username", requireAuth, (req, res) => {
  const profile = getPublicUserProfile(req.params.username, req.user.id);
  if (!profile) {
    res.status(404).json({ error: "User was not found" });
    return;
  }
  enrichProjects(req.user.id, profile.projects);
  res.json({ profile });
});

app.post("/api/users/:username/reports", requireAuth, (req, res) => {
  const profile = getPublicUserProfile(req.params.username, req.user.id);
  if (!profile) {
    res.status(404).json({ error: "User was not found" });
    return;
  }
  if (Number(profile.id) === Number(req.user.id)) {
    res.status(400).json({ error: "You cannot report yourself." });
    return;
  }
  const reason = String(req.body.reason || "author").trim();
  const details = String(req.body.details || "").trim();
  createAuthorReport(req.user.id, profile.id, reason, details);
  res.status(201).json({ ok: true });
});

app.get("/api/projects", requireAuth, (req, res) => {
  let projects = listProjects({
    userId: req.user.id,
    search: String(req.query.search || "").trim(),
    language: String(req.query.language || "").trim(),
    tag: String(req.query.tag || "").trim(),
    collection: String(req.query.collection || "").trim(),
    category: String(req.query.category || "").trim(),
    topic: String(req.query.topic || "").trim(),
    price: String(req.query.price || "").trim(),
    license: String(req.query.license || "").trim(),
    date: String(req.query.date || "").trim(),
    sort: String(req.query.sort || "new").trim(),
    favoritesOnly: req.query.favorites === "true"
  });
  enrichProjects(req.user.id, projects);

  const tier = String(req.query.tier || "").trim();
  if (tier) {
    projects = projects.filter((project) => project.accessTier === tier);
  }
  res.json({ projects });
});

app.get("/api/admin/projects", requireAuth, requireAdmin, (req, res) => {
  res.json({ projects: enrichProjects(req.user.id, listAdminProjects(req.user.id)) });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = listAdminUsers().map((user) => {
    return {
      ...user,
      isAdmin: isAdminTelegramId(user, config)
    };
  });
  res.json({ users });
});

app.post("/api/admin/users/:id/ban", requireAuth, requireAdmin, (req, res) => {
  const banned = Boolean(req.body.banned);
  const reason = String(req.body.reason || "").trim();
  const user = setUserBanned(req.params.id, banned, reason);
  if (!user) {
    res.status(404).json({ error: "User was not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/verify", requireAuth, requireAdmin, (req, res) => {
  const user = setUserVerified(req.params.id, Boolean(req.body.verified));
  if (!user) {
    res.status(404).json({ error: "User was not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/badges", requireAuth, requireAdmin, (req, res) => {
  const user = setUserBadges(req.params.id, {
    verified: req.body.verified,
    trusted: req.body.trusted,
    topSeller: req.body.topSeller
  });
  if (!user) {
    res.status(404).json({ error: "User was not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/admin/reviews", requireAuth, requireAdmin, (req, res) => {
  res.json({ reviews: listAdminReviews() });
});

app.get("/api/admin/reports", requireAuth, requireAdmin, (req, res) => {
  res.json({ reports: listAdminReports() });
});

app.post("/api/admin/reports/:id/status", requireAuth, requireAdmin, (req, res) => {
  setReportStatus(req.params.id, String(req.body.status || "new"), String(req.body.subjectType || "project"));
  res.json({ ok: true });
});

app.get("/api/admin/downloads", requireAuth, requireAdmin, (req, res) => {
  res.json({ downloads: listAdminDownloads() });
});

app.post("/api/admin/reviews/:id/status", requireAuth, requireAdmin, (req, res) => {
  setReviewStatus(req.params.id, String(req.body.status || "published"));
  res.json({ ok: true });
});

app.delete("/api/admin/reviews/:id", requireAuth, requireAdmin, (req, res) => {
  deleteReview(req.params.id);
  res.status(204).end();
});

app.post("/api/admin/broadcast", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const message = String(req.body.message || "").trim();
    if (!title || !message) {
      res.status(400).json({ error: "Title and message are required" });
      return;
    }

    const users = createBroadcastNotifications(title, message);
    let telegramSent = 0;
    let telegramFailed = 0;
    let telegramSkipped = 0;

    for (const user of users) {
      try {
        const status = await sendTelegramMessage(user.telegram_id, title, message);
        if (status === "sent") telegramSent += 1;
        if (status === "skipped") telegramSkipped += 1;
      } catch (error) {
        telegramFailed += 1;
        console.warn(`Broadcast to ${user.telegram_id} failed:`, error.message);
      }
    }

    res.json({
      ok: true,
      notifications: users.length,
      telegramSent,
      telegramFailed,
      telegramSkipped
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:slug", requireAuth, (req, res) => {
  const project = getProjectBySlug(req.params.slug, req.user.id);
  if (!project) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }
  recordProjectView(project.id);
  project.viewCount += 1;
  enrichProject(req.user.id, project);
  res.json({ project });
});

app.get("/api/my/projects", requireAuth, (req, res) => {
  res.json({ projects: enrichProjects(req.user.id, listUserOwnedProjects(req.user.id)) });
});

app.post(
  "/api/projects",
  requireAuth,
  requireAdmin,
  upload.fields([
    { name: "package", maxCount: 1 },
    { name: "screenshots", maxCount: 8 },
    { name: "files", maxCount: 8 }
  ]),
  async (req, res, next) => {
    try {
      const payload = parseProjectPayload(req.body);
      prepareUploadedFiles(config, req.files || {}, { projectTitle: payload.title });
      const project = createProject(payload, req.files || {}, req.user.id);
      setProjectAccessTier(project.id, payload.accessTier);
      const savedProject = enrichProject(req.user.id, getProjectById(project.id, req.user.id));
      const notifications = await notifyNewProject(savedProject, req.user.id);
      res.status(201).json({ project: savedProject, notifications });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/submissions/projects",
  requireAuth,
  upload.fields([
    { name: "package", maxCount: 1 },
    { name: "screenshots", maxCount: 8 },
    { name: "files", maxCount: 8 }
  ]),
  (req, res, next) => {
    try {
      const autoApproved = isAutoApprovedAuthor(req.user);
      const payload = {
        ...parseProjectPayload(req.body),
        status: autoApproved ? "published" : "pending"
      };
      prepareUploadedFiles(config, req.files || {}, {
        projectTitle: payload.title,
        projectId: "submission"
      });
      const project = createProject(payload, req.files || {}, req.user.id);
      setProjectAccessTier(project.id, payload.accessTier);
      const savedProject = enrichProject(req.user.id, getProjectById(project.id, req.user.id));
      const notifications = autoApproved
        ? notifyNewProject(savedProject, req.user.id)
        : { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 };
      Promise.resolve(notifications).then((value) => {
        res.status(201).json({ project: savedProject, notifications: value, autoApproved });
      }).catch(next);
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  "/api/projects/:id",
  requireAuth,
  requireProjectEditor,
  upload.fields([
    { name: "package", maxCount: 1 },
    { name: "screenshots", maxCount: 8 },
    { name: "files", maxCount: 8 }
  ]),
  async (req, res, next) => {
    try {
      const existing = getProjectById(req.params.id, req.user.id);
      if (!existing) {
        res.status(404).json({ error: "Project was not found" });
        return;
      }
      const wasPublished = existing.status === "published" && !existing.hiddenAt;

      const payload = parseProjectPayload(req.body, existing);
      if (!req.isProjectAdmin) {
        payload.status = ownerReviewStatus(req.user, existing);
      }
      prepareUploadedFiles(config, req.files || {}, {
        projectId: existing.id,
        projectTitle: payload.title
      });
      const project = updateProject(req.params.id, payload, req.files || {}, req.user.id);
      setProjectAccessTier(req.params.id, payload.accessTier);
      const savedProject = enrichProject(req.user.id, getProjectById(req.params.id, req.user.id));
      const notifications = wasPublished || savedProject.status !== "published"
        ? { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 }
        : await notifyNewProject(savedProject, req.user.id);
      res.json({ project: savedProject, notifications });
    } catch (error) {
      next(error);
    }
  }
);

app.post("/api/projects/:id/status", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const existing = getProjectById(req.params.id, req.user.id);
    const nextStatus = String(req.body.status || "published");
    if (nextStatus === "published" && hasBlockedProjectFiles(req.params.id)) {
      res.status(400).json({ error: "Project has blocked files and cannot be published." });
      return;
    }
    const project = setProjectStatus(req.params.id, nextStatus);
    if (!project) {
      res.status(404).json({ error: "Project was not found" });
      return;
    }
    const wasPublished = existing?.status === "published" && !existing?.hiddenAt;
    const notifications = wasPublished
      ? { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 }
      : await notifyNewProject(project, req.user.id);
    res.json({ project, notifications });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/pin", requireAuth, requireAdmin, (req, res) => {
  const project = setProjectPinned(req.params.id, Boolean(req.body.pinned));
  if (!project) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }
  res.json({ project });
});

app.post("/api/admin/projects/:id/weekly", requireAuth, requireAdmin, (req, res) => {
  const project = setProjectWeeklyPick(req.params.id, Boolean(req.body.picked));
  if (!project) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }
  res.json({ project });
});

app.post("/api/admin/projects/:id/sale", requireAuth, requireAdmin, (req, res) => {
  const project = setProjectSeasonalSale(req.params.id, req.body.percent, req.body.endsAt);
  if (!project) {
    res.status(404).json({ error: "Project was not found" });
    return;
  }
  res.json({ project });
});

app.post("/api/admin/projects/:id/message", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const title = String(req.body.title || "Сообщение от модератора").trim();
    const message = String(req.body.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }
    const target = createAuthorProjectNotification(req.params.id, title, message);
    if (!target) {
      res.status(404).json({ error: "Project author was not found" });
      return;
    }
    const telegramStatus = await sendTelegramMessage(target.telegram_id, title, message);
    res.json({ ok: true, telegramStatus });
  } catch (error) {
    next(error);
  }
});

function parseReviewBody(body) {
  return {
    status: String(body.status || "pending"),
    notes: String(body.notes || "").trim(),
    checklist: {
      opens: Boolean(body.opens),
      readme: Boolean(body.readme),
      license: Boolean(body.license),
      noSecrets: Boolean(body.noSecrets),
      dependencies: Boolean(body.dependencies)
    }
  };
}

app.post("/api/admin/projects/:id/files/:fileId/review", requireAuth, requireAdmin, (req, res) => {
  const project = updateProjectExtraFileReview(req.params.id, req.params.fileId, parseReviewBody(req.body));
  if (!project) {
    res.status(404).json({ error: "File was not found" });
    return;
  }
  res.json({ project });
});

app.post("/api/admin/projects/:id/files/:fileId/hidden", requireAuth, requireAdmin, (req, res) => {
  const project = setProjectExtraFileHidden(req.params.id, req.params.fileId, Boolean(req.body.hidden));
  if (!project) {
    res.status(404).json({ error: "File was not found" });
    return;
  }
  res.json({ project });
});

app.delete("/api/admin/projects/:id/files/:fileId", requireAuth, requireAdmin, (req, res) => {
  const file = deleteProjectExtraFile(req.params.id, req.params.fileId);
  if (!file) {
    res.status(404).json({ error: "File was not found" });
    return;
  }
  removeFileIfExists(config, file.file_path);
  removeFileIfExists(config, file.file_signature_path);
  res.status(204).end();
});

app.post("/api/admin/projects/:id/versions/:versionId/review", requireAuth, requireAdmin, (req, res) => {
  const project = updateProjectVersionReview(req.params.id, req.params.versionId, parseReviewBody(req.body));
  if (!project) {
    res.status(404).json({ error: "Version was not found" });
    return;
  }
  res.json({ project });
});

app.post("/api/admin/projects/:id/versions/:versionId/hidden", requireAuth, requireAdmin, (req, res) => {
  const project = setProjectVersionHidden(req.params.id, req.params.versionId, Boolean(req.body.hidden));
  if (!project) {
    res.status(404).json({ error: "Version was not found" });
    return;
  }
  res.json({ project });
});

app.delete("/api/admin/projects/:id/versions/:versionId", requireAuth, requireAdmin, (req, res) => {
  const version = deleteProjectVersion(req.params.id, req.params.versionId);
  if (!version) {
    res.status(404).json({ error: "Version was not found" });
    return;
  }
  removeFileIfExists(config, version.file_path);
  removeFileIfExists(config, version.file_signature_path);
  res.status(204).end();
});

app.post(
  "/api/projects/:id/files",
  requireAuth,
  requireProjectEditor,
  upload.array("files", 8),
  (req, res, next) => {
    try {
      const project = req.project || getProjectById(req.params.id, req.user.id);
      if (!project) {
        res.status(404).json({ error: "Project was not found" });
        return;
      }

      prepareUploadedFiles(config, req.files || [], {
        projectId: project.id,
        projectTitle: project.title
      });
      const nextProject = addProjectFiles(project.id, req.files || []);
      if (!req.isProjectAdmin && !isAutoApprovedAuthor(req.user)) {
        setProjectStatus(project.id, "pending");
      }
      res.json({ project: enrichProject(req.user.id, getProjectById(project.id, req.user.id)) || nextProject });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/projects/:id/screenshots",
  requireAuth,
  requireProjectEditor,
  upload.array("screenshots", 8),
  (req, res) => {
    const project = req.project || getProjectById(req.params.id, req.user.id);
    if (!project) {
      res.status(404).json({ error: "Project was not found" });
      return;
    }

    const nextProject = addProjectScreenshots(project.id, req.files || []);
    if (!req.isProjectAdmin && !isAutoApprovedAuthor(req.user)) {
      setProjectStatus(project.id, "pending");
    }
    res.json({ project: enrichProject(req.user.id, getProjectById(project.id, req.user.id)) || nextProject });
  }
);

app.delete("/api/projects/:id/screenshots/:screenshotId", requireAuth, requireProjectEditor, (req, res) => {
  const screenshot = deleteProjectScreenshot(req.params.id, req.params.screenshotId);
  if (!screenshot) {
    res.status(404).json({ error: "Screenshot was not found" });
    return;
  }
  removeFileIfExists(config, screenshot.file_path);
  res.status(204).end();
});

app.delete("/api/projects/:id", requireAuth, requireAdmin, (req, res) => {
  archiveProject(req.params.id);
  res.status(204).end();
});

app.post("/api/projects/:id/favorite", requireAuth, (req, res) => {
  addFavorite(req.user.id, req.params.id);
  res.status(204).end();
});

app.delete("/api/projects/:id/favorite", requireAuth, (req, res) => {
  removeFavorite(req.user.id, req.params.id);
  res.status(204).end();
});

app.post("/api/projects/:id/reviews", requireAuth, (req, res, next) => {
  try {
    const rating = Number.parseInt(req.body.rating || "0", 10);
    const comment = String(req.body.comment || "").trim();

    if (rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating must be from 1 to 5" });
      return;
    }

    const project = addReview(req.user.id, req.params.id, rating, comment);
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/reports", requireAuth, (req, res) => {
  const reason = String(req.body.reason || "").trim();
  const details = String(req.body.details || "").trim();

  if (!reason) {
    res.status(400).json({ error: "Report reason is required" });
    return;
  }

  createReport(req.user.id, req.params.id, reason, details);
  res.status(201).json({ ok: true });
});

app.post(
  "/api/projects/:id/version",
  requireAuth,
  requireProjectEditor,
  upload.single("package"),
  async (req, res, next) => {
    try {
      const { version, changelog } = parseVersionPayload(req.body);

      if (!version && !changelog && !req.file) {
        res.status(400).json({ error: "Version, changelog, or file is required" });
        return;
      }

      const existing = req.project || getProjectById(req.params.id, req.user.id);
      if (!existing) {
        res.status(404).json({ error: "Project was not found" });
        return;
      }

      prepareUploadedFile(config, req.file, {
        projectId: existing.id,
        projectTitle: existing.title
      });
      const project = publishProjectVersion(
        req.params.id,
        version,
        changelog,
        req.file,
        req.user.id,
        { notifyFavorites: req.isProjectAdmin || isAutoApprovedAuthor(req.user) }
      );
      if (!req.isProjectAdmin && !isAutoApprovedAuthor(req.user)) {
        setProjectStatus(req.params.id, "pending");
      }
      const visibleProject = getProjectById(req.params.id, req.user.id);
      const notifications = visibleProject?.status === "published"
        ? await notifySavedProjectUpdate(visibleProject, version, changelog)
        : { notifications: 0, telegramSent: 0, telegramFailed: 0, telegramSkipped: 0 };

      res.json({ project: visibleProject || project, notifications });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/downloads", requireAuth, (req, res) => {
  res.json({ downloads: listDownloads(req.user.id) });
});

app.get("/api/notifications", requireAuth, (req, res) => {
  res.json({ notifications: listNotifications(req.user.id) });
});

app.post("/api/notifications/:id/read", requireAuth, (req, res) => {
  markNotificationRead(req.user.id, req.params.id);
  res.status(204).end();
});

app.get("/api/projects/:id/versions/:versionId/download", requireAuth, (req, res) => {
  sendProjectDownload(req, res, req.params.id, req.params.versionId);
});

app.get("/api/projects/:id/files/:fileId/download", requireAuth, (req, res) => {
  sendExtraFileDownload(req, res, req.params.id, req.params.fileId);
});

app.get("/api/projects/:id/archive/download", requireAuth, (req, res) => {
  sendAutoArchiveDownload(req, res, req.params.id);
});

app.get("/api/projects/:id/download", requireAuth, (req, res) => {
  sendProjectDownload(req, res, req.params.id, req.query.versionId || null);
});

/* ---------------- monetization (user) ---------------- */

app.post("/api/projects/:id/purchase", requireAuth, async (req, res, next) => {
  try {
    const result = await purchaseProject(req.user, req.params.id, config);
    if (!result) {
      res.status(404).json({ error: "Project was not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/promo/redeem", requireAuth, (req, res, next) => {
  try {
    res.json(redeemPromo(req.user, req.body.code, config));
  } catch (error) {
    next(error);
  }
});

app.post("/api/subscription", requireAuth, async (req, res, next) => {
  try {
    res.json(await subscribe(req.user, config));
  } catch (error) {
    next(error);
  }
});

app.post("/api/vip", requireAuth, async (req, res, next) => {
  try {
    res.json(await buyVip(req.user, config));
  } catch (error) {
    next(error);
  }
});

app.get("/api/requests", requireAuth, (req, res) => {
  res.json({ requests: listUserRequests(req.user.id) });
});

app.get("/api/purchases", requireAuth, (req, res) => {
  res.json({ purchases: listUserPurchases(req.user.id) });
});

app.post("/api/requests", requireAuth, (req, res, next) => {
  try {
    createCustomRequest({
      userId: req.user.id,
      projectId: req.body.projectId || null,
      type: req.body.type || "custom",
      message: req.body.message,
      budget: req.body.budget,
      contact: req.body.contact
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ---------------- monetization (admin) ---------------- */

app.get("/api/admin/promo", requireAuth, requireAdmin, (req, res) => {
  res.json({ codes: listPromoCodes() });
});

app.post("/api/admin/promo", requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.status(201).json({ code: createPromoCode(req.body) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/promo/:id", requireAuth, requireAdmin, (req, res) => {
  deactivatePromoCode(req.params.id);
  res.status(204).end();
});

app.get("/api/admin/requests", requireAuth, requireAdmin, (req, res) => {
  res.json({ requests: listCustomRequests() });
});

app.post("/api/admin/requests/:id/status", requireAuth, requireAdmin, (req, res) => {
  setCustomRequestStatus(req.params.id, String(req.body.status || "new"));
  res.json({ ok: true });
});

app.get("/api/admin/purchases", requireAuth, requireAdmin, (req, res) => {
  res.json({ purchases: listPurchases() });
});

app.post("/api/admin/purchases/:id/confirm", requireAuth, requireAdmin, (req, res) => {
  confirmPurchase(req.params.id);
  res.json({ ok: true });
});

app.post("/api/admin/grant", requireAuth, requireAdmin, (req, res, next) => {
  try {
    res.json(grantByTelegramId(req.body.telegramId, req.body.kind, req.body.days));
  } catch (error) {
    next(error);
  }
});

function botDeepLink(startParam) {
  if (!config.botUsername) return "";
  const cleanParam = encodeURIComponent(String(startParam || "").replace(/[^a-zA-Z0-9_-]/g, "_"));
  if (config.botAppName) {
    return `https://t.me/${config.botUsername}/${config.botAppName}?startapp=${cleanParam}`;
  }
  return `https://t.me/${config.botUsername}?start=${cleanParam}`;
}

function redirectPublicLink(req, res, next, startParam) {
  const link = botDeepLink(startParam);
  if (!link) {
    next();
    return;
  }
  res.redirect(302, link);
}

app.get("/project/:slug", (req, res, next) => {
  redirectPublicLink(req, res, next, `project_${req.params.slug}`);
});

app.get(/^\/(?!api|uploads|assets|project|favicon\.ico)([A-Za-z0-9_]{3,32})$/, (req, res, next) => {
  redirectPublicLink(req, res, next, `user_${req.params[0]}`);
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `File is larger than ${config.maxUploadMb} MB`
        : error.message;
    res.status(status).json({ error: message });
    return;
  }

  if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
    res.status(409).json({ error: "Project slug already exists" });
    return;
  }

  const status = error.status || 400;
  res.status(status).json({
    error:
      config.nodeEnv === "production"
        ? error.message || "Request failed"
        : error.stack || error.message
  });
});

async function startBot() {
  if (!config.botToken) {
    console.log("BOT_TOKEN is not set; Telegram bot polling is skipped.");
    return;
  }

  const bot = new Telegraf(config.botToken);
  registerBotCommands(bot, config);
  await setBotCommandMenu(bot);
  bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
  bot.on("message", async (ctx, next) => {
    const payment = ctx.message?.successful_payment;
    if (!payment?.invoice_payload) {
      await next();
      return;
    }
    completeStarsPayload(payment.invoice_payload);
    await ctx.reply("Оплата через Telegram Stars прошла успешно. Доступ активирован.");
  });

  if (false) {
  const openKeyboard = Markup.inlineKeyboard([
    [Markup.button.webApp("Открыть Dev Hub", config.webAppUrl)]
  ]);

  bot.start((ctx) =>
    ctx.reply(
      "Dev Hub готов. Открывай каталог проектов через кнопку ниже.",
      openKeyboard
    )
  );
  bot.command("app", (ctx) => ctx.reply("Открыть WebApp:", openKeyboard));
  bot.command("id", (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

  }

  await bot.launch();
  console.log("Telegram bot polling started.");

  const shutdown = () => bot.stop("shutdown");
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  console.log(`WebApp URL: ${config.webAppUrl}`);
});

startBot().catch((error) => {
  console.error("Telegram bot failed to start:", error);
});
