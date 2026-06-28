import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const baseUrl = "http://localhost:7870";
const rootDir = process.cwd();
const uploadsDir = path.resolve(rootDir, "data/uploads");
const stamp = Date.now();
const safeSlug = `security-check-${stamp}`;
const paidSlug = `security-paid-${stamp}`;
const blockedSlug = `security-blocked-${stamp}`;

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "object" ? payload.error : payload;
    throw new Error(`${pathname}: HTTP ${response.status} ${message}`);
  }

  return payload;
}

async function createProject(token, fields, fileName = null, body = "") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, String(value));
  }
  if (fileName) {
    form.set("package", new Blob([body], { type: "text/plain" }), fileName);
  }

  return api("/api/projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

function cleanup() {
  const db = new DatabaseSync(path.resolve(rootDir, "data/app.sqlite"));
  db.exec("PRAGMA foreign_keys = ON;");
  const slugs = [safeSlug, paidSlug, blockedSlug];
  const placeholders = slugs.map(() => "?").join(",");
  const projectIds = db
    .prepare(`SELECT id FROM projects WHERE slug IN (${placeholders})`)
    .all(...slugs)
    .map((row) => row.id);

  if (projectIds.length) {
    const projectPlaceholders = projectIds.map(() => "?").join(",");
    const files = [
      ...db
        .prepare(`SELECT file_path, file_signature_path FROM projects WHERE id IN (${projectPlaceholders})`)
        .all(...projectIds),
      ...db
        .prepare(`SELECT file_path, file_signature_path FROM project_versions WHERE project_id IN (${projectPlaceholders})`)
        .all(...projectIds),
      ...db
        .prepare(`SELECT file_path, file_signature_path FROM project_files WHERE project_id IN (${projectPlaceholders})`)
        .all(...projectIds)
    ];

    for (const file of files) {
      for (const relativePath of [file.file_path, file.file_signature_path]) {
        if (!relativePath) continue;
        const absolutePath = path.resolve(uploadsDir, relativePath);
        if (absolutePath.startsWith(uploadsDir)) {
          fs.rmSync(absolutePath, { force: true });
        }
      }
    }

    db.prepare(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`).run(...projectIds);
  }

  db.close();
}

try {
  const auth = await api("/api/auth/dev", { method: "POST" });
  const token = auth.token;
  const authHeader = { Authorization: `Bearer ${token}` };

  const safe = await createProject(
    token,
    {
      title: "Security Check Safe",
      slug: safeSlug,
      status: "published",
      summary: "temporary security test",
      version: "v1.0.0"
    },
    "safe-script.js",
    "console.log('safe');\n"
  );

  if (safe.project.fileScanStatus !== "clean") {
    throw new Error(`expected clean scan, got ${safe.project.fileScanStatus}`);
  }
  if (!safe.project.fileSha256 || safe.project.fileSha256.length !== 64) {
    throw new Error("missing SHA-256 on project file");
  }
  if (!safe.project.fileSignatureUrl) {
    throw new Error("missing signature URL");
  }

  const signatureResponse = await fetch(`${baseUrl}${safe.project.fileSignatureUrl}`);
  const signatureText = await signatureResponse.text();
  if (!signatureResponse.ok || !signatureText.includes(safe.project.fileSha256)) {
    throw new Error("signature file does not contain project SHA-256");
  }

  const paid = await createProject(token, {
    title: "Security Check Paid",
    slug: paidSlug,
    status: "draft",
    accessTier: "free",
    priceCents: "12300",
    priceLabel: "ignored legacy label"
  });
  if (paid.project.accessTier !== "paid") {
    throw new Error(`price auto-tier failed: ${paid.project.accessTier}`);
  }
  if (paid.project.priceLabel !== "12300 Stars") {
    throw new Error(`non-Stars price label leaked: ${paid.project.priceLabel}`);
  }

  let blocked = false;
  try {
    await createProject(
      token,
      {
        title: "Security Check Blocked",
        slug: blockedSlug,
        status: "draft"
      },
      "installer.exe",
      "MZ"
    );
  } catch (error) {
    blocked = error.message.includes("executable extension");
  }
  if (!blocked) {
    throw new Error("dangerous executable upload was not blocked");
  }

  await api(`/api/projects/${safe.project.id}/reports`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "malware", details: "temporary malware report check" })
  });

  const downloadResponse = await fetch(
    `${baseUrl}/api/projects/${safe.project.id}/download?token=${encodeURIComponent(token)}`
  );
  if (!downloadResponse.ok) {
    throw new Error(`download failed with HTTP ${downloadResponse.status}`);
  }

  const reports = await api("/api/admin/reports", { headers: authHeader });
  if (!reports.reports.some((report) => report.project.id === safe.project.id && report.reason === "malware")) {
    throw new Error("malware report was not listed in admin reports");
  }

  const downloads = await api("/api/admin/downloads", { headers: authHeader });
  if (!downloads.downloads.some((item) => item.project.id === safe.project.id)) {
    throw new Error("download was not listed in admin download log");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectScan: safe.project.fileScanStatus,
        signature: Boolean(safe.project.fileSignatureUrl),
        blockedExecutable: blocked,
        autoPaidTier: paid.project.accessTier,
        reportsChecked: true,
        downloadsChecked: true
      },
      null,
      2
    )
  );
} finally {
  cleanup();
}
