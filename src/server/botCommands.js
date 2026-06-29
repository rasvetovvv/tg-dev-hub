import { Markup } from "telegraf";
import {
  getStats,
  getUserProfileStats,
  listProjects,
  upsertTelegramUser
} from "./db.js";
import { enrichProjects, getAccountState } from "./monetization.js";
import { isAdminTelegramId } from "./security.js";

const commandLabels = {
  start: "Main menu",
  new: "Latest projects",
  top: "Popular projects",
  saved: "Saved",
  profile: "Profile"
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function trimText(value, max = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatProjectPrice(project) {
  if (project.accessTier === "subscription") return "subscription";
  if (project.accessTier === "vip") return "VIP";
  return project.priceCents > 0 || project.accessTier === "paid" ? `${Math.max(1, project.priceCents || 0)} Stars` : "free";
}

function formatProjectLine(project, index) {
  const meta = [
    project.version || "",
    formatProjectPrice(project),
    `${project.downloadCount || 0} downloads`,
    project.averageRating ? `${project.averageRating}/5` : ""
  ].filter(Boolean);

  return [
    `${index + 1}. <b>${escapeHtml(project.title)}</b>`,
    meta.length ? escapeHtml(meta.join(" · ")) : "",
    project.summary ? escapeHtml(trimText(project.summary)) : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function openKeyboard(config) {
  return Markup.inlineKeyboard([
    [Markup.button.webApp("Open WebApp", config.webAppUrl)],
    [
      Markup.button.callback("Latest", "bot:new"),
      Markup.button.callback("Top", "bot:top")
    ],
    [
      Markup.button.callback("Saved", "bot:saved"),
      Markup.button.callback("Profile", "bot:profile")
    ]
  ]);
}

function listKeyboard(config) {
  return Markup.inlineKeyboard([
    [Markup.button.webApp("Open catalog", config.webAppUrl)],
    [
      Markup.button.callback("Latest", "bot:new"),
      Markup.button.callback("Top", "bot:top"),
      Markup.button.callback("Saved", "bot:saved")
    ]
  ]);
}

export function telegramUserFromContext(ctx) {
  return {
    id: ctx.from.id,
    first_name: ctx.from.first_name || "",
    last_name: ctx.from.last_name || "",
    username: ctx.from.username || "",
    photo_url: ""
  };
}

export function ensureBotUser(ctx) {
  return upsertTelegramUser(telegramUserFromContext(ctx));
}

export function getBotProjects(userId, mode, limit = 5) {
  const query =
    mode === "saved"
      ? { userId, favoritesOnly: true, sort: "updated" }
      : { userId, sort: mode === "top" ? "popular" : "new" };
  const projects = listProjects(query);
  enrichProjects(userId, projects);
  return projects.slice(0, limit);
}

export function buildProjectListPayload(mode, user, config) {
  const projects = getBotProjects(user.id, mode);
  const empty =
    mode === "saved"
      ? "There are no saved projects yet. Open the WebApp and save projects you want to revisit."
      : "No projects yet.";
  const body = projects.length
    ? projects.map(formatProjectLine).join("\n\n")
    : empty;

  return {
    text: `<b>${escapeHtml(commandLabels[mode])}</b>\n\n${body}`,
    keyboard: listKeyboard(config)
  };
}

export function buildProfilePayload(user, config) {
  const account = getAccountState(user, config);
  const profile = getUserProfileStats(user.id);
  const globalStats = getStats();
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "User";
  const access = account.isVip
    ? "VIP"
    : account.isSubscriber
      ? "Subscription"
      : "Regular";
  const remaining = account.unlimited ? "unlimited" : `${account.remaining}/${account.downloadLimit}`;
  const publicProfile = user.username
    ? `${String(config.webAppUrl || "").replace(/\/$/, "")}/${user.username}`
    : "";

  return {
    text: [
      `<b>Profile</b>`,
      `Name: ${escapeHtml(name)}`,
      user.username ? `Username: @${escapeHtml(user.username)}` : "",
      `Verification: ${user.is_verified ? "granted" : "none"}`,
      `Telegram ID: <code>${escapeHtml(user.telegram_id)}</code>`,
      `Access: ${escapeHtml(access)}`,
      `Downloads today: ${escapeHtml(remaining)}`,
      `Saved: ${profile.favorites}`,
      `Downloads: ${profile.downloads}`,
      `Reviews: ${profile.reviews}`,
      `Unread notifications: ${profile.unreadNotifications}`,
      isAdminTelegramId(user, config) ? "Role: admin" : "",
      publicProfile ? `Public profile: ${escapeHtml(publicProfile)}` : "",
      "",
      `Catalog: ${globalStats.projects} projects`
    ]
      .filter((line) => line !== "")
      .join("\n"),
    keyboard: openKeyboard(config)
  };
}

export function buildStartPayload(user, config) {
  const name = user.first_name || user.username || "developer";

  return {
    text: [
      `<b>Dev Hub</b>`,
      `Hi, ${escapeHtml(name)}.`,
      "",
      "Browse projects, save favorites, download versions and receive update notifications here.",
      "",
      "<b>Commands</b>",
      "/new - latest projects",
      "/top - popular projects",
      "/saved - saved projects",
      "/profile - profile"
    ].join("\n"),
    keyboard: openKeyboard(config)
  };
}

export function buildBotCommandPayload(command, user, config) {
  if (command === "start") return buildStartPayload(user, config);
  if (command === "profile") return buildProfilePayload(user, config);
  return buildProjectListPayload(command, user, config);
}

function withBotError(handler) {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (error) {
      console.error("Telegram bot command failed:", error);
      await ctx.reply("Could not run the command. Please try again.");
    }
  };
}

async function replyCommand(ctx, command, config) {
  const user = ensureBotUser(ctx);
  const payload = buildBotCommandPayload(command, user, config);
  await ctx.reply(payload.text, {
    parse_mode: "HTML",
    ...payload.keyboard
  });
}

async function answerAction(ctx, command, config) {
  await ctx.answerCbQuery();
  await replyCommand(ctx, command, config);
}

export function registerBotCommands(bot, config) {
  bot.start(withBotError((ctx) => replyCommand(ctx, "start", config)));
  bot.command("app", withBotError((ctx) => replyCommand(ctx, "start", config)));
  bot.command("new", withBotError((ctx) => replyCommand(ctx, "new", config)));
  bot.command("top", withBotError((ctx) => replyCommand(ctx, "top", config)));
  bot.command("saved", withBotError((ctx) => replyCommand(ctx, "saved", config)));
  bot.command("profile", withBotError((ctx) => replyCommand(ctx, "profile", config)));
  bot.command("id", withBotError((ctx) => ctx.reply(`Your Telegram ID: ${ctx.from.id}`)));

  bot.action("bot:new", withBotError((ctx) => answerAction(ctx, "new", config)));
  bot.action("bot:top", withBotError((ctx) => answerAction(ctx, "top", config)));
  bot.action("bot:saved", withBotError((ctx) => answerAction(ctx, "saved", config)));
  bot.action("bot:profile", withBotError((ctx) => answerAction(ctx, "profile", config)));
}

export async function setBotCommandMenu(bot) {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Main menu" },
    { command: "new", description: "Latest projects" },
    { command: "top", description: "Popular projects" },
    { command: "saved", description: "Saved" },
    { command: "profile", description: "User profile" }
  ]);
}

export function notificationKeyboard(config) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: "Open WebApp", web_app: { url: config.webAppUrl } }]]
    }
  };
}
