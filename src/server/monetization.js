import { formatStarsPriceLabel, getDb, getUserByTelegramId } from "./db.js";

// Monetization layer: access tiers, one-time purchases ("Buy source"),
// promo codes, subscriptions, paid VIP section, custom-development orders, and
// daily download limits for regular users. Shares the same WAL database as db.js.

export const ACCESS_TIERS = ["free", "paid", "subscription", "vip"];
const PROMO_TYPES = new Set(["project", "subscription", "vip"]);
const REQUEST_TYPES = new Set(["source", "custom", "subscription", "vip"]);
const REQUEST_STATUSES = new Set(["new", "in_progress", "done", "rejected"]);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function createStarsInvoiceLink(config, { title, description, payload, amount }) {
  if (!config.botToken) throw badRequest("BOT_TOKEN is required for Telegram Stars checkout.");
  const stars = Math.max(1, Number.parseInt(amount, 10) || 1);
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      payload,
      currency: "XTR",
      prices: [{ label: title, amount: stars }]
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw badRequest(data.description || `Telegram Stars invoice failed with HTTP ${response.status}`);
  }
  return data.result;
}

function columnExists(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initMonetization() {
  const db = getDb();

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'project',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      days INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(promo_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS custom_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      message TEXT,
      budget TEXT,
      contact TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn(db, "projects", "access_tier", "TEXT NOT NULL DEFAULT 'free'");
  ensureColumn(db, "users", "is_vip", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "vip_until", "TEXT");
  ensureColumn(db, "users", "subscription_until", "TEXT");
}

/* ---------------- access tier ---------------- */

export function normalizeTier(value, fallback = "free") {
  return ACCESS_TIERS.includes(value) ? value : fallback;
}

function activeStarsPrice(project) {
  const base = Math.max(0, Number.parseInt(project?.price_cents, 10) || 0);
  const percent = Math.max(0, Math.min(95, Number.parseInt(project?.seasonal_sale_percent, 10) || 0));
  const endsAt = project?.sale_ends_at || "";
  const saleActive = percent > 0 && (!endsAt || new Date(String(endsAt).replace(" ", "T")).getTime() > Date.now());
  return saleActive && base > 0 ? Math.max(1, Math.round(base * (100 - percent) / 100)) : base;
}

export function setProjectAccessTier(projectId, tier) {
  const db = getDb();
  const nextTier = normalizeTier(tier);
  const project = db.prepare(`SELECT price_cents FROM projects WHERE id = ?`).get(projectId);
  db
    .prepare(`UPDATE projects SET access_tier = ?, price_label = ? WHERE id = ?`)
    .run(nextTier, formatStarsPriceLabel(nextTier, project?.price_cents || 0), projectId);
}

function tierMap(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  return new Map(
    getDb()
      .prepare(`SELECT id, access_tier FROM projects WHERE id IN (${placeholders})`)
      .all(...ids)
      .map((row) => [row.id, row.access_tier || "free"])
  );
}

function ownedSet(userId, ids) {
  if (!userId || !ids.length) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  return new Set(
    getDb()
      .prepare(
        `SELECT project_id FROM purchases
         WHERE status = 'paid' AND user_id = ? AND project_id IN (${placeholders})`
      )
      .all(userId, ...ids)
      .map((row) => row.project_id)
  );
}

// Attach accessTier + owned to a list of normalized projects (mutates + returns).
export function enrichProjects(userId, projects) {
  const list = Array.isArray(projects) ? projects : [];
  const ids = list.map((project) => project.id);
  const tiers = tierMap(ids);
  const owned = ownedSet(userId, ids);

  for (const project of list) {
    project.accessTier = tiers.get(project.id) || "free";
    project.owned = owned.has(project.id);
  }
  return list;
}

export function enrichProject(userId, project) {
  if (!project) return project;
  enrichProjects(userId, [project]);
  return project;
}

/* ---------------- account state ---------------- */

export function getAccountState(user, config) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        CASE WHEN is_vip = 1 AND (vip_until IS NULL OR vip_until > datetime('now'))
          THEN 1 ELSE 0 END AS vip_active,
        CASE WHEN subscription_until IS NOT NULL AND subscription_until > datetime('now')
          THEN 1 ELSE 0 END AS sub_active,
        vip_until, subscription_until
       FROM users WHERE id = ?`
    )
    .get(user.id);

  const downloadsToday =
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM downloads
         WHERE user_id = ? AND created_at >= datetime('now', 'start of day')`
      )
      .get(user.id)?.count || 0;

  const isVip = Boolean(row?.vip_active);
  const isSubscriber = Boolean(row?.sub_active);
  const unlimited = isVip || isSubscriber;
  const limit = config.freeDailyDownloadLimit;

  return {
    isVip,
    isSubscriber,
    unlimited,
    vipUntil: row?.vip_until || null,
    subscriptionUntil: row?.subscription_until || null,
    downloadsToday,
    downloadLimit: limit,
    remaining: unlimited ? null : Math.max(0, limit - downloadsToday),
    subscriptionPriceLabel: config.subscriptionPriceLabel,
    subscriptionDays: config.subscriptionDays,
    vipPriceLabel: config.vipPriceLabel,
    vipDays: config.vipDays,
    testCheckout: config.allowTestCheckout
  };
}

export function hasPurchase(userId, projectId) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM purchases
         WHERE user_id = ? AND project_id = ? AND status = 'paid'`
      )
      .get(userId, projectId)
  );
}

// Decide whether a user may download a project, given its access tier.
export function evaluateDownloadAccess(user, project, account) {
  const tier = normalizeTier(project.accessTier || project.access_tier);

  if (account.isVip) return { allowed: true };
  if (hasPurchase(user.id, project.id)) return { allowed: true };

  if (tier === "paid") {
    return { allowed: false, status: 402, reason: "need_purchase", message: "Buy the project source first." };
  }
  if (tier === "vip") {
    return { allowed: false, status: 402, reason: "need_vip", message: "This project is available only in the VIP section." };
  }
  if (tier === "subscription") {
    if (account.isSubscriber) return { allowed: true };
    return { allowed: false, status: 402, reason: "need_subscription", message: "This project is available by subscription." };
  }

  // free tier: enforce the daily limit for regular users only
  if (!account.unlimited && account.remaining <= 0) {
    return {
      allowed: false,
      status: 429,
      reason: "limit",
      message: `Daily download limit reached (${account.downloadLimit}/day). Subscribe or get VIP for unlimited downloads.`
    };
  }
  return { allowed: true };
}

/* ---------------- purchases ---------------- */

function recordPurchase(userId, projectId, { amountCents = 0, status = "paid", source = "purchase", promoCode = "" }) {
  getDb()
    .prepare(
      `INSERT INTO purchases (user_id, project_id, amount_cents, status, source, promo_code)
       VALUES (@userId, @projectId, @amountCents, @status, @source, @promoCode)
       ON CONFLICT(user_id, project_id) DO UPDATE SET
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         source = excluded.source,
         promo_code = excluded.promo_code,
         created_at = CURRENT_TIMESTAMP`
    )
    .run({ userId, projectId, amountCents, status, source, promoCode });
  return getDb()
    .prepare(`SELECT id FROM purchases WHERE user_id = ? AND project_id = ?`)
    .get(userId, projectId)?.id;
}

export async function purchaseProject(user, projectId, config) {
  const project = getDb()
    .prepare(
      `SELECT id, title, access_tier, price_cents, price_label, seasonal_sale_percent, sale_ends_at
       FROM projects WHERE id = ?`
    )
    .get(projectId);
  if (!project) return null;

  if (hasPurchase(user.id, project.id)) {
    return { status: "owned" };
  }

  const tier = normalizeTier(project.access_tier);
  const amountStars = activeStarsPrice(project);
  if (tier === "free" && amountStars === 0) {
    return { status: "free" };
  }

  if (config.allowTestCheckout) {
    recordPurchase(user.id, project.id, {
      amountCents: amountStars,
      status: "paid",
      source: "test"
    });
    return { status: "paid", title: project.title };
  }

  const purchaseId = recordPurchase(user.id, project.id, {
    amountCents: amountStars,
    status: "pending",
    source: "stars"
  });
  const invoiceUrl = await createStarsInvoiceLink(config, {
    title: project.title,
    description: formatStarsPriceLabel(tier, amountStars),
    payload: `p:${purchaseId}`,
    amount: amountStars || 1
  });
  return { status: "invoice", title: project.title, invoiceUrl };

  recordPurchase(user.id, project.id, {
    amountCents: amountStars,
    status: "pending",
    source: "order"
  });
  createCustomRequest({
    userId: user.id,
    projectId: project.id,
    type: "source",
    message: `Source purchase request: ${project.title}`
  });
  return { status: "pending", title: project.title };
}

export function listPurchases() {
  return getDb()
    .prepare(
      `SELECT pur.id, pur.amount_cents, pur.status, pur.source, pur.promo_code, pur.created_at,
        p.title AS project_title, p.slug AS project_slug,
        u.telegram_id, u.first_name, u.username
       FROM purchases pur
       JOIN projects p ON p.id = pur.project_id
       JOIN users u ON u.id = pur.user_id
       ORDER BY pur.created_at DESC, pur.id DESC
       LIMIT 200`
    )
    .all()
    .map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      amountStars: row.amount_cents,
      status: row.status,
      source: row.source,
      promoCode: row.promo_code || "",
      createdAt: row.created_at,
      projectTitle: row.project_title,
      projectSlug: row.project_slug,
      telegramId: row.telegram_id || "",
      userName: row.first_name || row.username || ""
    }));
}

export function listUserPurchases(userId) {
  return getDb()
    .prepare(
      `SELECT pur.id, pur.amount_cents, pur.status, pur.source, pur.created_at,
        p.id AS project_id, p.slug AS project_slug, p.title AS project_title,
        p.summary AS project_summary, p.version AS project_version,
        p.access_tier, p.price_cents, p.download_count
       FROM purchases pur
       JOIN projects p ON p.id = pur.project_id
       WHERE pur.user_id = ?
         AND pur.status = 'paid'
       ORDER BY pur.created_at DESC, pur.id DESC`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      amountStars: row.amount_cents || 0,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      project: {
        id: row.project_id,
        slug: row.project_slug || "",
        title: row.project_title || "",
        summary: row.project_summary || "",
        version: row.project_version || "",
        accessTier: row.access_tier || "free",
        priceCents: row.price_cents || 0,
        priceLabel: formatStarsPriceLabel(row.access_tier, row.price_cents),
        downloadCount: row.download_count || 0,
        screenshots: [],
        categories: [],
        collections: [],
        languages: [],
        tags: []
      }
    }));
}

export function confirmPurchase(purchaseId) {
  getDb()
    .prepare(`UPDATE purchases SET status = 'paid' WHERE id = ?`)
    .run(purchaseId);
}

/* ---------------- subscription / VIP ---------------- */

export function grantSubscription(userId, days) {
  const span = Number.parseInt(days, 10) || 0;
  if (span <= 0) return;
  getDb()
    .prepare(
      `UPDATE users
       SET subscription_until = datetime(
         CASE WHEN subscription_until > datetime('now') THEN subscription_until ELSE datetime('now') END,
         ?)
       WHERE id = ?`
    )
    .run(`+${span} days`, userId);
}

export function grantVip(userId, days) {
  const span = Number.parseInt(days, 10) || 0;
  if (span > 0) {
    getDb()
      .prepare(
        `UPDATE users
         SET is_vip = 1,
           vip_until = datetime(
             CASE WHEN vip_until > datetime('now') THEN vip_until ELSE datetime('now') END,
             ?)
         WHERE id = ?`
      )
      .run(`+${span} days`, userId);
  } else {
    getDb()
      .prepare(`UPDATE users SET is_vip = 1, vip_until = NULL WHERE id = ?`)
      .run(userId);
  }
}

export async function subscribe(user, config) {
  if (config.allowTestCheckout) {
    grantSubscription(user.id, config.subscriptionDays);
    return { status: "active", account: getAccountState(user, config) };
  }
  const invoiceUrl = await createStarsInvoiceLink(config, {
    title: "Dev Hub Subscription",
    description: config.subscriptionPriceLabel,
    payload: `s:${user.id}:${config.subscriptionDays}`,
    amount: config.subscriptionStars
  });
  return { status: "invoice", invoiceUrl };
  createCustomRequest({
    userId: user.id,
    type: "subscription",
    message: "Subscription request"
  });
  return { status: "pending" };
}

export async function buyVip(user, config) {
  if (config.allowTestCheckout) {
    grantVip(user.id, config.vipDays);
    return { status: "active", account: getAccountState(user, config) };
  }
  const invoiceUrl = await createStarsInvoiceLink(config, {
    title: "Dev Hub VIP",
    description: config.vipPriceLabel,
    payload: `v:${user.id}:${config.vipDays}`,
    amount: config.vipStars
  });
  return { status: "invoice", invoiceUrl };
  createCustomRequest({
    userId: user.id,
    type: "vip",
    message: "VIP access request"
  });
  return { status: "pending" };
}

export function completeStarsPayload(payload) {
  const [type, id, days] = String(payload || "").split(":");
  if (type === "p" && id) {
    confirmPurchase(id);
    return { ok: true, type: "project" };
  }
  if (type === "s" && id) {
    grantSubscription(id, Number.parseInt(days, 10) || 30);
    return { ok: true, type: "subscription" };
  }
  if (type === "v" && id) {
    grantVip(id, Number.parseInt(days, 10) || 0);
    return { ok: true, type: "vip" };
  }
  throw badRequest("Unknown Telegram Stars payload.");
}

export function grantByTelegramId(telegramId, kind, days) {
  const id = String(telegramId || "").trim();
  if (!id) throw badRequest("Enter Telegram ID.");
  const user = getUserByTelegramId(id);
  if (!user) throw badRequest("No user with this Telegram ID was found. They must open the app at least once.");

  if (kind === "vip") {
    grantVip(user.id, Number.parseInt(days, 10) || 0);
  } else if (kind === "subscription") {
    grantSubscription(user.id, Number.parseInt(days, 10) || 30);
  } else {
    throw badRequest("Access type must be vip or subscription.");
  }
  return { ok: true };
}

/* ---------------- promo codes ---------------- */

export function createPromoCode(body) {
  const code = String(body.code || "").trim();
  if (code.length < 3) throw badRequest("Code must be at least 3 characters long.");

  const type = String(body.type || "project").trim();
  if (!PROMO_TYPES.has(type)) throw badRequest("Promo code type must be project, subscription or vip.");

  const projectId = type === "project" ? Number.parseInt(body.projectId, 10) || null : null;
  if (type === "project" && !projectId) throw badRequest("Enter a project ID for a project promo code.");

  const days = Number.parseInt(body.days, 10) || 0;
  const maxUses = Math.max(0, Number.parseInt(body.maxUses, 10) || 0);
  const expiresAt = String(body.expiresAt || "").trim() || null;

  const result = getDb()
    .prepare(
      `INSERT INTO promo_codes (code, type, project_id, days, max_uses, expires_at)
       VALUES (@code, @type, @projectId, @days, @maxUses, @expiresAt)`
    )
    .run({ code, type, projectId, days, maxUses, expiresAt });

  return { id: Number(result.lastInsertRowid), code, type };
}

export function listPromoCodes() {
  return getDb()
    .prepare(
      `SELECT pc.*, p.title AS project_title
       FROM promo_codes pc
       LEFT JOIN projects p ON p.id = pc.project_id
       ORDER BY pc.created_at DESC, pc.id DESC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      projectId: row.project_id,
      projectTitle: row.project_title || "",
      days: row.days,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at || "",
      isActive: Boolean(row.is_active),
      createdAt: row.created_at
    }));
}

export function deactivatePromoCode(id) {
  getDb().prepare(`UPDATE promo_codes SET is_active = 0 WHERE id = ?`).run(id);
}

export function redeemPromo(user, codeInput, config) {
  const code = String(codeInput || "").trim();
  if (!code) throw badRequest("Enter promo code.");

  const db = getDb();
  const promo = db
    .prepare(`SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE`)
    .get(code);

  if (!promo || !promo.is_active) throw badRequest("Promo code is invalid.");
  if (promo.expires_at) {
    const expired = db
      .prepare(`SELECT (expires_at <= datetime('now')) AS expired FROM promo_codes WHERE id = ?`)
      .get(promo.id)?.expired;
    if (expired) throw badRequest("Promo code has expired.");
  }
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
    throw badRequest("Promo code redemption limit has been reached.");
  }

  const alreadyUsed = db
    .prepare(`SELECT 1 FROM promo_redemptions WHERE promo_id = ? AND user_id = ?`)
    .get(promo.id, user.id);
  if (alreadyUsed) throw badRequest("You have already redeemed this promo code.");

  db.exec("BEGIN");
  try {
    if (promo.type === "project") {
      recordPurchase(user.id, promo.project_id, {
        amountCents: 0,
        status: "paid",
        source: "promo",
        promoCode: promo.code
      });
    } else if (promo.type === "subscription") {
      grantSubscription(user.id, promo.days || config.subscriptionDays);
    } else if (promo.type === "vip") {
      grantVip(user.id, promo.days || config.vipDays);
    }

    db.prepare(`INSERT INTO promo_redemptions (promo_id, user_id) VALUES (?, ?)`).run(promo.id, user.id);
    db.prepare(`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?`).run(promo.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    ok: true,
    type: promo.type,
    projectId: promo.project_id || null,
    account: getAccountState(user, config)
  };
}

/* ---------------- custom requests ("Order customization") ---------------- */

export function createCustomRequest({ userId, projectId = null, type = "custom", message = "", budget = "", contact = "" }) {
  const requestType = REQUEST_TYPES.has(type) ? type : "custom";
  const text = String(message || "").trim();
  if (!text && (requestType === "custom" || requestType === "source")) {
    throw badRequest("Describe the task in the message.");
  }

  getDb()
    .prepare(
      `INSERT INTO custom_requests (user_id, project_id, type, message, budget, contact)
       VALUES (@userId, @projectId, @type, @message, @budget, @contact)`
    )
    .run({
      userId,
      projectId: projectId ? Number.parseInt(projectId, 10) || null : null,
      type: requestType,
      message: text,
      budget: String(budget || "").trim(),
      contact: String(contact || "").trim()
    });
  return { ok: true };
}

export function listCustomRequests() {
  return getDb()
    .prepare(
      `SELECT cr.id, cr.type, cr.message, cr.budget, cr.contact, cr.status, cr.created_at,
        p.title AS project_title,
        u.telegram_id, u.first_name, u.username
       FROM custom_requests cr
       LEFT JOIN projects p ON p.id = cr.project_id
       JOIN users u ON u.id = cr.user_id
       ORDER BY cr.created_at DESC, cr.id DESC
       LIMIT 200`
    )
    .all()
    .map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message || "",
      budget: row.budget || "",
      contact: row.contact || "",
      status: row.status,
      createdAt: row.created_at,
      projectTitle: row.project_title || "",
      telegramId: row.telegram_id || "",
      userName: row.first_name || row.username || ""
    }));
}

export function setCustomRequestStatus(id, status) {
  const next = REQUEST_STATUSES.has(status) ? status : "new";
  getDb().prepare(`UPDATE custom_requests SET status = ? WHERE id = ?`).run(next, id);
}

export function listUserRequests(userId) {
  return getDb()
    .prepare(
      `SELECT cr.id, cr.type, cr.message, cr.budget, cr.status, cr.created_at,
        p.title AS project_title
       FROM custom_requests cr
       LEFT JOIN projects p ON p.id = cr.project_id
       WHERE cr.user_id = ?
       ORDER BY cr.created_at DESC, cr.id DESC
       LIMIT 50`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message || "",
      budget: row.budget || "",
      status: row.status,
      createdAt: row.created_at,
      projectTitle: row.project_title || ""
    }));
}
