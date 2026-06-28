import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildBotCommandPayload } from "../src/server/botCommands.js";
import { config as appConfig } from "../src/server/config.js";
import {
  getUserByTelegramId as getAppUserByTelegramId,
  initDatabase as initAppDatabase
} from "../src/server/db.js";
import {
  completeStarsPayload,
  initMonetization as initAppMonetization
} from "../src/server/monetization.js";

const baseUrl = "http://localhost:7870";
const rootDir = process.cwd();
const dbPath = path.resolve(rootDir, "data/app.sqlite");
const uploadsDir = path.resolve(rootDir, "data/uploads");
const sessionSecret = process.env.SESSION_SECRET || "dev-only-change-me-before-production";
const stamp = Date.now();
const prefix = `fc-${stamp}`;
const codePrefix = `FC${String(stamp).slice(-8)}`;

const users = {
  main: `${prefix}-user-main`,
  buyer: `${prefix}-user-buyer`,
  promo: `${prefix}-user-promo`,
  subscriber: `${prefix}-user-sub`,
  vip: `${prefix}-user-vip`,
  grant: `${prefix}-user-grant`,
  pending: `${prefix}-user-pending`,
  seller: `${prefix}-user-seller`,
  stars: `${prefix}-user-stars`
};

const slugs = {
  free: `${prefix}-free`,
  paid: `${prefix}-paid`,
  subscription: `${prefix}-subscription`,
  vip: `${prefix}-vip`,
  archive: `${prefix}-archive`,
  blocked: `${prefix}-blocked`,
  submission: `${prefix}-submission`,
  trustedSubmission: `${prefix}-trusted-submission`
};

const results = [];

initAppDatabase(appConfig);
initAppMonetization();

function ok(name, detail = "") {
  results.push({ name, detail });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function createToken(userId, telegramId) {
  const payload = {
    sub: userId,
    telegramId: String(telegramId),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

function openDb() {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function upsertTestUser(telegramId, firstName) {
  const db = openDb();
  db.prepare(
    `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url)
     VALUES (?, ?, '', ?, '')
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       username = excluded.username,
       is_banned = 0,
       ban_reason = '',
       is_vip = 0,
       vip_until = NULL,
       subscription_until = NULL`
  ).run(telegramId, firstName, firstName.toLowerCase().replaceAll(" ", "_"));
  const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  db.close();
  return {
    user,
    token: createToken(user.id, telegramId)
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, payload };
}

async function api(pathname, options = {}, expectedStatus = 200) {
  const { response, payload } = await request(pathname, options);
  assert(
    response.status === expectedStatus,
    `${pathname}: expected HTTP ${expectedStatus}, got ${response.status}: ${
      typeof payload === "object" ? JSON.stringify(payload) : payload
    }`
  );
  return payload;
}

async function expectHttp(pathname, options, expectedStatus) {
  const { response, payload } = await request(pathname, options);
  assert(
    response.status === expectedStatus,
    `${pathname}: expected HTTP ${expectedStatus}, got ${response.status}: ${
      typeof payload === "object" ? JSON.stringify(payload) : payload
    }`
  );
  return payload;
}

function auth(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function jsonAuth(token) {
  return auth(token, { "Content-Type": "application/json" });
}

function projectForm(fields, files = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) form.set(key, value.join(", "));
    else form.set(key, String(value));
  }
  if (files.package) {
    form.append("package", new Blob([files.package.body], { type: files.package.type || "text/plain" }), files.package.name);
  }
  for (const screenshot of files.screenshots || []) {
    form.append("screenshots", new Blob([screenshot.body], { type: screenshot.type || "image/png" }), screenshot.name);
  }
  for (const file of files.files || []) {
    form.append("files", new Blob([file.body], { type: file.type || "text/plain" }), file.name);
  }
  return form;
}

async function createProject(token, fields, files = {}) {
  return api(
    "/api/projects",
    {
      method: "POST",
      headers: auth(token),
      body: projectForm(fields, files)
    },
    201
  );
}

async function download(token, url, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);
  assert(response.status === expectedStatus, `${url}: expected HTTP ${expectedStatus}, got ${response.status}`);
  if (expectedStatus === 200) return Buffer.from(await response.arrayBuffer());
  return null;
}

function cleanup() {
  const db = openDb();
  const allSlugs = Object.values(slugs);
  const placeholders = allSlugs.map(() => "?").join(",");
  const projects = db
    .prepare(`SELECT id FROM projects WHERE slug IN (${placeholders})`)
    .all(...allSlugs);
  const projectIds = projects.map((row) => row.id);

  if (projectIds.length) {
    const projectPlaceholders = projectIds.map(() => "?").join(",");
    const fileRows = [
      ...db.prepare(`SELECT file_path, file_signature_path FROM projects WHERE id IN (${projectPlaceholders})`).all(...projectIds),
      ...db.prepare(`SELECT file_path, file_signature_path FROM project_versions WHERE project_id IN (${projectPlaceholders})`).all(...projectIds),
      ...db.prepare(`SELECT file_path, file_signature_path FROM project_files WHERE project_id IN (${projectPlaceholders})`).all(...projectIds),
      ...db.prepare(`SELECT file_path, NULL AS file_signature_path FROM project_screenshots WHERE project_id IN (${projectPlaceholders})`).all(...projectIds)
    ];

    for (const row of fileRows) {
      for (const relativePath of [row.file_path, row.file_signature_path]) {
        if (!relativePath) continue;
        const absolutePath = path.resolve(uploadsDir, relativePath);
        if (absolutePath.startsWith(uploadsDir)) fs.rmSync(absolutePath, { force: true });
      }
    }

    db.prepare(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`).run(...projectIds);
  }

  const userIds = Object.values(users);
  const userPlaceholders = userIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM users WHERE telegram_id IN (${userPlaceholders})`).run(...userIds);
  db.prepare(`DELETE FROM promo_codes WHERE code LIKE ?`).run(`${codePrefix}%`);
  db.prepare(`DELETE FROM notifications WHERE title LIKE ? OR body LIKE ?`).run("Full Check%", "%Smoke test%");
  db.close();
}

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

try {
  cleanup();

  const health = await api("/api/health");
  assert(health.ok && health.limits?.maxUploadMb, "health/limits failed");
  ok("health");

  const adminAuth = await api("/api/auth/dev", { method: "POST" });
  const adminToken = adminAuth.token;
  assert(adminAuth.user?.isAdmin, "dev admin auth did not return admin");
  ok("auth/dev admin");

  const main = upsertTestUser(users.main, "Full Check Main");
  const buyer = upsertTestUser(users.buyer, "Full Check Buyer");
  const promoUser = upsertTestUser(users.promo, "Full Check Promo");
  const subscriber = upsertTestUser(users.subscriber, "Full Check Subscriber");
  const vip = upsertTestUser(users.vip, "Full Check VIP");
  const grant = upsertTestUser(users.grant, "Full Check Grant");
  const pending = upsertTestUser(users.pending, "Full Check Pending");
  const seller = upsertTestUser(users.seller, "Full Check Seller");
  const stars = upsertTestUser(users.stars, "Full Check Stars");

  const me = await api("/api/me", { headers: auth(main.token) });
  assert(!me.user.isAdmin && me.account.remaining !== null, "regular /api/me failed");
  ok("regular auth/me");

  const commonFields = {
    status: "published",
    summary: "Functional smoke project",
    description: "Full functional check project",
    installation: "npm install\nnpm run start",
    requirements: "Node.js >=24",
    osSupport: "Linux VPS",
    licenseType: "personal",
    nodeVersion: ">=24",
    pythonVersion: ">=3.11",
    runExamples: "node index.js",
    codePreview: "console.log('demo');",
    changelog: "v1.0.0 initial",
    languages: ["Node.js", "Python"],
    tags: ["fullcheck", "api", "bot"],
    collections: ["Боты", "AI"],
    categories: ["Backend", "Automation"],
    repositoryUrl: "https://example.com/repo",
    demoUrl: "https://example.com/demo",
    docsUrl: "https://example.com/docs",
    videoUrl: "https://example.com/video",
    version: "v1.0.0"
  };

  const free = await createProject(
    adminToken,
    {
      ...commonFields,
      title: "Full Check Free",
      slug: slugs.free,
      priceCents: 0,
      priceLabel: "Бесплатно",
      accessTier: "free"
    },
    {
      package: { name: "free.js", body: "console.log('free');" },
      screenshots: [{ name: "shot.png", body: pngBytes }],
      files: [{ name: "extra.txt", body: "extra file" }]
    }
  );
  assert(free.project.fileScanStatus === "clean", "free project scan failed");
  assert(free.project.fileSignatureUrl, "free project signature missing");
  assert(free.notifications?.notifications >= 1, "new project notification count failed");
  const newProjectNotifications = await api("/api/notifications", { headers: auth(main.token) });
  assert(
    newProjectNotifications.notifications.some((item) => item.projectId === free.project.id && item.type === "project"),
    "new project notification missing"
  );
  ok("admin create project with file/screenshot/extra");
  ok("new project notifications");

  const paid = await createProject(
    adminToken,
    {
      ...commonFields,
      title: "Full Check Paid",
      slug: slugs.paid,
      priceCents: 150,
      priceLabel: "legacy label ignored",
      accessTier: "free"
    },
    { package: { name: "paid.js", body: "console.log('paid');" } }
  );
  assert(paid.project.accessTier === "paid", "paid tier auto-fix failed");
  assert(paid.project.priceLabel === "150 Stars", "paid project must display Telegram Stars only");
  ok("paid auto-tier");

  const subscription = await createProject(
    adminToken,
    {
      ...commonFields,
      title: "Full Check Subscription",
      slug: slugs.subscription,
      priceCents: 0,
      priceLabel: "По подписке",
      accessTier: "subscription"
    },
    { package: { name: "sub.js", body: "console.log('sub');" } }
  );
  const vipProject = await createProject(
    adminToken,
    {
      ...commonFields,
      title: "Full Check VIP",
      slug: slugs.vip,
      priceCents: 0,
      priceLabel: "VIP",
      accessTier: "vip"
    },
    { package: { name: "vip.js", body: "console.log('vip');" } }
  );
  const archiveProject = await createProject(adminToken, {
    ...commonFields,
    title: "Full Check Archive",
    slug: slugs.archive,
    accessTier: "free"
  });
  ok("admin create monetized projects");

  const blockedForm = projectForm(
    { title: "Full Check Blocked", slug: slugs.blocked, status: "draft" },
    { package: { name: "bad.exe", body: "MZ" } }
  );
  const blockedPayload = await expectHttp(
    "/api/projects",
    { method: "POST", headers: auth(adminToken), body: blockedForm },
    400
  );
  assert(String(blockedPayload.error || "").includes("executable extension"), "blocked upload error mismatch");
  ok("blocked dangerous upload");

  const listAll = await api("/api/projects?search=Full+Check&sort=new", { headers: auth(main.token) });
  assert(listAll.projects.length >= 4, "search did not find created projects");
  const byLanguage = await api("/api/projects?language=Node.js", { headers: auth(main.token) });
  assert(byLanguage.projects.some((project) => project.slug === slugs.free), "language filter failed");
  const byTag = await api("/api/projects?tag=fullcheck", { headers: auth(main.token) });
  assert(byTag.projects.some((project) => project.slug === slugs.free), "tag filter failed");
  const byCollection = await api("/api/projects?collection=AI", { headers: auth(main.token) });
  assert(byCollection.projects.some((project) => project.slug === slugs.free), "collection filter failed");
  const byCategory = await api("/api/projects?category=Backend", { headers: auth(main.token) });
  assert(byCategory.projects.some((project) => project.slug === slugs.free), "category filter failed");
  const paidFilter = await api("/api/projects?price=paid", { headers: auth(main.token) });
  assert(
    paidFilter.projects.some((project) => project.slug === slugs.paid) &&
      paidFilter.projects.some((project) => project.slug === slugs.subscription) &&
      paidFilter.projects.some((project) => project.slug === slugs.vip),
    "paid filter failed"
  );
  const vipFilter = await api("/api/projects?tier=vip", { headers: auth(main.token) });
  assert(vipFilter.projects.some((project) => project.slug === slugs.vip), "vip tier filter failed");
  ok("catalog filters/search");

  const detail = await api(`/api/projects/${slugs.free}`, { headers: auth(main.token) });
  assert(detail.project.viewCount >= 1 && detail.project.versions.length >= 1, "project detail/view failed");
  ok("project detail/view");

  await api(`/api/projects/${free.project.id}/favorite`, { method: "POST", headers: auth(main.token) }, 204);
  const saved = await api("/api/projects?favorites=true", { headers: auth(main.token) });
  assert(saved.projects.some((project) => project.slug === slugs.free), "favorite filter failed");
  ok("favorites add/list");

  const appMainUser = getAppUserByTelegramId(users.main);
  const botNew = buildBotCommandPayload("new", appMainUser, appConfig);
  const botSaved = buildBotCommandPayload("saved", appMainUser, appConfig);
  const botStart = buildBotCommandPayload("start", appMainUser, appConfig);
  assert(botNew.text.includes("Full Check"), "bot /new did not include real projects");
  assert(botSaved.text.includes("Full Check Free"), "bot /saved did not include favorite project");
  assert(botStart.text.includes("/new") && botStart.keyboard?.reply_markup, "bot /start menu failed");
  ok("bot /start /new /saved payloads");

  const submission = await api(
    "/api/submissions/projects",
    {
      method: "POST",
      headers: auth(seller.token),
      body: projectForm(
        {
          ...commonFields,
          title: "Full Check Submission",
          slug: slugs.submission,
          priceCents: 25,
          priceLabel: "25 Stars",
          accessTier: "paid"
        },
        {
          package: { name: "submission.js", body: "console.log('submission');" },
          screenshots: [{ name: "submission.png", body: pngBytes }]
        }
      )
    },
    201
  );
  assert(submission.project.status === "pending", "user submission was not saved as pending");
  assert(submission.project.createdBy?.username === seller.user.username, "submission author mismatch");
  await expectHttp(`/api/projects/${slugs.submission}`, { headers: auth(main.token) }, 404);
  await api(
    `/api/admin/users/${seller.user.id}/verify`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ verified: true }) },
    200
  );
  const privateSellerProfile = await api(`/api/users/${seller.user.username}`, { headers: auth(main.token) });
  assert(privateSellerProfile.profile.isVerified, "admin verification did not update public profile");
  assert(privateSellerProfile.profile.stats.projects === 0, "pending submission leaked into public profile");
  const publishedSubmission = await api(
    `/api/projects/${submission.project.id}/status`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "published" }) },
    200
  );
  assert(publishedSubmission.notifications?.notifications >= 1, "submission publish notification failed");
  const sellerProfile = await api(`/api/users/${seller.user.username}`, { headers: auth(main.token) });
  assert(
    sellerProfile.profile.stats.projects === 1 &&
      sellerProfile.profile.projects.some((project) => project.slug === slugs.submission),
    "published submission missing from public profile"
  );
  const submissionDetail = await api(`/api/projects/${slugs.submission}`, { headers: auth(main.token) });
  assert(
    submissionDetail.project.createdBy?.username === seller.user.username &&
      submissionDetail.project.createdBy?.isVerified,
    "project detail did not expose verified author"
  );
  const botSellerProfile = buildBotCommandPayload("profile", getAppUserByTelegramId(users.seller), appConfig);
  assert(botSellerProfile.text.includes(seller.user.username), "bot /profile did not include seller username");
  ok("user submission + verified public profile");

  await api(
    `/api/admin/users/${seller.user.id}/badges`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ trusted: true, topSeller: true }) },
    200
  );
  const trustedForm = projectForm(
    {
      ...commonFields,
      title: "Full Check Trusted Submission",
      slug: slugs.trustedSubmission,
      summary: "Auto-approved trusted author project",
      accessTier: "paid",
      priceCents: 77,
      version: "v1.0.0"
    },
    {
      package: { name: "trusted.js", body: "console.log('trusted');" },
      screenshots: [{ name: "trusted.png", body: pngBytes }]
    }
  );
  const trustedSubmission = await api(
    "/api/submissions/projects",
    { method: "POST", headers: auth(seller.token), body: trustedForm },
    201
  );
  assert(trustedSubmission.autoApproved && trustedSubmission.project.status === "published", "trusted author was not auto-approved");

  const ownerEdit = new FormData();
  ownerEdit.set("title", "Full Check Trusted Submission Edited");
  ownerEdit.set("summary", "Edited by owner");
  ownerEdit.set("priceCents", "88");
  const editedOwnerProject = await api(
    `/api/projects/${trustedSubmission.project.id}`,
    { method: "PUT", headers: auth(seller.token), body: ownerEdit },
    200
  );
  assert(editedOwnerProject.project.summary === "Edited by owner" && editedOwnerProject.project.status === "published", "owner edit failed");

  const ownerVersion = new FormData();
  ownerVersion.set("version", "v1.1.0");
  ownerVersion.set("changelog", "Owner release");
  ownerVersion.set("package", new Blob(["console.log('owner v1.1');"], { type: "text/plain" }), "trusted-v1.1.js");
  const ownerVersionResult = await api(
    `/api/projects/${trustedSubmission.project.id}/version`,
    { method: "POST", headers: auth(seller.token), body: ownerVersion },
    200
  );
  assert(ownerVersionResult.project.versions.some((version) => version.version === "v1.1.0"), "owner version upload failed");

  const ownerScreens = new FormData();
  ownerScreens.set("screenshots", new Blob([pngBytes], { type: "image/png" }), "trusted-shot-2.png");
  const ownerAfterScreens = await api(
    `/api/projects/${trustedSubmission.project.id}/screenshots`,
    { method: "POST", headers: auth(seller.token), body: ownerScreens },
    200
  );
  const ownerShotId = ownerAfterScreens.project.screenshots[0].id;
  await api(
    `/api/projects/${trustedSubmission.project.id}/screenshots/${ownerShotId}`,
    { method: "DELETE", headers: auth(seller.token) },
    204
  );
  const ownerProjects = await api("/api/my/projects", { headers: auth(seller.token) });
  assert(
    ownerProjects.projects.some((project) => project.id === trustedSubmission.project.id && project.status === "published"),
    "owner projects list failed"
  );
  const trustedProfile = await api(`/api/users/${seller.user.username}`, { headers: auth(main.token) });
  assert(
    trustedProfile.profile.isTrusted && trustedProfile.profile.isTopSeller,
    "trusted/top seller badges missing from public profile"
  );
  await api(
    `/api/admin/projects/${trustedSubmission.project.id}/weekly`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ picked: true }) },
    200
  );
  await api(
    `/api/admin/projects/${trustedSubmission.project.id}/sale`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ percent: 25, endsAt: "2099-01-01T00:00" }) },
    200
  );
  const saleCatalog = await api(`/api/projects?search=${encodeURIComponent("Trusted Submission Edited")}`, { headers: auth(main.token) });
  const saleProject = saleCatalog.projects.find((project) => project.id === trustedSubmission.project.id);
  assert(saleProject?.isWeeklyPick && saleProject?.isOnSale && saleProject.salePriceCents === 66, "weekly pick or seasonal sale failed");
  await api(
    `/api/admin/projects/${trustedSubmission.project.id}/message`,
    {
      method: "POST",
      headers: jsonAuth(adminToken),
      body: JSON.stringify({ title: "Full Check Author Message", message: "Please check moderation notes" })
    },
    200
  );
  const sellerNotifications = await api("/api/notifications", { headers: auth(seller.token) });
  assert(sellerNotifications.notifications.some((item) => item.type === "author_message"), "author message notification missing");
  await api(
    `/api/users/${seller.user.username}/reports`,
    { method: "POST", headers: jsonAuth(main.token), body: JSON.stringify({ reason: "abuse", details: "Author report smoke" }) },
    201
  );
  const authorReports = await api("/api/admin/reports", { headers: auth(adminToken) });
  const authorReport = authorReports.reports.find((item) => item.subjectType === "author" && item.targetAuthor?.id === seller.user.id);
  assert(authorReport, "author report missing from admin reports");
  await api(
    `/api/admin/reports/${authorReport.id}/status`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "resolved", subjectType: "author" }) },
    200
  );
  ok("trusted author auto-approval + owner management + market tools");

  const versionForm = new FormData();
  versionForm.set("version", "v1.1.0");
  versionForm.set("changelog", "Added notification test");
  versionForm.set("package", new Blob(["console.log('v1.1');"], { type: "text/plain" }), "free-v1.1.js");
  const withVersion = await api(
    `/api/projects/${free.project.id}/version`,
    { method: "POST", headers: auth(adminToken), body: versionForm },
    200
  );
  assert(withVersion.project.versions.some((version) => version.version === "v1.1.0"), "version publish failed");
  const versionId = withVersion.project.versions.find((version) => version.version === "v1.1.0").id;
  assert(withVersion.notifications?.notifications >= 1, "version notification count failed");
  const notifications = await api("/api/notifications", { headers: auth(main.token) });
  const versionNotification = notifications.notifications.find((item) => item.projectId === free.project.id && item.type === "version");
  assert(versionNotification, "favorite user did not receive version notification");
  await api(`/api/notifications/${versionNotification.id}/read`, { method: "POST", headers: auth(main.token) }, 204);
  ok("version publish + notifications");

  await api(
    `/api/admin/projects/${free.project.id}/versions/${versionId}/review`,
    {
      method: "POST",
      headers: jsonAuth(adminToken),
      body: JSON.stringify({ status: "approved", opens: true, readme: true, license: true, noSecrets: true, dependencies: true })
    },
    200
  );
  await api(
    `/api/admin/projects/${free.project.id}/versions/${versionId}/hidden`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ hidden: true }) },
    200
  );
  await download(main.token, `/api/projects/${free.project.id}/versions/${versionId}/download`, 404);
  await api(
    `/api/admin/projects/${free.project.id}/versions/${versionId}/hidden`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ hidden: false }) },
    200
  );
  ok("admin version review/hide");

  const moreFiles = new FormData();
  moreFiles.set("files", new Blob(["readme"], { type: "text/plain" }), "readme.txt");
  const afterFiles = await api(
    `/api/projects/${free.project.id}/files`,
    { method: "POST", headers: auth(adminToken), body: moreFiles },
    200
  );
  assert(afterFiles.project.files.length >= 2, "additional file upload failed");
  const extraFileId = afterFiles.project.files[0].id;

  await api(
    `/api/admin/projects/${free.project.id}/files/${extraFileId}/review`,
    {
      method: "POST",
      headers: jsonAuth(adminToken),
      body: JSON.stringify({
        status: "approved",
        opens: true,
        readme: true,
        license: true,
        noSecrets: true,
        dependencies: true,
        notes: "Functional checklist passed"
      })
    },
    200
  );
  await api(
    `/api/admin/projects/${free.project.id}/files/${extraFileId}/hidden`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ hidden: true }) },
    200
  );
  await download(main.token, `/api/projects/${free.project.id}/files/${extraFileId}/download`, 404);
  await api(
    `/api/admin/projects/${free.project.id}/files/${extraFileId}/hidden`,
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ hidden: false }) },
    200
  );
  const deleteFileForm = new FormData();
  deleteFileForm.set("files", new Blob(["delete me"], { type: "text/plain" }), "delete-me.txt");
  const afterDeleteFileUpload = await api(
    `/api/projects/${free.project.id}/files`,
    { method: "POST", headers: auth(adminToken), body: deleteFileForm },
    200
  );
  const deleteFileId = afterDeleteFileUpload.project.files.find((file) => file.fileName === "delete-me.txt")?.id;
  assert(deleteFileId, "delete test file missing");
  await api(`/api/admin/projects/${free.project.id}/files/${deleteFileId}`, { method: "DELETE", headers: auth(adminToken) }, 204);
  await download(main.token, `/api/projects/${free.project.id}/files/${deleteFileId}/download`, 404);
  ok("admin file review/hide/delete");

  const moreScreenshots = new FormData();
  moreScreenshots.set("screenshots", new Blob([pngBytes], { type: "image/png" }), "shot-2.png");
  const afterScreens = await api(
    `/api/projects/${free.project.id}/screenshots`,
    { method: "POST", headers: auth(adminToken), body: moreScreenshots },
    200
  );
  assert(afterScreens.project.screenshots.length >= 2, "screenshot upload failed");
  const deleteScreenshotId = afterScreens.project.screenshots[0].id;
  await api(
    `/api/projects/${free.project.id}/screenshots/${deleteScreenshotId}`,
    { method: "DELETE", headers: auth(adminToken) },
    204
  );
  ok("extra files + screenshots management");

  await api(
    `/api/projects/${free.project.id}/reviews`,
    { method: "POST", headers: jsonAuth(main.token), body: JSON.stringify({ rating: 5, comment: "Works well" }) },
    201
  );
  await api(
    `/api/projects/${free.project.id}/reviews`,
    { method: "POST", headers: jsonAuth(main.token), body: JSON.stringify({ rating: 4, comment: "Updated review" }) },
    201
  );
  const adminReviews = await api("/api/admin/reviews", { headers: auth(adminToken) });
  const review = adminReviews.reviews.find((item) => item.project.id === free.project.id);
  assert(review && review.rating === 4, "review create/update failed");
  await api(`/api/admin/reviews/${review.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "hidden" }) });
  await api(`/api/admin/reviews/${review.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "published" }) });
  ok("reviews + moderation");

  await api(
    `/api/projects/${free.project.id}/reports`,
    { method: "POST", headers: jsonAuth(main.token), body: JSON.stringify({ reason: "malware", details: "Suspicious test report" }) },
    201
  );
  const adminReports = await api("/api/admin/reports", { headers: auth(adminToken) });
  const report = adminReports.reports.find((item) => item.project.id === free.project.id && item.reason === "malware");
  assert(report, "malware report list failed");
  await api(`/api/admin/reports/${report.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "reviewing" }) });
  await api(`/api/admin/reports/${report.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "resolved" }) });
  ok("reports + moderation");

  await download(main.token, `/api/projects/${free.project.id}/download`);
  await download(main.token, `/api/projects/${free.project.id}/versions/${versionId}/download`);
  await download(main.token, `/api/projects/${free.project.id}/files/${extraFileId}/download`);
  await download(main.token, `/api/projects/${free.project.id}/download`);
  await download(main.token, `/api/projects/${free.project.id}/download`);
  await download(main.token, `/api/projects/${free.project.id}/download`, 429);
  const history = await api("/api/downloads", { headers: auth(main.token) });
  assert(history.downloads.some((item) => item.project.id === free.project.id), "download history failed");
  const adminDownloads = await api("/api/admin/downloads", { headers: auth(adminToken) });
  assert(adminDownloads.downloads.some((item) => item.project.id === free.project.id), "admin download log failed");
  ok("downloads/history/logs/free limit");

  const botTop = buildBotCommandPayload("top", appMainUser, appConfig);
  const botProfile = buildBotCommandPayload("profile", appMainUser, appConfig);
  assert(botTop.text.includes("Full Check Free"), "bot /top did not reflect real downloads");
  assert(
    botProfile.text.includes(users.main) &&
      botProfile.text.includes("Избранное: 1") &&
      botProfile.text.includes("Скачиваний: 5"),
    "bot /profile did not reflect real account stats"
  );
  ok("bot /top /profile payloads");

  await expectHttp(`/api/projects/${paid.project.id}/download?token=${encodeURIComponent(buyer.token)}`, {}, 402);
  const purchase = await api(`/api/projects/${paid.project.id}/purchase`, { method: "POST", headers: auth(buyer.token) });
  assert(["paid", "owned"].includes(purchase.status), "purchase did not grant access in test mode");
  const secondPurchase = await api(`/api/projects/${paid.project.id}/purchase`, { method: "POST", headers: auth(buyer.token) });
  assert(secondPurchase.status === "owned", "repeat purchase should reuse saved access");
  const buyerPurchases = await api("/api/purchases", { headers: auth(buyer.token) });
  assert(
    buyerPurchases.purchases.some((item) => item.project.slug === slugs.paid && item.amountStars === 150),
    "user purchases list did not preserve bought project"
  );
  await download(buyer.token, `/api/projects/${paid.project.id}/download`);
  const paidVersionForm = new FormData();
  paidVersionForm.set("version", "v2.0.0");
  paidVersionForm.set("changelog", "Paid buyer access regression");
  paidVersionForm.set("package", new Blob(["console.log('paid v2');"], { type: "text/plain" }), "paid-v2.js");
  const paidWithVersion = await api(
    `/api/projects/${paid.project.id}/version`,
    { method: "POST", headers: auth(adminToken), body: paidVersionForm },
    200
  );
  const paidVersionId = paidWithVersion.project.versions.find((version) => version.version === "v2.0.0").id;
  await download(buyer.token, `/api/projects/${paid.project.id}/versions/${paidVersionId}/download`);
  const archiveBuffer = await download(buyer.token, `/api/projects/${paid.project.id}/archive/download`);
  assert(archiveBuffer?.subarray(0, 2).toString("utf8") === "PK", "autoarchive did not return a zip");
  const purchases = await api("/api/admin/purchases", { headers: auth(adminToken) });
  assert(purchases.purchases.some((item) => item.projectSlug === slugs.paid), "admin purchases list failed");
  ok("paid purchase flow + saved access + future versions");

  const promoCode = `${codePrefix}PROJECT`;
  await api(
    "/api/admin/promo",
    {
      method: "POST",
      headers: jsonAuth(adminToken),
      body: JSON.stringify({ code: promoCode, type: "project", projectId: paid.project.id, maxUses: 2 })
    },
    201
  );
  await expectHttp(`/api/projects/${paid.project.id}/download?token=${encodeURIComponent(promoUser.token)}`, {}, 402);
  await api("/api/promo/redeem", { method: "POST", headers: jsonAuth(promoUser.token), body: JSON.stringify({ code: promoCode }) });
  await download(promoUser.token, `/api/projects/${paid.project.id}/download`);
  await expectHttp(
    "/api/promo/redeem",
    { method: "POST", headers: jsonAuth(promoUser.token), body: JSON.stringify({ code: promoCode }) },
    400
  );
  const promos = await api("/api/admin/promo", { headers: auth(adminToken) });
  const createdPromo = promos.codes.find((item) => item.code === promoCode);
  assert(createdPromo && createdPromo.usedCount === 1, "promo list/usage failed");
  await api(`/api/admin/promo/${createdPromo.id}`, { method: "DELETE", headers: auth(adminToken) }, 204);
  ok("promo project flow");

  await expectHttp(`/api/projects/${subscription.project.id}/download?token=${encodeURIComponent(subscriber.token)}`, {}, 402);
  const subResult = await api("/api/subscription", { method: "POST", headers: auth(subscriber.token) });
  assert(subResult.account?.isSubscriber, "subscription account state failed");
  await download(subscriber.token, `/api/projects/${subscription.project.id}/download`);
  ok("subscription flow");

  await expectHttp(`/api/projects/${vipProject.project.id}/download?token=${encodeURIComponent(vip.token)}`, {}, 402);
  const vipResult = await api("/api/vip", { method: "POST", headers: auth(vip.token) });
  assert(vipResult.account?.isVip, "VIP account state failed");
  await download(vip.token, `/api/projects/${vipProject.project.id}/download`);
  await download(vip.token, `/api/projects/${paid.project.id}/download`);
  ok("vip flow");

  await api(
    "/api/admin/grant",
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ telegramId: users.grant, kind: "subscription", days: 7 }) },
    200
  );
  const grantedMe = await api("/api/me", { headers: auth(grant.token) });
  assert(grantedMe.account.isSubscriber, "manual grant failed");
  ok("manual grant");

  const dbForPending = openDb();
  dbForPending.prepare(
    `INSERT INTO purchases (user_id, project_id, amount_cents, status, source)
     VALUES (?, ?, 150, 'pending', 'manual')`
  ).run(pending.user.id, paid.project.id);
  const pendingPurchase = dbForPending
    .prepare(`SELECT id FROM purchases WHERE user_id = ? AND project_id = ?`)
    .get(pending.user.id, paid.project.id);
  dbForPending.close();
  await expectHttp(`/api/projects/${paid.project.id}/download?token=${encodeURIComponent(pending.token)}`, {}, 402);
  await api(`/api/admin/purchases/${pendingPurchase.id}/confirm`, { method: "POST", headers: auth(adminToken) });
  await download(pending.token, `/api/projects/${paid.project.id}/download`);
  ok("pending purchase confirmation");

  const dbForStars = openDb();
  dbForStars.prepare(
    `INSERT INTO purchases (user_id, project_id, amount_cents, status, source)
     VALUES (?, ?, 150, 'pending', 'stars')`
  ).run(stars.user.id, paid.project.id);
  const starsPurchase = dbForStars
    .prepare(`SELECT id FROM purchases WHERE user_id = ? AND project_id = ?`)
    .get(stars.user.id, paid.project.id);
  dbForStars.close();
  await expectHttp(`/api/projects/${paid.project.id}/download?token=${encodeURIComponent(stars.token)}`, {}, 402);
  completeStarsPayload(`p:${starsPurchase.id}`);
  await download(stars.token, `/api/projects/${paid.project.id}/download`);
  completeStarsPayload(`s:${stars.user.id}:7`);
  completeStarsPayload(`v:${stars.user.id}:0`);
  const starsMe = await api("/api/me", { headers: auth(stars.token) });
  assert(starsMe.account.isSubscriber && starsMe.account.isVip, "Stars payload did not grant subscription/VIP");
  ok("Telegram Stars successful payment payloads");

  await api(
    "/api/requests",
    {
      method: "POST",
      headers: jsonAuth(main.token),
      body: JSON.stringify({ type: "custom", projectId: free.project.id, message: "Need custom feature", budget: "100", contact: "@tester" })
    },
    201
  );
  const userRequests = await api("/api/requests", { headers: auth(main.token) });
  assert(userRequests.requests.some((item) => item.message.includes("custom feature")), "user requests list failed");
  const adminRequests = await api("/api/admin/requests", { headers: auth(adminToken) });
  const customRequest = adminRequests.requests.find((item) => item.message.includes("custom feature"));
  assert(customRequest, "admin requests list failed");
  await api(`/api/admin/requests/${customRequest.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "done" }) });
  ok("custom requests");

  const broadcast = await api(
    "/api/admin/broadcast",
    { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ title: "Full Check Broadcast", message: "Smoke test" }) },
    200
  );
  assert(broadcast.notifications >= 1, "broadcast failed");
  const broadcastNotifications = await api("/api/notifications", { headers: auth(main.token) });
  assert(broadcastNotifications.notifications.some((item) => item.type === "broadcast"), "broadcast notification missing");
  ok("broadcast notifications");

  await api(`/api/admin/users/${main.user.id}/ban`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ banned: true, reason: "functional test" }) });
  await expectHttp("/api/me", { headers: auth(main.token) }, 403);
  await api(`/api/admin/users/${main.user.id}/ban`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ banned: false, reason: "" }) });
  await api("/api/me", { headers: auth(main.token) });
  ok("ban/unban");

  await api(`/api/projects/${free.project.id}/pin`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ pinned: true }) });
  const adminProjects = await api("/api/admin/projects", { headers: auth(adminToken) });
  assert(adminProjects.projects.find((project) => project.id === free.project.id)?.pinnedAt, "pin failed");
  await api(`/api/projects/${free.project.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "hidden" }) });
  await expectHttp(`/api/projects/${slugs.free}`, { headers: auth(buyer.token) }, 404);
  await api(`/api/projects/${free.project.id}/status`, { method: "POST", headers: jsonAuth(adminToken), body: JSON.stringify({ status: "published" }) });
  await api(`/api/projects/${archiveProject.project.id}`, { method: "DELETE", headers: auth(adminToken) }, 204);
  await expectHttp(`/api/projects/${slugs.archive}`, { headers: auth(buyer.token) }, 404);
  ok("pin/status/hide/archive");

  await api(`/api/projects/${free.project.id}/favorite`, { method: "DELETE", headers: auth(main.token) }, 204);
  const savedAfterRemove = await api("/api/projects?favorites=true", { headers: auth(main.token) });
  assert(!savedAfterRemove.projects.some((project) => project.slug === slugs.free), "favorite remove failed");
  ok("favorites remove");

  const finalAdminUsers = await api("/api/admin/users", { headers: auth(adminToken) });
  assert(finalAdminUsers.users.some((user) => user.telegramId === users.main), "admin users list failed");
  ok("admin users list");

  console.log(JSON.stringify({ ok: true, checked: results.length, results }, null, 2));
} finally {
  cleanup();
}
