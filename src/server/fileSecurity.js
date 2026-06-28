import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const blockedExtensions = new Set([
  ".apk",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".dmg",
  ".exe",
  ".msi",
  ".ps1",
  ".scr",
  ".vbs",
  ".wsf"
]);

const suspiciousPatterns = [
  { label: "PowerShell command", pattern: /\bpowershell(?:\.exe)?\b/i },
  { label: "remote shell/download command", pattern: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b.+https?:\/\//i },
  { label: "destructive shell command", pattern: /\brm\s+-rf\s+[/~$*]/i },
  { label: "dynamic eval/exec usage", pattern: /\b(?:eval|exec|child_process|subprocess\.Popen)\b/i },
  { label: "encoded payload marker", pattern: /\b(?:base64\s+-d|fromCharCode|atob\(|EncodedCommand)\b/i },
  { label: "possible leaked secret", pattern: /\b(?:BOT_TOKEN|API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN)\b/i }
];

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);

  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest("hex");
}

function readTextHead(filePath, maxBytes = 512 * 1024) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(maxBytes);

  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function packagePathFor(file) {
  return path.posix.join("packages", file.filename);
}

function signaturePathFor(file) {
  const base = path.parse(file.filename).name || crypto.randomUUID();
  return path.posix.join("signatures", `${base}.signature.txt`);
}

function writeSignature(config, file, context, scan) {
  const signaturePath = signaturePathFor(file);
  const absolutePath = path.join(config.uploadsDir, signaturePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  fs.writeFileSync(
    absolutePath,
    [
      "Dev Hub file signature",
      `Project: ${context.projectTitle || "new project"}`,
      `Project ID: ${context.projectId || "pending"}`,
      `Original file: ${file.originalname || ""}`,
      `Stored file: ${packagePathFor(file)}`,
      `Size: ${file.size || 0} bytes`,
      `SHA-256: ${scan.sha256}`,
      `Scan status: ${scan.status}`,
      `Scan notes: ${scan.notes || "clean"}`,
      `Signed at: ${new Date().toISOString()}`
    ].join("\n"),
    "utf8"
  );

  return signaturePath;
}

export function scanUploadFile(file) {
  const originalName = String(file.originalname || "");
  const extension = path.extname(originalName).toLowerCase();

  if (originalName.includes("..") || originalName.includes("/") || originalName.includes("\\")) {
    return {
      status: "blocked",
      notes: "Blocked: invalid file name path",
      sha256: ""
    };
  }

  if (blockedExtensions.has(extension)) {
    return {
      status: "blocked",
      notes: `Blocked: executable extension ${extension}`,
      sha256: ""
    };
  }

  const sha256 = sha256File(file.path);
  const textHead = readTextHead(file.path);
  const warnings = suspiciousPatterns
    .filter((item) => item.pattern.test(textHead))
    .map((item) => item.label);

  return {
    status: warnings.length ? "warning" : "clean",
    notes: warnings.join(", "),
    sha256
  };
}

export function prepareUploadedFile(config, file, context = {}) {
  if (!file || file.fieldname === "screenshots") return file;
  if (file.size > config.maxUploadBytes) {
    throw createHttpError(`File is larger than ${config.maxUploadMb} MB`, 413);
  }

  const scan = scanUploadFile(file);
  file.fileSha256 = scan.sha256;
  file.fileScanStatus = scan.status;
  file.fileScanNotes = scan.notes;

  if (scan.status === "blocked") {
    fs.rmSync(file.path, { force: true });
    throw createHttpError(scan.notes, 400);
  }

  file.fileSignaturePath = writeSignature(config, file, context, scan);
  return file;
}

function removePreparedFile(config, file) {
  if (!file || file.fieldname === "screenshots") return;
  fs.rmSync(file.path, { force: true });
  if (file.fileSignaturePath) {
    fs.rmSync(path.join(config.uploadsDir, file.fileSignaturePath), { force: true });
  }
}

export function prepareUploadedFiles(config, files, context = {}) {
  const items = [];
  if (files?.package) items.push(...files.package);
  if (files?.files) items.push(...files.files);
  if (Array.isArray(files)) items.push(...files);

  try {
    for (const file of items) {
      prepareUploadedFile(config, file, context);
    }
  } catch (error) {
    for (const file of items) {
      removePreparedFile(config, file);
    }
    throw error;
  }

  return files;
}
