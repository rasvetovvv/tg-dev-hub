import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function ensureRuntimeDirs(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.mkdirSync(path.join(config.uploadsDir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(config.uploadsDir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(config.uploadsDir, "signatures"), { recursive: true });
}

export function createStoredFilename(originalName) {
  const ext = path.extname(originalName || "").toLowerCase().slice(0, 16);
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

export function publicUploadUrl(relativePath) {
  if (!relativePath) return "";
  return `/uploads/${relativePath.replaceAll("\\", "/")}`;
}

export function resolveUploadPath(config, relativePath) {
  const resolved = path.resolve(config.uploadsDir, relativePath);
  if (!resolved.startsWith(config.uploadsDir)) {
    throw new Error("Invalid upload path");
  }
  return resolved;
}

export function removeFileIfExists(config, relativePath) {
  if (!relativePath) return;
  const filePath = resolveUploadPath(config, relativePath);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

export const screenshotMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);
