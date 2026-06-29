import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { publicUploadUrl } from "./storage.js";

let db;

const projectStatuses = new Set(["draft", "pending", "published", "hidden", "archived"]);

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function ensureColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function safeStatus(value, fallback = "published") {
  return projectStatuses.has(value) ? value : fallback;
}

function filePathFor(file) {
  return file ? path.posix.join("packages", file.filename) : "";
}

function fileShaFor(file) {
  return file?.fileSha256 || "";
}

function fileScanStatusFor(file) {
  return file ? file.fileScanStatus || "clean" : "";
}

function fileScanNotesFor(file) {
  return file?.fileScanNotes || "";
}

function fileSignaturePathFor(file) {
  return file?.fileSignaturePath || "";
}

export function formatStarsPriceLabel(accessTier, priceCents = 0) {
  const tier = String(accessTier || "free");
  const stars = Math.max(0, Number.parseInt(priceCents, 10) || 0);
  if (tier === "subscription") return "Subscription";
  if (tier === "vip") return "VIP";
  if (tier === "paid" || stars > 0) return `${Math.max(1, stars)} Stars`;
  return "Free";
}

function screenshotPathFor(file) {
  return path.posix.join("screenshots", file.filename);
}

function normalizeScreenshot(row) {
  return {
    id: row.id,
    url: publicUploadUrl(row.file_path),
    fileName: row.file_name,
    sortOrder: row.sort_order
  };
}

function normalizeProjectFile(row) {
  return {
    id: row.id,
    fileName: row.file_name || "",
    fileSize: row.file_size || 0,
    fileMime: row.file_mime || "",
    hasFile: Boolean(row.file_path),
    downloadCount: row.download_count || 0,
    fileSha256: row.file_sha256 || "",
    scanStatus: row.file_scan_status || "",
    scanNotes: row.file_scan_notes || "",
    signatureUrl: publicUploadUrl(row.file_signature_path),
    reviewStatus: row.review_status || "pending",
    reviewChecklist: parseJsonObject(row.review_checklist),
    reviewNotes: row.review_notes || "",
    isHidden: Boolean(row.is_hidden),
    hiddenAt: row.hidden_at || "",
    deletedAt: row.deleted_at || "",
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at
  };
}

function normalizeReview(row) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment || "",
    status: row.status || "published",
    createdAt: row.created_at,
    author: {
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      username: row.username || "",
      photoUrl: row.photo_url || ""
    }
  };
}

function normalizeAdminReview(row) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment || "",
    status: row.status || "published",
    createdAt: row.created_at,
    project: {
      id: row.project_id,
      slug: row.project_slug || "",
      title: row.project_title || ""
    },
    author: {
      id: row.user_id,
      telegramId: row.telegram_id || "",
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      username: row.username || ""
    }
  };
}

function normalizeVersion(row) {
  return {
    id: row.id,
    version: row.version || "",
    changelog: row.changelog || "",
    fileName: row.file_name || "",
    fileSize: row.file_size || 0,
    hasFile: Boolean(row.file_path),
    downloadCount: row.download_count || 0,
    fileSha256: row.file_sha256 || "",
    scanStatus: row.file_scan_status || "",
    scanNotes: row.file_scan_notes || "",
    signatureUrl: publicUploadUrl(row.file_signature_path),
    reviewStatus: row.review_status || "pending",
    reviewChecklist: parseJsonObject(row.review_checklist),
    reviewNotes: row.review_notes || "",
    isHidden: Boolean(row.is_hidden),
    hiddenAt: row.hidden_at || "",
    deletedAt: row.deleted_at || "",
    createdAt: row.created_at
  };
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function activeSale(row) {
  const percent = Math.max(0, Math.min(95, Number.parseInt(row.seasonal_sale_percent, 10) || 0));
  const endsAt = row.sale_ends_at || "";
  const isActive = percent > 0 && (!endsAt || new Date(endsAt.replace(" ", "T")).getTime() > Date.now());
  const base = Math.max(0, Number.parseInt(row.price_cents, 10) || 0);
  return {
    isActive,
    percent: isActive ? percent : 0,
    priceCents: isActive && base > 0 ? Math.max(1, Math.round(base * (100 - percent) / 100)) : base
  };
}

function buildReadmePreview(project) {
  return [
    `# ${project.title || "Project"}`,
    project.summary || "",
    project.description ? `## Description\n${project.description}` : "",
    project.installation ? `## Installation\n${project.installation}` : "",
    project.requirements ? `## Requirements\n${project.requirements}` : "",
    project.run_examples ? `## Run Examples\n${project.run_examples}` : "",
    `## License\n${project.license_type || "free"}`
  ].filter(Boolean).join("\n\n");
}

function normalizeProject(
  row,
  { screenshots = [], reviews = [], versions = [], files = [] } = {}
) {
  const sale = activeSale(row);
  const priceCents = row.price_cents || 0;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || "",
    description: row.description || "",
    changelog: row.changelog || "",
    installation: row.installation || "",
    requirements: row.requirements || "",
    nodeVersion: row.node_version || "",
    pythonVersion: row.python_version || "",
    osSupport: row.os_support || "",
    runExamples: row.run_examples || "",
    licenseType: row.license_type || "free",
    codePreview: row.code_preview || "",
    languages: parseJsonArray(row.languages),
    tags: parseJsonArray(row.tags),
    collections: parseJsonArray(row.collections),
    categories: parseJsonArray(row.categories),
    repositoryUrl: row.repository_url || "",
    demoUrl: row.demo_url || "",
    docsUrl: row.docs_url || "",
    videoUrl: row.video_url || "",
    createdBy: {
      id: row.creator_id || row.created_by || null,
      telegramId: row.creator_telegram_id || "",
      firstName: row.creator_first_name || "",
      lastName: row.creator_last_name || "",
      username: row.creator_username || "",
      photoUrl: row.creator_photo_url || "",
      isVerified: Boolean(row.creator_is_verified),
      isTrusted: Boolean(row.creator_is_trusted),
      isTopSeller: Boolean(row.creator_is_top_seller)
    },
    version: row.version || "",
    accessTier: row.access_tier || "free",
    priceCents,
    salePriceCents: sale.priceCents,
    salePercent: sale.percent,
    saleEndsAt: row.sale_ends_at || "",
    isOnSale: sale.isActive,
    priceLabel: formatStarsPriceLabel(row.access_tier, priceCents),
    fileName: row.file_name || "",
    fileSize: row.file_size || 0,
    hasFile: Boolean(row.file_path),
    fileSha256: row.file_sha256 || "",
    fileScanStatus: row.file_scan_status || "",
    fileScanNotes: row.file_scan_notes || "",
    fileSignatureUrl: publicUploadUrl(row.file_signature_path),
    downloadCount: row.download_count || 0,
    viewCount: row.view_count || 0,
    favoriteCount: row.favorite_count || 0,
    averageRating: Number(Number(row.average_rating || 0).toFixed(1)),
    reviewCount: row.review_count || 0,
    status: row.status,
    pinnedAt: row.pinned_at || "",
    weeklyPickedAt: row.weekly_picked_at || "",
    isWeeklyPick: Boolean(row.weekly_picked_at),
    hiddenAt: row.hidden_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVersionAt: row.last_version_at || "",
    isFavorite: Boolean(row.is_favorite),
    screenshots,
    reviews,
    versions,
    files,
    readmePreview: buildReadmePreview(row)
  };
}

function screenshotsFor(projectId) {
  return db
    .prepare(
      `SELECT id, file_path, file_name, sort_order
       FROM project_screenshots
       WHERE project_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(projectId)
    .map(normalizeScreenshot);
}

function filesFor(projectId, { includeHidden = false } = {}) {
  const visibility = includeHidden
    ? ""
    : "AND COALESCE(is_hidden, 0) = 0 AND deleted_at IS NULL";
  return db
    .prepare(
      `SELECT id, file_path, file_name, file_mime, file_size, file_sha256,
        file_scan_status, file_scan_notes, file_signature_path,
        review_status, review_checklist, review_notes, is_hidden, hidden_at,
        deleted_at, sort_order, created_at, download_count
       FROM project_files
       WHERE project_id = ?
         ${visibility}
       ORDER BY sort_order ASC, id ASC`
    )
    .all(projectId)
    .map(normalizeProjectFile);
}

function reviewsFor(projectId) {
  return db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
        u.first_name, u.last_name, u.username, u.photo_url
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.project_id = ? AND COALESCE(r.status, 'published') = 'published'
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 30`
    )
    .all(projectId)
    .map(normalizeReview);
}

function versionsFor(projectId, { includeHidden = false } = {}) {
  const visibility = includeHidden
    ? ""
    : "AND COALESCE(is_hidden, 0) = 0 AND deleted_at IS NULL";
  return db
    .prepare(
      `SELECT id, version, changelog, file_name, file_size, file_path,
        file_sha256, file_scan_status, file_scan_notes, file_signature_path,
        review_status, review_checklist, review_notes, is_hidden, hidden_at,
        deleted_at, download_count, created_at
       FROM project_versions
       WHERE project_id = ?
         ${visibility}
       ORDER BY created_at DESC, id DESC`
    )
    .all(projectId)
    .map(normalizeVersion);
}

function projectSelect() {
  return `SELECT p.*,
    creator.id AS creator_id,
    creator.telegram_id AS creator_telegram_id,
    creator.first_name AS creator_first_name,
    creator.last_name AS creator_last_name,
    creator.username AS creator_username,
    creator.photo_url AS creator_photo_url,
    creator.is_verified AS creator_is_verified,
    creator.is_trusted AS creator_is_trusted,
    creator.is_top_seller AS creator_is_top_seller,
    EXISTS (
      SELECT 1 FROM favorites f
      WHERE f.user_id = @userId AND f.project_id = p.id
    ) AS is_favorite,
    COALESCE((
      SELECT AVG(r.rating)
      FROM reviews r
      WHERE r.project_id = p.id AND COALESCE(r.status, 'published') = 'published'
    ), 0) AS average_rating,
    (
      SELECT COUNT(*)
      FROM reviews r
      WHERE r.project_id = p.id AND COALESCE(r.status, 'published') = 'published'
    ) AS review_count,
    (SELECT COUNT(*) FROM favorites f WHERE f.project_id = p.id) AS favorite_count
   FROM projects p
   LEFT JOIN users creator ON creator.id = p.created_by`;
}

function insertVersion(projectId, project, file, creatorId) {
  db.prepare(
    `INSERT INTO project_versions (
      project_id, version, changelog, file_path, file_name, file_mime,
      file_size, file_sha256, file_scan_status, file_scan_notes,
      file_signature_path, created_by
    )
    VALUES (
      @projectId, @version, @changelog, @filePath, @fileName, @fileMime,
      @fileSize, @fileSha256, @fileScanStatus, @fileScanNotes,
      @fileSignaturePath, @creatorId
    )`
  ).run({
    projectId,
    version: project.version || "",
    changelog: project.changelog || "",
    filePath: filePathFor(file),
    fileName: file ? file.originalname : "",
    fileMime: file ? file.mimetype : "",
    fileSize: file ? file.size : 0,
    fileSha256: fileShaFor(file),
    fileScanStatus: fileScanStatusFor(file),
    fileScanNotes: fileScanNotesFor(file),
    fileSignaturePath: fileSignaturePathFor(file),
    creatorId
  });
}

function insertScreenshots(projectId, screenshots = []) {
  const currentMax =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS max_sort
         FROM project_screenshots
         WHERE project_id = ?`
      )
      .get(projectId)?.max_sort ?? -1;
  const insertScreenshot = db.prepare(
    `INSERT INTO project_screenshots (project_id, file_path, file_name, sort_order)
     VALUES (?, ?, ?, ?)`
  );

  for (const [index, file] of screenshots.entries()) {
    insertScreenshot.run(projectId, screenshotPathFor(file), file.originalname, currentMax + index + 1);
  }
}

export function addProjectFiles(projectId, files = []) {
  const currentMax =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS max_sort
         FROM project_files
         WHERE project_id = ?`
      )
      .get(projectId)?.max_sort ?? -1;
  const insertFile = db.prepare(
    `INSERT INTO project_files (
      project_id, file_path, file_name, file_mime, file_size, file_sha256,
      file_scan_status, file_scan_notes, file_signature_path, sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const [index, file] of files.entries()) {
    insertFile.run(
      projectId,
      filePathFor(file),
      file.originalname,
      file.mimetype,
      file.size,
      fileShaFor(file),
      fileScanStatusFor(file),
      fileScanNotesFor(file),
      fileSignaturePathFor(file),
      currentMax + index + 1
    );
  }

  return getProjectById(projectId);
}

export function addProjectScreenshots(projectId, screenshots = []) {
  insertScreenshots(projectId, screenshots);
  db.prepare(
    `UPDATE projects
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(projectId);
  return getProjectById(projectId);
}

export function initDatabase(config) {
  db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      photo_url TEXT,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_trusted INTEGER NOT NULL DEFAULT 0,
      is_top_seller INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT,
      description TEXT,
      changelog TEXT,
      installation TEXT,
      requirements TEXT,
      node_version TEXT,
      python_version TEXT,
      os_support TEXT,
      run_examples TEXT,
      license_type TEXT NOT NULL DEFAULT 'free',
      code_preview TEXT,
      languages TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      collections TEXT NOT NULL DEFAULT '[]',
      categories TEXT NOT NULL DEFAULT '[]',
      repository_url TEXT,
      demo_url TEXT,
      docs_url TEXT,
      video_url TEXT,
      version TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      price_label TEXT,
      access_tier TEXT NOT NULL DEFAULT 'free',
      file_path TEXT,
      file_name TEXT,
      file_mime TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_sha256 TEXT,
      file_scan_status TEXT NOT NULL DEFAULT 'pending',
      file_scan_notes TEXT,
      file_signature_path TEXT,
      status TEXT NOT NULL DEFAULT 'published',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_version_at TEXT,
      download_count INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      weekly_picked_at TEXT,
      seasonal_sale_percent INTEGER NOT NULL DEFAULT 0,
      sale_ends_at TEXT,
      hidden_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version TEXT,
      changelog TEXT,
      file_path TEXT,
      file_name TEXT,
      file_mime TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_sha256 TEXT,
      file_scan_status TEXT,
      file_scan_notes TEXT,
      file_signature_path TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      review_checklist TEXT NOT NULL DEFAULT '{}',
      review_notes TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at TEXT,
      deleted_at TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      download_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_mime TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_sha256 TEXT,
      file_scan_status TEXT,
      file_scan_notes TEXT,
      file_signature_path TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      review_checklist TEXT NOT NULL DEFAULT '{}',
      review_notes TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at TEXT,
      deleted_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      download_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS author_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_id INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
      file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paid',
      source TEXT NOT NULL DEFAULT 'purchase',
      promo_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn("users", "is_banned", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "is_verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "is_trusted", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "is_top_seller", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "ban_reason", "TEXT");
  ensureColumn("projects", "changelog", "TEXT");
  ensureColumn("projects", "installation", "TEXT");
  ensureColumn("projects", "requirements", "TEXT");
  ensureColumn("projects", "node_version", "TEXT");
  ensureColumn("projects", "python_version", "TEXT");
  ensureColumn("projects", "os_support", "TEXT");
  ensureColumn("projects", "run_examples", "TEXT");
  ensureColumn("projects", "license_type", "TEXT NOT NULL DEFAULT 'free'");
  ensureColumn("projects", "code_preview", "TEXT");
  ensureColumn("projects", "collections", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("projects", "categories", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("projects", "docs_url", "TEXT");
  ensureColumn("projects", "video_url", "TEXT");
  ensureColumn("projects", "price_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("projects", "price_label", "TEXT");
  ensureColumn("projects", "access_tier", "TEXT NOT NULL DEFAULT 'free'");
  ensureColumn("projects", "file_sha256", "TEXT");
  ensureColumn("projects", "file_scan_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("projects", "file_scan_notes", "TEXT");
  ensureColumn("projects", "file_signature_path", "TEXT");
  ensureColumn("projects", "last_version_at", "TEXT");
  ensureColumn("projects", "view_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("projects", "pinned_at", "TEXT");
  ensureColumn("projects", "weekly_picked_at", "TEXT");
  ensureColumn("projects", "seasonal_sale_percent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("projects", "sale_ends_at", "TEXT");
  ensureColumn("projects", "hidden_at", "TEXT");
  ensureColumn("project_versions", "file_sha256", "TEXT");
  ensureColumn("project_versions", "file_scan_status", "TEXT");
  ensureColumn("project_versions", "file_scan_notes", "TEXT");
  ensureColumn("project_versions", "file_signature_path", "TEXT");
  ensureColumn("project_versions", "review_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("project_versions", "review_checklist", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("project_versions", "review_notes", "TEXT");
  ensureColumn("project_versions", "is_hidden", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("project_versions", "hidden_at", "TEXT");
  ensureColumn("project_versions", "deleted_at", "TEXT");
  ensureColumn("project_files", "file_sha256", "TEXT");
  ensureColumn("project_files", "file_scan_status", "TEXT");
  ensureColumn("project_files", "file_scan_notes", "TEXT");
  ensureColumn("project_files", "file_signature_path", "TEXT");
  ensureColumn("project_files", "review_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("project_files", "review_checklist", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("project_files", "review_notes", "TEXT");
  ensureColumn("project_files", "is_hidden", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("project_files", "hidden_at", "TEXT");
  ensureColumn("project_files", "deleted_at", "TEXT");
  ensureColumn("downloads", "version_id", "INTEGER REFERENCES project_versions(id) ON DELETE SET NULL");
  ensureColumn("downloads", "file_id", "INTEGER REFERENCES project_files(id) ON DELETE SET NULL");
  ensureColumn("reviews", "status", "TEXT NOT NULL DEFAULT 'published'");
  ensureColumn("reports", "details", "TEXT");
  ensureColumn("reports", "status", "TEXT NOT NULL DEFAULT 'new'");

  db.exec(`
    UPDATE projects
    SET price_cents = price_cents / 100
    WHERE COALESCE(price_cents, 0) >= 100
      AND COALESCE(price_cents, 0) % 100 = 0
      AND (
        UPPER(COALESCE(price_label, '')) LIKE '%RUB%'
        OR COALESCE(price_label, '') LIKE '%₽%'
        OR LOWER(COALESCE(price_label, '')) LIKE '%\u0440\u0443\u0431%'
      );

    UPDATE projects
    SET access_tier = 'paid'
    WHERE COALESCE(price_cents, 0) > 0
      AND COALESCE(access_tier, 'free') = 'free';

    UPDATE purchases
    SET amount_cents = (
      SELECT p.price_cents
      FROM projects p
      WHERE p.id = purchases.project_id
    )
    WHERE COALESCE(amount_cents, 0) >= 100
      AND EXISTS (
        SELECT 1
        FROM projects p
        WHERE p.id = purchases.project_id
          AND COALESCE(p.price_cents, 0) > 0
          AND purchases.amount_cents = p.price_cents * 100
      );

    UPDATE projects
    SET price_label = CASE
      WHEN COALESCE(access_tier, 'free') = 'subscription' THEN 'Subscription'
      WHEN COALESCE(access_tier, 'free') = 'vip' THEN 'VIP'
      WHEN COALESCE(price_cents, 0) > 0 OR COALESCE(access_tier, 'free') = 'paid'
        THEN CAST(CASE WHEN COALESCE(price_cents, 0) > 0 THEN price_cents ELSE 1 END AS TEXT) || ' Stars'
      ELSE 'Free'
    END;
  `);
}

export function upsertTelegramUser(telegramUser) {
  const telegramId = String(telegramUser.id);
  db.prepare(
    `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url)
     VALUES (@telegramId, @firstName, @lastName, @username, @photoUrl)
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       photo_url = excluded.photo_url,
       last_seen_at = CURRENT_TIMESTAMP`
  ).run({
    telegramId,
    firstName: telegramUser.first_name || "",
    lastName: telegramUser.last_name || "",
    username: telegramUser.username || "",
    photoUrl: telegramUser.photo_url || ""
  });

  return getUserByTelegramId(telegramId);
}

export function getUserByTelegramId(telegramId) {
  return db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(String(telegramId));
}

export function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

export function getUserByUsername(username) {
  const clean = String(username || "").replace(/^@/, "").trim();
  if (!clean) return null;
  return db
    .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`)
    .get(clean);
}

// Shared connection handle for the monetization module (same WAL database).
export function getDb() {
  return db;
}

export function listProjects({
  userId,
  search = "",
  language = "",
  tag = "",
  collection = "",
  category = "",
  topic = "",
  price = "",
  license = "",
  date = "",
  sort = "new",
  favoritesOnly = false,
  includeAdmin = false
}) {
  const clauses = [];
  const params = { userId: userId || 0 };

  if (!includeAdmin) {
    clauses.push(`p.status = 'published'`);
    clauses.push(`p.hidden_at IS NULL`);
  }

  if (search) {
    clauses.push(
      `(p.title LIKE @search
        OR p.summary LIKE @search
        OR p.description LIKE @search
        OR p.changelog LIKE @search
        OR p.installation LIKE @search
        OR p.requirements LIKE @search
        OR p.run_examples LIKE @search
        OR p.code_preview LIKE @search
        OR p.languages LIKE @search
        OR p.tags LIKE @search
        OR p.collections LIKE @search
        OR p.categories LIKE @search
        OR p.price_label LIKE @search
        OR p.license_type LIKE @search
        OR p.created_at LIKE @search)`
    );
    params.search = `%${search}%`;
  }

  if (language) {
    clauses.push(`p.languages LIKE @language`);
    params.language = `%${language}%`;
  }

  if (tag) {
    clauses.push(`p.tags LIKE @tag`);
    params.tag = `%${tag}%`;
  }

  if (collection) {
    clauses.push(`p.collections LIKE @collection`);
    params.collection = `%${collection}%`;
  }

  if (category) {
    clauses.push(`p.categories LIKE @category`);
    params.category = `%${category}%`;
  }

  if (topic) {
    clauses.push(
      `(p.languages LIKE @topic OR p.tags LIKE @topic OR p.collections LIKE @topic OR p.categories LIKE @topic)`
    );
    params.topic = `%${topic}%`;
  }

  if (price === "free") {
    clauses.push(`COALESCE(p.access_tier, 'free') = 'free' AND COALESCE(p.price_cents, 0) = 0`);
  } else if (price === "paid") {
    clauses.push(
      `(COALESCE(p.access_tier, 'free') IN ('paid', 'subscription', 'vip') OR COALESCE(p.price_cents, 0) > 0)`
    );
  }

  if (license) {
    clauses.push(`p.license_type = @license`);
    params.license = license;
  }

  if (date === "today") {
    clauses.push(`p.created_at >= datetime('now', 'start of day')`);
  } else if (date === "week") {
    clauses.push(`p.created_at >= datetime('now', '-7 days')`);
  } else if (date === "month") {
    clauses.push(`p.created_at >= datetime('now', '-30 days')`);
  } else if (date === "year") {
    clauses.push(`p.created_at >= datetime('now', '-365 days')`);
  }

  if (favoritesOnly) {
    clauses.push(
      `EXISTS (SELECT 1 FROM favorites fav WHERE fav.user_id = @userId AND fav.project_id = p.id)`
    );
  }

  const orderBy =
    {
      popular: `p.download_count DESC, p.view_count DESC, favorite_count DESC, p.created_at DESC`,
      rating: `average_rating DESC, review_count DESC, p.created_at DESC`,
      price: `p.price_cents ASC, p.created_at DESC`,
      updated: `p.updated_at DESC, p.id DESC`,
      new: `p.created_at DESC, p.id DESC`
    }[sort] || `p.created_at DESC, p.id DESC`;
  const where = clauses.length ? clauses.join(" AND ") : "1 = 1";

  const rows = db
    .prepare(
      `${projectSelect()}
       WHERE ${where}
       ORDER BY
         CASE WHEN p.pinned_at IS NULL THEN 1 ELSE 0 END ASC,
         p.pinned_at DESC,
         ${orderBy}`
    )
    .all(params);

  return rows.map((row) =>
    normalizeProject(row, {
      screenshots: screenshotsFor(row.id),
      files: filesFor(row.id, { includeHidden: includeAdmin }),
      versions: includeAdmin ? versionsFor(row.id, { includeHidden: true }) : []
    })
  );
}

export function listAdminProjects(userId) {
  return listProjects({ userId, includeAdmin: true, sort: "updated" });
}

export function listUserOwnedProjects(userId) {
  const rows = db
    .prepare(
      `${projectSelect()}
       WHERE p.created_by = @ownerId
       ORDER BY p.updated_at DESC, p.id DESC`
    )
    .all({ userId: userId || 0, ownerId: userId });

  return rows.map((row) =>
    normalizeProject(row, {
      screenshots: screenshotsFor(row.id),
      versions: versionsFor(row.id, { includeHidden: true }),
      files: filesFor(row.id, { includeHidden: true })
    })
  );
}

export function getProjectBySlug(slug, userId, { includeAdmin = false } = {}) {
  const visibilityClause = includeAdmin ? "" : "AND p.status = 'published' AND p.hidden_at IS NULL";
  const row = db
    .prepare(
      `${projectSelect()}
       WHERE p.slug = @slug ${visibilityClause}`
    )
    .get({ slug, userId: userId || 0 });

  return row
    ? normalizeProject(row, {
        screenshots: screenshotsFor(row.id),
        reviews: reviewsFor(row.id),
        versions: versionsFor(row.id, { includeHidden: includeAdmin }),
        files: filesFor(row.id, { includeHidden: includeAdmin })
      })
    : null;
}

export function getProjectById(id, userId = 0, { includeHidden = true } = {}) {
  const row = db
    .prepare(
      `${projectSelect()}
       WHERE p.id = @id`
    )
    .get({ id, userId });

  return row
    ? normalizeProject(row, {
        screenshots: screenshotsFor(row.id),
        reviews: reviewsFor(row.id),
        versions: versionsFor(row.id, { includeHidden }),
        files: filesFor(row.id, { includeHidden })
      })
    : null;
}

export function getProjectFile(id, versionId = null) {
  if (versionId) {
    const versionFile = db
      .prepare(
        `SELECT id AS version_id, file_path, file_name
         FROM project_versions
         WHERE id = ? AND project_id = ?
           AND COALESCE(is_hidden, 0) = 0
           AND deleted_at IS NULL`
      )
      .get(versionId, id);
    return versionFile?.file_path ? versionFile : null;
  }

  const latestVersionFile = db
    .prepare(
      `SELECT id AS version_id, file_path, file_name
       FROM project_versions
       WHERE project_id = ?
         AND file_path IS NOT NULL AND file_path != ''
         AND COALESCE(is_hidden, 0) = 0
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(id);
  if (latestVersionFile?.file_path) return latestVersionFile;

  const projectFile = db
    .prepare(
      `SELECT NULL AS version_id, p.file_path, p.file_name
       FROM projects p
       WHERE p.id = ?
         AND COALESCE(p.file_path, '') != ''
         AND NOT EXISTS (
           SELECT 1
           FROM project_versions pv
           WHERE pv.project_id = p.id
             AND pv.file_path = p.file_path
             AND (COALESCE(pv.is_hidden, 0) = 1 OR pv.deleted_at IS NOT NULL)
         )`
    )
    .get(id);
  return projectFile?.file_path ? projectFile : null;
}

export function getProjectExtraFile(projectId, fileId) {
  const row = db
    .prepare(
      `SELECT id AS file_id, file_path, file_name
       FROM project_files
       WHERE project_id = ? AND id = ?
         AND COALESCE(is_hidden, 0) = 0
         AND deleted_at IS NULL`
    )
    .get(projectId, fileId);
  return row?.file_path ? row : null;
}

export function createProject(project, files, creatorId) {
  const packageFile = files.package?.[0];
  const status = safeStatus(project.status);
  const result = db
    .prepare(
      `INSERT INTO projects (
        slug, title, summary, description, changelog, installation, requirements,
        node_version, python_version, os_support, run_examples, license_type,
        code_preview, languages, tags, collections, categories, repository_url,
        demo_url, docs_url, video_url, version, price_cents, price_label,
        access_tier, file_path, file_name, file_mime, file_size, file_sha256,
        file_scan_status, file_scan_notes, file_signature_path, status, hidden_at,
        created_by, last_version_at
      )
      VALUES (
        @slug, @title, @summary, @description, @changelog, @installation, @requirements,
        @nodeVersion, @pythonVersion, @osSupport, @runExamples, @licenseType,
        @codePreview, @languages, @tags, @collections, @categories, @repositoryUrl,
        @demoUrl, @docsUrl, @videoUrl, @version, @priceCents, @priceLabel,
        @accessTier, @filePath, @fileName, @fileMime, @fileSize, @fileSha256,
        @fileScanStatus, @fileScanNotes, @fileSignaturePath, @status,
        CASE WHEN @status = 'hidden' THEN CURRENT_TIMESTAMP ELSE NULL END,
        @creatorId, @lastVersionAt
      )`
    )
    .run({
      slug: project.slug,
      title: project.title,
      summary: project.summary,
      description: project.description,
      changelog: project.changelog,
      installation: project.installation,
      requirements: project.requirements,
      nodeVersion: project.nodeVersion,
      pythonVersion: project.pythonVersion,
      osSupport: project.osSupport,
      runExamples: project.runExamples,
      licenseType: project.licenseType,
      codePreview: project.codePreview,
      languages: JSON.stringify(project.languages),
      tags: JSON.stringify(project.tags),
      collections: JSON.stringify(project.collections),
      categories: JSON.stringify(project.categories),
      repositoryUrl: project.repositoryUrl,
      demoUrl: project.demoUrl,
      docsUrl: project.docsUrl,
      videoUrl: project.videoUrl,
      version: project.version,
      priceCents: project.priceCents,
      priceLabel: formatStarsPriceLabel(project.accessTier, project.priceCents),
      accessTier: project.accessTier || "free",
      filePath: filePathFor(packageFile),
      fileName: packageFile ? packageFile.originalname : "",
      fileMime: packageFile ? packageFile.mimetype : "",
      fileSize: packageFile ? packageFile.size : 0,
      fileSha256: fileShaFor(packageFile),
      fileScanStatus: fileScanStatusFor(packageFile),
      fileScanNotes: fileScanNotesFor(packageFile),
      fileSignaturePath: fileSignaturePathFor(packageFile),
      status,
      creatorId,
      lastVersionAt: project.version || project.changelog || packageFile ? new Date().toISOString() : null
    });

  const projectId = Number(result.lastInsertRowid);
  if (project.version || project.changelog || packageFile) {
    insertVersion(projectId, project, packageFile, creatorId);
  }

  insertScreenshots(projectId, files.screenshots || []);
  addProjectFiles(projectId, files.files || []);

  return getProjectById(projectId, creatorId);
}

export function updateProject(id, project, files, editorId) {
  const existing = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  if (!existing) return null;

  const packageFile = files.package?.[0];
  const status = safeStatus(project.status, existing.status);
  const hasVersionChange = Boolean(packageFile || project.version || project.changelog);

  db.prepare(
    `UPDATE projects
     SET slug = @slug,
       title = @title,
       summary = @summary,
       description = @description,
       changelog = @changelog,
       installation = @installation,
       requirements = @requirements,
       node_version = @nodeVersion,
       python_version = @pythonVersion,
       os_support = @osSupport,
       run_examples = @runExamples,
       license_type = @licenseType,
       code_preview = @codePreview,
       languages = @languages,
       tags = @tags,
       collections = @collections,
       categories = @categories,
       repository_url = @repositoryUrl,
       demo_url = @demoUrl,
       docs_url = @docsUrl,
       video_url = @videoUrl,
       version = @version,
       price_cents = @priceCents,
       price_label = @priceLabel,
       access_tier = @accessTier,
       file_path = @filePath,
       file_name = @fileName,
       file_mime = @fileMime,
       file_size = @fileSize,
       file_sha256 = @fileSha256,
       file_scan_status = @fileScanStatus,
       file_scan_notes = @fileScanNotes,
       file_signature_path = @fileSignaturePath,
       status = @status,
       hidden_at = CASE WHEN @status = 'hidden' THEN COALESCE(hidden_at, CURRENT_TIMESTAMP) ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP,
       last_version_at = CASE WHEN @hasVersionChange THEN CURRENT_TIMESTAMP ELSE last_version_at END
     WHERE id = @id`
  ).run({
    id,
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    description: project.description,
    changelog: project.changelog,
    installation: project.installation,
    requirements: project.requirements,
    nodeVersion: project.nodeVersion,
    pythonVersion: project.pythonVersion,
    osSupport: project.osSupport,
    runExamples: project.runExamples,
    licenseType: project.licenseType,
    codePreview: project.codePreview,
    languages: JSON.stringify(project.languages),
    tags: JSON.stringify(project.tags),
    collections: JSON.stringify(project.collections),
    categories: JSON.stringify(project.categories),
    repositoryUrl: project.repositoryUrl,
    demoUrl: project.demoUrl,
    docsUrl: project.docsUrl,
    videoUrl: project.videoUrl,
    version: project.version,
    priceCents: project.priceCents,
    priceLabel: formatStarsPriceLabel(project.accessTier || existing.access_tier, project.priceCents),
    accessTier: project.accessTier || existing.access_tier || "free",
    filePath: packageFile ? filePathFor(packageFile) : existing.file_path || "",
    fileName: packageFile ? packageFile.originalname : existing.file_name || "",
    fileMime: packageFile ? packageFile.mimetype : existing.file_mime || "",
    fileSize: packageFile ? packageFile.size : existing.file_size || 0,
    fileSha256: packageFile ? fileShaFor(packageFile) : existing.file_sha256 || "",
    fileScanStatus: packageFile
      ? fileScanStatusFor(packageFile)
      : existing.file_scan_status || "",
    fileScanNotes: packageFile ? fileScanNotesFor(packageFile) : existing.file_scan_notes || "",
    fileSignaturePath: packageFile
      ? fileSignaturePathFor(packageFile)
      : existing.file_signature_path || "",
    status,
    hasVersionChange: hasVersionChange ? 1 : 0
  });

  if (packageFile) {
    insertVersion(id, project, packageFile, editorId);
  }
  insertScreenshots(id, files.screenshots || []);
  addProjectFiles(id, files.files || []);

  return getProjectById(id, editorId);
}

export function setProjectStatus(id, status) {
  const nextStatus = safeStatus(status, "published");
  db.prepare(
    `UPDATE projects
     SET status = ?,
       hidden_at = CASE WHEN ? = 'hidden' THEN COALESCE(hidden_at, CURRENT_TIMESTAMP) ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(nextStatus, nextStatus, id);
  return getProjectById(id);
}

export function hasBlockedProjectFiles(projectId) {
  const row = db
    .prepare(
      `SELECT
        (
          SELECT COUNT(*)
          FROM projects
          WHERE id = @projectId
            AND COALESCE(file_path, '') != ''
            AND file_scan_status = 'blocked'
        ) +
        (
          SELECT COUNT(*)
          FROM project_versions
          WHERE project_id = @projectId
            AND COALESCE(file_path, '') != ''
            AND file_scan_status = 'blocked'
        ) +
        (
          SELECT COUNT(*)
          FROM project_files
          WHERE project_id = @projectId
            AND COALESCE(file_path, '') != ''
            AND file_scan_status = 'blocked'
        ) AS blocked_count`
    )
    .get({ projectId });
  return (row?.blocked_count || 0) > 0;
}

export function setProjectPinned(id, pinned) {
  db.prepare(
    `UPDATE projects
     SET pinned_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(pinned ? 1 : 0, id);
  return getProjectById(id);
}

export function setProjectWeeklyPick(id, picked) {
  db.prepare(
    `UPDATE projects
     SET weekly_picked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(picked ? 1 : 0, id);
  return getProjectById(id);
}

export function setProjectSeasonalSale(id, percent = 0, endsAt = "") {
  const cleanPercent = Math.max(0, Math.min(95, Number.parseInt(percent, 10) || 0));
  const cleanEndsAt = String(endsAt || "").trim();
  db.prepare(
    `UPDATE projects
     SET seasonal_sale_percent = ?,
       sale_ends_at = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(cleanPercent, cleanEndsAt, id);
  return getProjectById(id);
}

export function archiveProject(id) {
  db.prepare(
    `UPDATE projects
     SET status = 'archived',
       hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
}

export function deleteProjectScreenshot(projectId, screenshotId) {
  const screenshot = db
    .prepare(
      `SELECT id, file_path
       FROM project_screenshots
       WHERE id = ? AND project_id = ?`
    )
    .get(screenshotId, projectId);
  if (!screenshot) return null;

  db.prepare(`DELETE FROM project_screenshots WHERE id = ?`).run(screenshotId);
  db.prepare(
    `UPDATE projects
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(projectId);
  return screenshot;
}

export function setProjectExtraFileHidden(projectId, fileId, hidden) {
  db.prepare(
    `UPDATE project_files
     SET is_hidden = ?,
       hidden_at = CASE WHEN ? THEN COALESCE(hidden_at, CURRENT_TIMESTAMP) ELSE NULL END
     WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).run(hidden ? 1 : 0, hidden ? 1 : 0, fileId, projectId);
  return getProjectById(projectId);
}

export function setProjectVersionHidden(projectId, versionId, hidden) {
  const version = db
    .prepare(`SELECT file_path FROM project_versions WHERE id = ? AND project_id = ?`)
    .get(versionId, projectId);
  if (!version) return null;

  db.prepare(
    `UPDATE project_versions
     SET is_hidden = ?,
       hidden_at = CASE WHEN ? THEN COALESCE(hidden_at, CURRENT_TIMESTAMP) ELSE NULL END
     WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).run(hidden ? 1 : 0, hidden ? 1 : 0, versionId, projectId);

  if (hidden && version.file_path) {
    db.prepare(
      `UPDATE projects
       SET file_path = '',
         file_name = '',
         file_mime = '',
         file_size = 0,
         file_sha256 = '',
         file_scan_status = '',
         file_scan_notes = '',
         file_signature_path = '',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND file_path = ?`
    ).run(projectId, version.file_path);
  }
  return getProjectById(projectId);
}

export function updateProjectExtraFileReview(projectId, fileId, { status = "pending", checklist = {}, notes = "" } = {}) {
  const nextStatus = ["pending", "approved", "changes", "rejected"].includes(status) ? status : "pending";
  db.prepare(
    `UPDATE project_files
     SET review_status = ?,
       review_checklist = ?,
       review_notes = ?
     WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).run(nextStatus, JSON.stringify(checklist || {}), String(notes || ""), fileId, projectId);
  return getProjectById(projectId);
}

export function updateProjectVersionReview(projectId, versionId, { status = "pending", checklist = {}, notes = "" } = {}) {
  const nextStatus = ["pending", "approved", "changes", "rejected"].includes(status) ? status : "pending";
  db.prepare(
    `UPDATE project_versions
     SET review_status = ?,
       review_checklist = ?,
       review_notes = ?
     WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
  ).run(nextStatus, JSON.stringify(checklist || {}), String(notes || ""), versionId, projectId);
  return getProjectById(projectId);
}

export function deleteProjectExtraFile(projectId, fileId) {
  const file = db
    .prepare(
      `SELECT id, file_path, file_signature_path
       FROM project_files
       WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
    )
    .get(fileId, projectId);
  if (!file) return null;

  db.prepare(`UPDATE project_files SET deleted_at = CURRENT_TIMESTAMP, is_hidden = 1 WHERE id = ?`).run(fileId);
  db.prepare(`UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(projectId);
  return file;
}

export function deleteProjectVersion(projectId, versionId) {
  const version = db
    .prepare(
      `SELECT id, file_path, file_signature_path
       FROM project_versions
       WHERE id = ? AND project_id = ? AND deleted_at IS NULL`
    )
    .get(versionId, projectId);
  if (!version) return null;

  db.prepare(`UPDATE project_versions SET deleted_at = CURRENT_TIMESTAMP, is_hidden = 1 WHERE id = ?`).run(versionId);
  if (version.file_path) {
    db.prepare(
      `UPDATE projects
       SET file_path = '',
         file_name = '',
         file_mime = '',
         file_size = 0,
         file_sha256 = '',
         file_scan_status = '',
         file_scan_notes = '',
         file_signature_path = '',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND file_path = ?`
    ).run(projectId, version.file_path);
  }
  return version;
}

export function addFavorite(userId, projectId) {
  db.prepare(
    `INSERT OR IGNORE INTO favorites (user_id, project_id)
     VALUES (?, ?)`
  ).run(userId, projectId);
}

export function removeFavorite(userId, projectId) {
  db.prepare(
    `DELETE FROM favorites
     WHERE user_id = ? AND project_id = ?`
  ).run(userId, projectId);
}

export function recordProjectView(projectId) {
  db.prepare(
    `UPDATE projects
     SET view_count = view_count + 1
     WHERE id = ?`
  ).run(projectId);
}

export function recordDownload(userId, projectId, versionId = null, fileId = null) {
  db.prepare(
    `INSERT INTO downloads (user_id, project_id, version_id, file_id)
     VALUES (?, ?, ?, ?)`
  ).run(userId, projectId, versionId, fileId);

  db.prepare(
    `UPDATE projects
     SET download_count = download_count + 1
     WHERE id = ?`
  ).run(projectId);

  if (versionId) {
    db.prepare(
      `UPDATE project_versions
       SET download_count = download_count + 1
       WHERE id = ?`
    ).run(versionId);
  }

  if (fileId) {
    db.prepare(
      `UPDATE project_files
       SET download_count = download_count + 1
       WHERE id = ?`
    ).run(fileId);
  }
}

export function addReview(userId, projectId, rating, comment) {
  db.prepare(
    `INSERT INTO reviews (user_id, project_id, rating, comment, status)
     VALUES (@userId, @projectId, @rating, @comment, 'published')
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       rating = excluded.rating,
       comment = excluded.comment,
       status = 'published',
       created_at = CURRENT_TIMESTAMP`
  ).run({ userId, projectId, rating, comment });

  return getProjectById(projectId, userId);
}

export function createReport(userId, projectId, reason, details) {
  db.prepare(
    `INSERT INTO reports (user_id, project_id, reason, details)
     VALUES (?, ?, ?, ?)`
  ).run(userId, projectId, reason, details);
}

export function createAuthorReport(userId, authorUserId, reason, details) {
  db.prepare(
    `INSERT INTO author_reports (reporter_user_id, author_user_id, reason, details)
     VALUES (?, ?, ?, ?)`
  ).run(userId, authorUserId, reason, details);
}

export function listAdminReports() {
  const projectReports = db
    .prepare(
      `SELECT r.id, r.reason, r.details, r.status, r.created_at,
        p.id AS project_id, p.slug AS project_slug, p.title AS project_title,
        u.id AS user_id, u.telegram_id, u.first_name, u.last_name, u.username
       FROM reports r
       JOIN projects p ON p.id = r.project_id
       JOIN users u ON u.id = r.user_id
       ORDER BY
         CASE WHEN r.status = 'new' THEN 0 ELSE 1 END ASC,
         r.created_at DESC,
         r.id DESC
       LIMIT 200`
    )
    .all()
    .map((row) => ({
      id: row.id,
      rawId: row.id,
      subjectType: "project",
      reason: row.reason || "",
      details: row.details || "",
      status: row.status || "new",
      createdAt: row.created_at,
      project: {
        id: row.project_id,
        slug: row.project_slug || "",
        title: row.project_title || ""
      },
      author: {
        id: row.user_id,
        telegramId: row.telegram_id || "",
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        username: row.username || ""
      }
    }));

  const authorReports = db
    .prepare(
      `SELECT ar.id, ar.reason, ar.details, ar.status, ar.created_at,
        reporter.id AS reporter_id, reporter.telegram_id AS reporter_telegram_id,
        reporter.first_name AS reporter_first_name, reporter.last_name AS reporter_last_name,
        reporter.username AS reporter_username,
        target.id AS target_id, target.telegram_id AS target_telegram_id,
        target.first_name AS target_first_name, target.last_name AS target_last_name,
        target.username AS target_username, target.is_verified, target.is_trusted, target.is_top_seller
       FROM author_reports ar
       JOIN users reporter ON reporter.id = ar.reporter_user_id
       JOIN users target ON target.id = ar.author_user_id
       ORDER BY
         CASE WHEN ar.status = 'new' THEN 0 ELSE 1 END ASC,
         ar.created_at DESC,
         ar.id DESC
       LIMIT 200`
    )
    .all()
    .map((row) => ({
      id: `author-${row.id}`,
      rawId: row.id,
      subjectType: "author",
      reason: row.reason || "",
      details: row.details || "",
      status: row.status || "new",
      createdAt: row.created_at,
      project: null,
      targetAuthor: {
        id: row.target_id,
        telegramId: row.target_telegram_id || "",
        firstName: row.target_first_name || "",
        lastName: row.target_last_name || "",
        username: row.target_username || "",
        isVerified: Boolean(row.is_verified),
        isTrusted: Boolean(row.is_trusted),
        isTopSeller: Boolean(row.is_top_seller)
      },
      author: {
        id: row.reporter_id,
        telegramId: row.reporter_telegram_id || "",
        firstName: row.reporter_first_name || "",
        lastName: row.reporter_last_name || "",
        username: row.reporter_username || ""
      }
    }));

  return [...projectReports, ...authorReports].sort((a, b) => {
    const statusWeight = (item) => (item.status === "new" ? 0 : 1);
    const weight = statusWeight(a) - statusWeight(b);
    if (weight) return weight;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function setReportStatus(reportId, status, subjectType = "project") {
  const nextStatus = ["new", "reviewing", "resolved", "rejected"].includes(status)
    ? status
    : "new";
  if (subjectType === "author" || String(reportId).startsWith("author-")) {
    const id = String(reportId).replace(/^author-/, "");
    db.prepare(
      `UPDATE author_reports
       SET status = ?
       WHERE id = ?`
    ).run(nextStatus, id);
    return;
  }
  db.prepare(
    `UPDATE reports
     SET status = ?
     WHERE id = ?`
  ).run(nextStatus, reportId);
}

export function listAdminDownloads() {
  return db
    .prepare(
      `SELECT d.id, d.created_at,
        p.id AS project_id, p.slug AS project_slug, p.title AS project_title,
        p.access_tier, p.price_cents,
        pv.id AS version_id, pv.version,
        pf.id AS file_id, pf.file_name AS extra_file_name,
        u.id AS user_id, u.telegram_id, u.first_name, u.last_name, u.username
       FROM downloads d
       JOIN projects p ON p.id = d.project_id
       JOIN users u ON u.id = d.user_id
       LEFT JOIN project_versions pv ON pv.id = d.version_id
       LEFT JOIN project_files pf ON pf.id = d.file_id
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 300`
    )
    .all()
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      project: {
        id: row.project_id,
        slug: row.project_slug || "",
        title: row.project_title || "",
        accessTier: row.access_tier || "free",
        priceLabel: formatStarsPriceLabel(row.access_tier, row.price_cents)
      },
      version: row.version || "",
      versionId: row.version_id || null,
      fileName: row.extra_file_name || "",
      fileId: row.file_id || null,
      user: {
        id: row.user_id,
        telegramId: row.telegram_id || "",
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        username: row.username || ""
      }
    }));
}

export function listDownloads(userId) {
  const rows = db
    .prepare(
      `SELECT d.id AS history_id, d.created_at AS downloaded_at,
        pv.id AS downloaded_version_id, pv.version AS downloaded_version,
        pf.id AS downloaded_file_id, pf.file_name AS downloaded_file_name,
        p.*,
        EXISTS (
          SELECT 1 FROM favorites f
          WHERE f.user_id = @userId AND f.project_id = p.id
        ) AS is_favorite,
        COALESCE((
          SELECT AVG(r.rating)
          FROM reviews r
          WHERE r.project_id = p.id AND COALESCE(r.status, 'published') = 'published'
        ), 0) AS average_rating,
        (
          SELECT COUNT(*)
          FROM reviews r
          WHERE r.project_id = p.id AND COALESCE(r.status, 'published') = 'published'
        ) AS review_count,
        (SELECT COUNT(*) FROM favorites f WHERE f.project_id = p.id) AS favorite_count
       FROM downloads d
       JOIN projects p ON p.id = d.project_id
       LEFT JOIN project_versions pv ON pv.id = d.version_id
       LEFT JOIN project_files pf ON pf.id = d.file_id
       WHERE d.user_id = @userId AND p.status = 'published' AND p.hidden_at IS NULL
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 80`
    )
    .all({ userId });

  return rows.map((row) => ({
    id: row.history_id,
    createdAt: row.downloaded_at,
    versionId: row.downloaded_version_id,
    fileId: row.downloaded_file_id,
    version: row.downloaded_version || row.downloaded_file_name || row.version || "",
    project: normalizeProject(row, {
      screenshots: screenshotsFor(row.id),
      files: filesFor(row.id)
    })
  }));
}

export function listNotifications(userId) {
  return db
    .prepare(
      `SELECT n.id, n.type, n.title, n.body, n.is_read, n.created_at,
        p.id AS project_id, p.slug AS project_slug, p.title AS project_title
       FROM notifications n
       LEFT JOIN projects p ON p.id = n.project_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 80`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body || "",
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
      projectId: row.project_id,
      projectSlug: row.project_slug || "",
      projectTitle: row.project_title || ""
    }));
}

export function markNotificationRead(userId, notificationId) {
  db.prepare(
    `UPDATE notifications
     SET is_read = 1
     WHERE id = ? AND user_id = ?`
  ).run(notificationId, userId);
}

export function getUserProfileStats(userId) {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM favorites f WHERE f.user_id = @userId) AS favorite_count,
        (SELECT COUNT(*) FROM downloads d WHERE d.user_id = @userId) AS download_count,
        (SELECT COUNT(*) FROM reviews r WHERE r.user_id = @userId) AS review_count,
        (
          (SELECT COUNT(*) FROM reports rp WHERE rp.user_id = @userId) +
          (SELECT COUNT(*) FROM author_reports ar WHERE ar.reporter_user_id = @userId)
        ) AS report_count,
        (SELECT COUNT(*) FROM notifications n WHERE n.user_id = @userId AND n.is_read = 0) AS unread_count
       `
    )
    .get({ userId });

  return {
    favorites: row?.favorite_count || 0,
    downloads: row?.download_count || 0,
    reviews: row?.review_count || 0,
    reports: row?.report_count || 0,
    unreadNotifications: row?.unread_count || 0
  };
}

export function getPublicUserProfile(username, viewerId = 0) {
  const user = getUserByUsername(username);
  if (!user) return null;
  const stats = getUserProfileStats(user.id);
  const projects = listProjects({
    userId: viewerId,
    includeAdmin: false,
    sort: "updated"
  }).filter((project) => project.createdBy?.id === user.id);

  return {
    id: user.id,
    telegramId: user.telegram_id || "",
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    username: user.username || "",
    photoUrl: user.photo_url || "",
    isVerified: Boolean(user.is_verified),
    isTrusted: Boolean(user.is_trusted),
    isTopSeller: Boolean(user.is_top_seller),
    createdAt: user.created_at,
    stats: {
      ...stats,
      projects: projects.length
    },
    projects
  };
}

export function createNewProjectNotifications(projectId, excludeUserId = null) {
  const project = db
    .prepare(`SELECT id, title, summary, status, hidden_at FROM projects WHERE id = ?`)
    .get(projectId);
  if (!project || project.status !== "published" || project.hidden_at) return [];

  const users = db
    .prepare(
      `SELECT id, telegram_id
       FROM users
       WHERE COALESCE(is_banned, 0) = 0
         AND (@excludeUserId IS NULL OR id != @excludeUserId)`
    )
    .all({ excludeUserId });

  const insertNotification = db.prepare(
    `INSERT INTO notifications (user_id, project_id, type, title, body)
     SELECT @userId, @projectId, 'project', @title, @body
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE user_id = @userId AND project_id = @projectId AND type = 'project'
     )`
  );

  for (const user of users) {
    insertNotification.run({
      userId: user.id,
      projectId,
      title: `New project: ${project.title}`,
      body: project.summary || "A new project appeared in the catalog."
    });
  }

  return users;
}

export function listProjectFavoriteUsers(projectId) {
  return db
    .prepare(
      `SELECT u.id, u.telegram_id
       FROM favorites f
       JOIN users u ON u.id = f.user_id
       WHERE f.project_id = ? AND COALESCE(u.is_banned, 0) = 0`
    )
    .all(projectId);
}

export function publishProjectVersion(projectId, version, changelog, file, creatorId, { notifyFavorites = true } = {}) {
  const project = db
    .prepare(`SELECT id, title, changelog FROM projects WHERE id = ?`)
    .get(projectId);
  if (!project) return null;

  const date = new Date().toISOString().slice(0, 10);
  const entry = [`${version || "New version"} · ${date}`, changelog]
    .filter(Boolean)
    .join("\n");
  const nextChangelog = [entry, project.changelog || ""].filter(Boolean).join("\n\n");

  const versionPayload = { version, changelog };
  insertVersion(projectId, versionPayload, file, creatorId);

  const filePath = filePathFor(file);
  if (file) {
    db.prepare(
      `UPDATE projects
       SET version = COALESCE(NULLIF(@version, ''), version),
         changelog = @changelog,
         file_path = @filePath,
         file_name = @fileName,
         file_mime = @fileMime,
         file_size = @fileSize,
         file_sha256 = @fileSha256,
         file_scan_status = @fileScanStatus,
         file_scan_notes = @fileScanNotes,
         file_signature_path = @fileSignaturePath,
         updated_at = CURRENT_TIMESTAMP,
         last_version_at = CURRENT_TIMESTAMP
       WHERE id = @projectId`
    ).run({
      projectId,
      version,
      changelog: nextChangelog,
      filePath,
      fileName: file.originalname,
      fileMime: file.mimetype,
      fileSize: file.size,
      fileSha256: fileShaFor(file),
      fileScanStatus: fileScanStatusFor(file),
      fileScanNotes: fileScanNotesFor(file),
      fileSignaturePath: fileSignaturePathFor(file)
    });
  } else {
    db.prepare(
      `UPDATE projects
       SET version = COALESCE(NULLIF(@version, ''), version),
         changelog = @changelog,
         updated_at = CURRENT_TIMESTAMP,
         last_version_at = CURRENT_TIMESTAMP
       WHERE id = @projectId`
    ).run({ projectId, version, changelog: nextChangelog });
  }

  if (notifyFavorites) {
    const favoriteUsers = listProjectFavoriteUsers(projectId);
    const insertNotification = db.prepare(
      `INSERT INTO notifications (user_id, project_id, type, title, body)
       VALUES (?, ?, 'version', ?, ?)`
    );

    for (const favorite of favoriteUsers) {
      insertNotification.run(
        favorite.id,
        projectId,
        `New version: ${project.title}`,
        changelog || version || "Project received an update."
      );
    }
  }

  return getProjectById(projectId, creatorId);
}

export function listAdminUsers() {
  return db
    .prepare(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url,
        u.is_verified, u.is_trusted, u.is_top_seller, u.is_banned, u.ban_reason, u.created_at, u.last_seen_at,
        (SELECT COUNT(*) FROM downloads d WHERE d.user_id = u.id) AS download_count,
        (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorite_count,
        (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count,
        (SELECT COUNT(*) FROM projects p WHERE p.created_by = u.id AND p.status = 'published' AND p.hidden_at IS NULL) AS project_count
       FROM users u
       ORDER BY u.last_seen_at DESC, u.id DESC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      telegramId: row.telegram_id || "",
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      username: row.username || "",
      photoUrl: row.photo_url || "",
      isVerified: Boolean(row.is_verified),
      isTrusted: Boolean(row.is_trusted),
      isTopSeller: Boolean(row.is_top_seller),
      isBanned: Boolean(row.is_banned),
      banReason: row.ban_reason || "",
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      downloadCount: row.download_count || 0,
      favoriteCount: row.favorite_count || 0,
      reviewCount: row.review_count || 0,
      projectCount: row.project_count || 0
    }));
}

export function setUserVerified(userId, verified) {
  db.prepare(
    `UPDATE users
     SET is_verified = ?
     WHERE id = ?`
  ).run(verified ? 1 : 0, userId);
  return getUserById(userId);
}

export function setUserBadges(userId, badges = {}) {
  const current = getUserById(userId);
  if (!current) return null;
  db.prepare(
    `UPDATE users
     SET is_verified = ?,
       is_trusted = ?,
       is_top_seller = ?
     WHERE id = ?`
  ).run(
    badges.verified === undefined ? current.is_verified : badges.verified ? 1 : 0,
    badges.trusted === undefined ? current.is_trusted : badges.trusted ? 1 : 0,
    badges.topSeller === undefined ? current.is_top_seller : badges.topSeller ? 1 : 0,
    userId
  );
  return getUserById(userId);
}

export function setUserBanned(userId, banned, reason = "") {
  db.prepare(
    `UPDATE users
     SET is_banned = ?,
       ban_reason = ?
     WHERE id = ?`
  ).run(banned ? 1 : 0, banned ? reason : "", userId);
  return getUserById(userId);
}

export function listAdminReviews() {
  return db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
        p.id AS project_id, p.slug AS project_slug, p.title AS project_title,
        u.id AS user_id, u.telegram_id, u.first_name, u.last_name, u.username
       FROM reviews r
       JOIN projects p ON p.id = r.project_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 200`
    )
    .all()
    .map(normalizeAdminReview);
}

export function setReviewStatus(reviewId, status) {
  const nextStatus = status === "hidden" ? "hidden" : "published";
  db.prepare(
    `UPDATE reviews
     SET status = ?
     WHERE id = ?`
  ).run(nextStatus, reviewId);
}

export function deleteReview(reviewId) {
  db.prepare(`DELETE FROM reviews WHERE id = ?`).run(reviewId);
}

export function createBroadcastNotifications(title, body) {
  const users = db
    .prepare(`SELECT id, telegram_id FROM users WHERE COALESCE(is_banned, 0) = 0`)
    .all();
  const insertNotification = db.prepare(
    `INSERT INTO notifications (user_id, type, title, body)
     VALUES (?, 'broadcast', ?, ?)`
  );

  for (const user of users) {
    insertNotification.run(user.id, title, body);
  }

  return users;
}

export function createAuthorProjectNotification(projectId, title, body) {
  const project = db
    .prepare(
      `SELECT p.id, p.title AS project_title, p.created_by,
        u.id AS user_id, u.telegram_id
       FROM projects p
       JOIN users u ON u.id = p.created_by
       WHERE p.id = ?`
    )
    .get(projectId);
  if (!project?.user_id) return null;

  db.prepare(
    `INSERT INTO notifications (user_id, project_id, type, title, body)
     VALUES (?, ?, 'author_message', ?, ?)`
  ).run(
    project.user_id,
    projectId,
    title || `Project message: ${project.project_title}`,
    body || ""
  );

  return project;
}

export function getStats() {
  const projects = db
    .prepare(`SELECT COUNT(*) AS count FROM projects WHERE status = 'published' AND hidden_at IS NULL`)
    .get();
  const users = db.prepare(`SELECT COUNT(*) AS count FROM users`).get();
  const downloads = db
    .prepare(`SELECT COALESCE(SUM(download_count), 0) AS count FROM projects`)
    .get();
  const reviews = db
    .prepare(`SELECT COUNT(*) AS count FROM reviews WHERE COALESCE(status, 'published') = 'published'`)
    .get();
  const reports = db.prepare(`SELECT COUNT(*) AS count FROM reports WHERE status = 'new'`).get();
  const views = db.prepare(`SELECT COALESCE(SUM(view_count), 0) AS count FROM projects`).get();
  const favorites = db.prepare(`SELECT COUNT(*) AS count FROM favorites`).get();

  return {
    projects: projects.count,
    users: users.count,
    downloads: downloads.count,
    reviews: reviews.count,
    reports: reports.count,
    views: views.count,
    favorites: favorites.count
  };
}

export function listFilterOptions() {
  const rows = db
    .prepare(
      `SELECT languages, tags, collections, categories
       FROM projects
       WHERE status = 'published' AND hidden_at IS NULL`
    )
    .all();

  const collect = (key) =>
    [
      ...new Set(
        rows
          .flatMap((row) => parseJsonArray(row[key]))
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));

  return {
    languages: collect("languages"),
    tags: collect("tags"),
    collections: collect("collections"),
    categories: collect("categories")
  };
}
