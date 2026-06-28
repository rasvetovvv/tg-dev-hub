import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BadgeDollarSign,
  Ban,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Code2,
  CreditCard,
  Crown,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Flag,
  FolderKanban,
  Gift,
  History,
  Image as ImageIcon,
  Link2,
  ListFilter,
  Lock,
  Megaphone,
  MessageSquare,
  Monitor,
  Pin,
  Play,
  Plus,
  Rocket,
  Scale,
  Save,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tags,
  Terminal,
  Ticket,
  Trash2,
  Upload,
  User,
  Users,
  Video,
  Wrench,
  X
} from "lucide-react";
import { api, setAuthToken } from "./api.js";

const emptyNotice = { type: "", text: "" };
const collectionPresets = ["Боты", "Парсеры", "Автоматизация", "AI"];
const quickFilters = [
  "Python",
  "Node.js",
  "PHP",
  "Telegram Bot",
  "API",
  "Frontend",
  "Backend"
];
const licenseLabels = {
  free: "Free",
  personal: "Personal",
  commercial: "Commercial"
};
const statusLabels = {
  draft: "Черновик",
  pending: "На проверке",
  published: "Опубликован",
  hidden: "Скрыт",
  archived: "Архив"
};
const tierLabels = {
  free: "Free",
  paid: "Платный",
  subscription: "Подписка",
  vip: "VIP"
};
const reportReasonLabels = {
  malware: "Вредоносный код",
  broken: "Не скачивается",
  outdated: "Устарело",
  abuse: "Нарушение",
  support: "Нет поддержки",
  author: "Жалоба на автора",
  other: "Другое"
};
const reportStatusLabels = {
  new: "Новая",
  reviewing: "Проверяется",
  resolved: "Решена",
  rejected: "Отклонена"
};
const scanStatusLabels = {
  clean: "Проверен",
  warning: "Предупреждение",
  blocked: "Заблокирован",
  pending: "Ожидает проверки"
};

// Decide what the primary action on a project should be for the current viewer.
function accessState(project, account) {
  const tier = project.accessTier || "free";
  const unlocked =
    tier === "free" ||
    project.owned ||
    account.isVip ||
    (tier === "subscription" && account.isSubscriber);

  if (unlocked) return { unlocked: true, action: "download", label: "Скачать", tier };
  if (tier === "paid") {
    return {
      unlocked: false,
      action: "purchase",
      label: `Купить · ${formatPrice(project)}`,
      tier
    };
  }
  if (tier === "subscription") {
    return { unlocked: false, action: "subscribe", label: "Открыть по подписке", tier };
  }
  return { unlocked: false, action: "vip", label: "Получить VIP-доступ", tier };
}

function formatBytes(value) {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value.replace(" ", "T")));
}

function formatPrice(project) {
  if (project.accessTier === "subscription") return "По подписке";
  if (project.accessTier === "vip") return "VIP";
  if (project.isOnSale && project.salePriceCents > 0) return `${project.salePriceCents} Stars · -${project.salePercent}%`;
  return project.priceCents > 0 || project.accessTier === "paid"
    ? `${Math.max(1, Number(project.priceCents) || 0)} Stars`
    : "Бесплатно";
}

function publicUserLink(username) {
  return username ? `${window.location.origin}/${encodeURIComponent(username)}` : "";
}

function publicProjectLink(slug) {
  return slug ? `${window.location.origin}/project/${encodeURIComponent(slug)}` : "";
}

function getTelegram() {
  return window.Telegram?.WebApp;
}

export default function App() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ projects: 0, users: 0, downloads: 0 });
  const [projects, setProjects] = useState([]);
  const [adminProjects, setAdminProjects] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminReviews, setAdminReviews] = useState([]);
  const [adminReports, setAdminReports] = useState([]);
  const [adminDownloads, setAdminDownloads] = useState([]);
  const [adminPromo, setAdminPromo] = useState([]);
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminPurchases, setAdminPurchases] = useState([]);
  const [account, setAccount] = useState({
    isVip: false,
    isSubscriber: false,
    unlimited: false,
    remaining: null,
    downloadLimit: 0,
    downloadsToday: 0,
    vipUntil: null,
    subscriptionUntil: null,
    subscriptionPriceLabel: "",
    vipPriceLabel: "",
    testCheckout: false
  });
  const [limits, setLimits] = useState({ maxUploadMb: 100 });
  const [downloads, setDownloads] = useState([]);
  const [userPurchases, setUserPurchases] = useState([]);
  const [userProjects, setUserProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    languages: [],
    tags: [],
    collections: [],
    categories: []
  });
  const [activeTab, setActiveTab] = useState("catalog");
  const [adminMode, setAdminMode] = useState("projects");
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [topic, setTopic] = useState("");
  const [collection, setCollection] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [license, setLicense] = useState("");
  const [date, setDate] = useState("");
  const [sort, setSort] = useState("new");
  const [selected, setSelected] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState(emptyNotice);
  const [detailNotice, setDetailNotice] = useState(emptyNotice);

  useEffect(() => {
    const tg = getTelegram();
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#0b0d12");
    tg?.setBackgroundColor?.("#0b0d12");

    async function authenticate() {
      try {
        const initData = tg?.initData;
        const payload = initData
          ? await api("/api/auth/telegram", {
              method: "POST",
              body: { initData }
            })
          : await api("/api/auth/dev", { method: "POST" });

        setAuthToken(payload.token);
        setToken(payload.token);
        setUser(payload.user);
      } catch (error) {
        setAuthError(error.message);
      }
    }

    authenticate();
  }, []);

  useEffect(() => {
    if (!token) return;
    loadMe();
    loadFilterOptions();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    if (["catalog", "saved", "top", "vip"].includes(activeTab)) {
      loadProjects();
    } else if (activeTab === "admin") {
      loadAdminData();
    } else if (activeTab === "history") {
      loadDownloads();
    } else if (activeTab === "account") {
      loadAccountData();
    } else if (activeTab === "notifications") {
      loadNotifications();
    }
  }, [token, activeTab, search, language, topic, collection, category, price, license, date, sort]);

  const unreadCount = notifications.filter((item) => !item.isRead).length;

  const visibleTabs = useMemo(() => {
    const tabs = [
      { id: "catalog", label: "Каталог" },
      { id: "top", label: "Топ" },
      { id: "vip", label: "VIP" },
      { id: "saved", label: "Избранное" },
      { id: "account", label: "Аккаунт" },
      { id: "history", label: "История" },
      {
        id: "notifications",
        label: unreadCount ? `Уведомления ${unreadCount}` : "Уведомления"
      }
    ];
    if (user?.isAdmin) tabs.push({ id: "admin", label: "Админ" });
    return tabs;
  }, [user, unreadCount]);

  const tabsRef = useRef(null);
  const [tabIndicator, setTabIndicator] = useState({ x: 0, sx: 0, h: 40 });
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    const active = nav?.querySelector("button.active");
    if (!active) return;
    const measure = () =>
      setTabIndicator({
        x: active.offsetLeft,
        sx: active.offsetWidth / 100,
        h: active.offsetHeight
      });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeTab, visibleTabs]);

  async function loadMe() {
    const payload = await api("/api/me");
    setStats(payload.stats);
    if (payload.account) setAccount(payload.account);
    if (payload.limits) setLimits(payload.limits);
  }

  async function loadFilterOptions() {
    const payload = await api("/api/languages");
    setFilterOptions({
      languages: payload.languages || [],
      tags: payload.tags || [],
      collections: payload.collections || [],
      categories: payload.categories || []
    });
  }

  async function loadProjects() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (language) params.set("language", language);
      if (topic) params.set("topic", topic);
      if (collection) params.set("collection", collection);
      if (category) params.set("category", category);
      if (price) params.set("price", price);
      if (license) params.set("license", license);
      if (date) params.set("date", date);
      params.set("sort", activeTab === "top" ? "popular" : sort || "new");
      if (activeTab === "saved") params.set("favorites", "true");
      if (activeTab === "vip") params.set("tier", "vip");
      const payload = await api(`/api/projects?${params.toString()}`);
      setProjects(payload.projects);
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminData() {
    setLoading(true);
    try {
      const [
        projectPayload,
        userPayload,
        reviewPayload,
        reportPayload,
        downloadPayload,
        promoPayload,
        requestPayload,
        purchasePayload
      ] =
        await Promise.all([
          api("/api/admin/projects"),
          api("/api/admin/users"),
          api("/api/admin/reviews"),
          api("/api/admin/reports"),
          api("/api/admin/downloads"),
          api("/api/admin/promo"),
          api("/api/admin/requests"),
          api("/api/admin/purchases")
        ]);
      setAdminProjects(projectPayload.projects || []);
      setAdminUsers(userPayload.users || []);
      setAdminReviews(reviewPayload.reviews || []);
      setAdminReports(reportPayload.reports || []);
      setAdminDownloads(downloadPayload.downloads || []);
      setAdminPromo(promoPayload.codes || []);
      setAdminRequests(requestPayload.requests || []);
      setAdminPurchases(purchasePayload.purchases || []);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAdminData() {
    await Promise.all([loadAdminData(), loadFilterOptions(), loadMe()]);
  }

  async function loadAccountData() {
    await Promise.all([loadMe(), loadUserPurchases(), loadUserProjects()]);
  }

  async function refreshAccountData() {
    await Promise.all([loadAccountData(), loadFilterOptions()]);
  }

  async function loadUserPurchases() {
    const payload = await api("/api/purchases");
    setUserPurchases(payload.purchases || []);
  }

  async function loadUserProjects() {
    const payload = await api("/api/my/projects");
    setUserProjects(payload.projects || []);
  }

  async function loadDownloads() {
    setLoading(true);
    try {
      const payload = await api("/api/downloads");
      setDownloads(payload.downloads);
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    setLoading(true);
    try {
      const payload = await api("/api/notifications");
      setNotifications(payload.notifications);
    } finally {
      setLoading(false);
    }
  }

  async function openProject(project) {
    setDetailNotice(emptyNotice);
    const payload = await api(`/api/projects/${project.slug}`);
    setSelected(payload.project);
  }

  async function openUserProfile(username) {
    if (!username) return;
    setDetailNotice(emptyNotice);
    const payload = await api(`/api/users/${username}`);
    setSelectedProfile(payload.profile);
  }

  async function toggleFavorite(project) {
    const nextFavorite = !project.isFavorite;
    await api(`/api/projects/${project.id}/favorite`, {
      method: nextFavorite ? "POST" : "DELETE"
    });

    setProjects((items) =>
      items
        .map((item) =>
          item.id === project.id ? { ...item, isFavorite: nextFavorite } : item
        )
        .filter((item) => activeTab !== "saved" || item.isFavorite)
    );
    setSelected((item) =>
      item?.id === project.id ? { ...item, isFavorite: nextFavorite } : item
    );
  }

  function downloadProject(project, versionId = null, fileId = null) {
    const params = new URLSearchParams({ token });
    const path = fileId
      ? `/api/projects/${project.id}/files/${fileId}/download`
      : `/api/projects/${project.id}/download`;
    if (versionId && !fileId) params.set("versionId", versionId);
    const url = `${window.location.origin}${path}?${params.toString()}`;
    const tg = getTelegram();
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    setProjects((items) =>
      items.map((item) =>
        item.id === project.id
          ? { ...item, downloadCount: item.downloadCount + 1 }
          : item
      )
    );
    setSelected((item) =>
      item?.id === project.id
        ? { ...item, downloadCount: item.downloadCount + 1 }
        : item
    );
  }

  function downloadAutoArchive(project) {
    const params = new URLSearchParams({ token });
    const url = `${window.location.origin}/api/projects/${project.id}/archive/download?${params.toString()}`;
    const tg = getTelegram();
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function openStarsInvoice(invoiceUrl) {
    const tg = getTelegram();
    if (tg?.openInvoice) {
      tg.openInvoice(invoiceUrl, async (status) => {
        if (status === "paid") {
          await loadMe();
          await loadProjects();
          setNotice({ type: "success", text: "Оплата Stars прошла успешно. Доступ обновлен." });
        }
      });
      return;
    }
    window.open(invoiceUrl, "_blank", "noopener,noreferrer");
  }

  async function archiveProject(projectId) {
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    setNotice({ type: "success", text: "Проект отправлен в архив." });
    await refreshAdminData();
  }

  async function createProject(event) {
    event.preventDefault();
    setNotice(emptyNotice);
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const payload = await api("/api/projects", {
        method: "POST",
        body: formData
      });
      form.reset();
      setNotice({ type: "success", text: `Сохранено: ${payload.project.title}` });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function publishVersion(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const payload = await api(`/api/projects/${project.id}/version`, {
        method: "POST",
        body: formData
      });
      form.reset();
      setNotice({ type: "success", text: `Версия обновлена: ${payload.project.title}` });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function saveProjectEdit(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const payload = await api(`/api/projects/${project.id}`, {
        method: "PUT",
        body: formData
      });
      setNotice({ type: "success", text: `Изменения сохранены: ${payload.project.title}` });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function changeProjectStatus(project, status) {
    try {
      await api(`/api/projects/${project.id}/status`, {
        method: "POST",
        body: { status }
      });
      setNotice({ type: "success", text: `Статус обновлен: ${statusLabels[status] || status}` });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function toggleProjectPin(project) {
    try {
      await api(`/api/projects/${project.id}/pin`, {
        method: "POST",
        body: { pinned: !project.pinnedAt }
      });
      setNotice({
        type: "success",
        text: project.pinnedAt ? "Проект откреплен." : "Проект закреплен наверху каталога."
      });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function uploadProjectFiles(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      await api(`/api/projects/${project.id}/files`, {
        method: "POST",
        body: formData
      });
      form.reset();
      setNotice({ type: "success", text: "Файлы добавлены к проекту." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function uploadProjectScreenshots(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      await api(`/api/projects/${project.id}/screenshots`, {
        method: "POST",
        body: formData
      });
      form.reset();
      setNotice({ type: "success", text: "Скриншоты обновлены." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deleteScreenshot(project, screenshot) {
    try {
      await api(`/api/projects/${project.id}/screenshots/${screenshot.id}`, {
        method: "DELETE"
      });
      setNotice({ type: "success", text: "Скриншот удален." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function saveOwnerProjectEdit(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const payload = await api(`/api/projects/${project.id}`, {
        method: "PUT",
        body: new FormData(form)
      });
      setNotice({
        type: "success",
        text: payload.project.status === "pending"
          ? "Правки отправлены на проверку."
          : "Проект обновлен."
      });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function publishOwnerVersion(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const payload = await api(`/api/projects/${project.id}/version`, {
        method: "POST",
        body: new FormData(form)
      });
      form.reset();
      setNotice({
        type: "success",
        text: payload.project.status === "pending"
          ? "Версия загружена и ждет проверки."
          : "Версия опубликована."
      });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function uploadOwnerScreenshots(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/projects/${project.id}/screenshots`, {
        method: "POST",
        body: new FormData(form)
      });
      form.reset();
      setNotice({ type: "success", text: "Скриншоты обновлены." });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deleteOwnerScreenshot(project, screenshot) {
    try {
      await api(`/api/projects/${project.id}/screenshots/${screenshot.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Скриншот удален." });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function toggleUserBadge(userItem, badge) {
    const body = {};
    body[badge] = !userItem[badge === "topSeller" ? "isTopSeller" : badge === "trusted" ? "isTrusted" : "isVerified"];
    try {
      await api(`/api/admin/users/${userItem.id}/badges`, { method: "POST", body });
      setNotice({ type: "success", text: "Бейдж обновлен." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function toggleWeeklyPick(project) {
    try {
      await api(`/api/admin/projects/${project.id}/weekly`, {
        method: "POST",
        body: { picked: !project.isWeeklyPick }
      });
      setNotice({ type: "success", text: project.isWeeklyPick ? "Убрано из подборки недели." : "Добавлено в подборку недели." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function saveSeasonalSale(project, event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/admin/projects/${project.id}/sale`, { method: "POST", body });
      setNotice({ type: "success", text: "Сезонная скидка обновлена." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function sendAuthorMessage(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/admin/projects/${project.id}/message`, { method: "POST", body });
      form.reset();
      setNotice({ type: "success", text: "Сообщение автору отправлено." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function reviewUpload(project, item, kind, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    for (const key of ["opens", "readme", "license", "noSecrets", "dependencies"]) {
      body[key] = body[key] === "on";
    }
    const path = kind === "version"
      ? `/api/admin/projects/${project.id}/versions/${item.id}/review`
      : `/api/admin/projects/${project.id}/files/${item.id}/review`;
    try {
      await api(path, { method: "POST", body });
      setNotice({ type: "success", text: "Ревью файла сохранено." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function toggleUploadHidden(project, item, kind) {
    const path = kind === "version"
      ? `/api/admin/projects/${project.id}/versions/${item.id}/hidden`
      : `/api/admin/projects/${project.id}/files/${item.id}/hidden`;
    try {
      await api(path, { method: "POST", body: { hidden: !item.isHidden } });
      setNotice({ type: "success", text: item.isHidden ? "Файл показан." : "Файл скрыт." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deleteUpload(project, item, kind) {
    const path = kind === "version"
      ? `/api/admin/projects/${project.id}/versions/${item.id}`
      : `/api/admin/projects/${project.id}/files/${item.id}`;
    try {
      await api(path, { method: "DELETE" });
      setNotice({ type: "success", text: "Файл удален." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function banUser(userItem, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.nativeEvent.submitter;
    const banned = submitter?.value === "1";
    const reason = String(new FormData(form).get("reason") || "").trim();

    try {
      await api(`/api/admin/users/${userItem.id}/ban`, {
        method: "POST",
        body: { banned, reason }
      });
      setNotice({ type: "success", text: banned ? "Пользователь забанен." : "Пользователь разбанен." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function verifyUser(userItem) {
    try {
      await api(`/api/admin/users/${userItem.id}/verify`, {
        method: "POST",
        body: { verified: !userItem.isVerified }
      });
      setNotice({
        type: "success",
        text: userItem.isVerified ? "Верификация снята." : "Пользователь верифицирован."
      });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function moderateReview(review, status) {
    try {
      await api(`/api/admin/reviews/${review.id}/status`, {
        method: "POST",
        body: { status }
      });
      setNotice({ type: "success", text: status === "hidden" ? "Отзыв скрыт." : "Отзыв опубликован." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function removeReview(review) {
    try {
      await api(`/api/admin/reviews/${review.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Отзыв удален." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function updateReportStatus(report, status) {
    try {
      await api(`/api/admin/reports/${report.id}/status`, {
        method: "POST",
        body: { status, subjectType: report.subjectType || "project" }
      });
      setNotice({ type: "success", text: "Статус жалобы обновлен." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    try {
      const payload = await api("/api/admin/broadcast", {
        method: "POST",
        body
      });
      form.reset();
      setNotice({
        type: "success",
        text: `Рассылка создана: ${payload.notifications} уведомлений, Telegram: ${payload.telegramSent} отправлено.`
      });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function submitReview(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    try {
      const payload = await api(`/api/projects/${project.id}/reviews`, {
        method: "POST",
        body
      });
      form.reset();
      setSelected(payload.project);
      setDetailNotice({ type: "success", text: "Отзыв сохранен." });
      await loadProjects();
      await loadMe();
    } catch (error) {
      setDetailNotice({ type: "error", text: error.message });
    }
  }

  async function submitReport(project, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    try {
      await api(`/api/projects/${project.id}/reports`, {
        method: "POST",
        body
      });
      form.reset();
      setDetailNotice({ type: "success", text: "Жалоба отправлена." });
      await loadMe();
    } catch (error) {
      setDetailNotice({ type: "error", text: error.message });
    }
  }

  async function submitAuthorReport(profile, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/users/${profile.username}/reports`, {
        method: "POST",
        body
      });
      form.reset();
      setNotice({ type: "success", text: "Жалоба на автора отправлена." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function markNotification(notification) {
    await api(`/api/notifications/${notification.id}/read`, { method: "POST" });
    setNotifications((items) =>
      items.map((item) =>
        item.id === notification.id ? { ...item, isRead: true } : item
      )
    );
  }

  function markOwned(projectId) {
    setProjects((items) =>
      items.map((item) => (item.id === projectId ? { ...item, owned: true } : item))
    );
    setSelected((item) => (item?.id === projectId ? { ...item, owned: true } : item));
  }

  // Single entry point for a project's primary button: download or unlock.
  function handlePrimary(project, versionId = null, fileId = null) {
    const state = accessState(project, account);

    if (state.action === "download") {
      const isFree = (project.accessTier || "free") === "free";
      if (
        isFree &&
        !project.owned &&
        !account.unlimited &&
        account.remaining !== null &&
        account.remaining <= 0
      ) {
        setNotice({
          type: "error",
          text: `Лимит ${account.downloadLimit} скачиваний на сегодня исчерпан. Оформите подписку или VIP для безлимита.`
        });
        setActiveTab("account");
        return;
      }
      downloadProject(project, versionId, fileId);
      if (isFree && !account.unlimited && account.remaining !== null) {
        setAccount((current) => ({
          ...current,
          remaining: Math.max(0, (current.remaining ?? 0) - 1),
          downloadsToday: current.downloadsToday + 1
        }));
      }
      return;
    }
    if (state.action === "purchase") return purchaseAccess(project);
    if (state.action === "subscribe") return subscribeNow();
    if (state.action === "vip") return buyVipNow();
  }

  async function purchaseAccess(project) {
    try {
      const result = await api(`/api/projects/${project.id}/purchase`, { method: "POST" });
      if (result.status === "paid" || result.status === "owned") {
        markOwned(project.id);
        setDetailNotice({ type: "success", text: "Доступ открыт — теперь можно скачать." });
        setNotice({ type: "success", text: `Куплено: ${project.title}` });
      } else if (result.status === "invoice" && result.invoiceUrl) {
        openStarsInvoice(result.invoiceUrl);
        setDetailNotice({ type: "success", text: "Открыл оплату через Telegram Stars." });
      } else if (result.status === "pending") {
        const text = "Заявка на покупку создана. Мы свяжемся для оплаты.";
        setDetailNotice({ type: "success", text });
        setNotice({ type: "success", text });
      } else if (result.status === "free") {
        downloadProject(project);
      }
      await loadMe();
      await loadUserPurchases();
    } catch (error) {
      setDetailNotice({ type: "error", text: error.message });
      setNotice({ type: "error", text: error.message });
    }
  }

  async function subscribeNow() {
    try {
      const result = await api("/api/subscription", { method: "POST" });
      if (result.account) setAccount(result.account);
      if (result.status === "invoice" && result.invoiceUrl) {
        openStarsInvoice(result.invoiceUrl);
      }
      else await loadMe();
      setNotice({
        type: "success",
        text: result.status === "active" ? "Подписка активирована." : "Открыл оплату подписки через Stars."
      });
      if (["catalog", "saved", "top", "vip"].includes(activeTab)) await loadProjects();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function buyVipNow() {
    try {
      const result = await api("/api/vip", { method: "POST" });
      if (result.account) setAccount(result.account);
      if (result.status === "invoice" && result.invoiceUrl) {
        openStarsInvoice(result.invoiceUrl);
      }
      else await loadMe();
      setNotice({
        type: "success",
        text: result.status === "active" ? "VIP-доступ активирован." : "Открыл оплату VIP через Stars."
      });
      if (["catalog", "saved", "top", "vip"].includes(activeTab)) await loadProjects();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function redeemPromo(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") || "").trim();
    try {
      const result = await api("/api/promo/redeem", { method: "POST", body: { code } });
      if (result.account) setAccount(result.account);
      form.reset();
      setNotice({ type: "success", text: "Промокод активирован." });
      await loadMe();
      if (["catalog", "saved", "top", "vip"].includes(activeTab)) await loadProjects();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function submitRequest(event, projectId = null) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (projectId) body.projectId = projectId;
    body.type = body.type || "custom";
    try {
      await api("/api/requests", { method: "POST", body });
      form.reset();
      const text = "Заявка отправлена. Мы свяжемся с вами.";
      setNotice({ type: "success", text });
      setDetailNotice({ type: "success", text });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      setDetailNotice({ type: "error", text: error.message });
    }
  }

  async function submitProjectApplication(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const payload = await api("/api/submissions/projects", {
        method: "POST",
        body: formData
      });
      form.reset();
      setNotice({
        type: "success",
        text: payload.autoApproved
          ? `Проект опубликован: ${payload.project.title}.`
          : `Заявка отправлена: ${payload.project.title}. Админ проверит и опубликует проект.`
      });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function createPromo(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      await api("/api/admin/promo", { method: "POST", body });
      form.reset();
      setNotice({ type: "success", text: "Промокод создан." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deactivatePromo(code) {
    try {
      await api(`/api/admin/promo/${code.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Промокод отключен." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function updateRequestStatus(request, status) {
    try {
      await api(`/api/admin/requests/${request.id}/status`, { method: "POST", body: { status } });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function confirmPurchase(purchase) {
    try {
      await api(`/api/admin/purchases/${purchase.id}/confirm`, { method: "POST" });
      setNotice({ type: "success", text: "Покупка подтверждена." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function grantAccess(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      await api("/api/admin/grant", { method: "POST", body });
      form.reset();
      setNotice({ type: "success", text: "Доступ выдан пользователю." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  function resetFilters() {
    setSearch("");
    setLanguage("");
    setTopic("");
    setCollection("");
    setCategory("");
    setPrice("");
    setLicense("");
    setDate("");
    setSort("new");
  }

  if (authError) {
    return (
      <main className="authScreen">
        <div className="authPanel">
          <Code2 size={34} />
          <h1>Dev Hub</h1>
          <p>
            WebApp должен открываться из Telegram-бота. Для локального режима
            проверь `ALLOW_DEV_AUTH=true`.
          </p>
          <span>{authError}</span>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="authScreen">
        <div className="loader" />
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">
            <Code2 size={22} />
          </span>
          <div>
            <strong>Dev Hub</strong>
            <small>~/проекты · скрипты · исходники</small>
          </div>
        </div>

        <div className="profile">
          {user.isAdmin && (
            <span className="adminBadge">
              <ShieldCheck size={14} />
              owner
            </span>
          )}
          <span className="avatar">
            {user.photoUrl ? <img src={user.photoUrl} alt="" /> : <User size={17} />}
          </span>
          <span className="profileName">
            {user.firstName || user.username || "Аккаунт"}
          </span>
        </div>
      </header>

      <section className="statsStrip" aria-label="Статистика">
        <Stat label="проектов" value={stats.projects} />
        <Stat label="людей" value={stats.users} />
        <Stat label="скачиваний" value={stats.downloads} />
      </section>

      {["catalog", "top", "vip", "saved"].includes(activeTab) && (
        <FilterPanel
          search={search}
          language={language}
          topic={topic}
          collection={collection}
          category={category}
          price={price}
          license={license}
          date={date}
          sort={sort}
          filterOptions={filterOptions}
          onSearch={setSearch}
          onLanguage={setLanguage}
          onTopic={setTopic}
          onCollection={setCollection}
          onCategory={setCategory}
          onPrice={setPrice}
          onLicense={setLicense}
          onDate={setDate}
          onSort={setSort}
          onReset={resetFilters}
        />
      )}

      <nav className="tabs" aria-label="Разделы" ref={tabsRef}>
        <span
          className="tabIndicator"
          aria-hidden="true"
          style={{
            "--x": `${tabIndicator.x}px`,
            "--sx": tabIndicator.sx,
            "--h": `${tabIndicator.h}px`
          }}
        />
        {visibleTabs.map((tab) => (
          <button
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "admin" && user.isAdmin ? (
        <AdminPanel
          notice={notice}
          loading={loading}
          mode={adminMode}
          onMode={setAdminMode}
          projects={adminProjects}
          users={adminUsers}
          reviews={adminReviews}
          reports={adminReports}
          downloads={adminDownloads}
          limits={limits}
          promo={adminPromo}
          requests={adminRequests}
          purchases={adminPurchases}
          onCreate={createProject}
          onEdit={saveProjectEdit}
          onStatus={changeProjectStatus}
          onPin={toggleProjectPin}
          onWeekly={toggleWeeklyPick}
          onSale={saveSeasonalSale}
          onArchive={archiveProject}
          onVersion={publishVersion}
          onFiles={uploadProjectFiles}
          onScreenshots={uploadProjectScreenshots}
          onDeleteScreenshot={deleteScreenshot}
          onSendAuthorMessage={sendAuthorMessage}
          onReviewUpload={reviewUpload}
          onToggleUploadHidden={toggleUploadHidden}
          onDeleteUpload={deleteUpload}
          onBanUser={banUser}
          onVerifyUser={verifyUser}
          onToggleUserBadge={toggleUserBadge}
          onModerateReview={moderateReview}
          onDeleteReview={removeReview}
          onReportStatus={updateReportStatus}
          onBroadcast={sendBroadcast}
          onCreatePromo={createPromo}
          onDeactivatePromo={deactivatePromo}
          onRequestStatus={updateRequestStatus}
          onConfirmPurchase={confirmPurchase}
          onGrant={grantAccess}
        />
      ) : activeTab === "history" ? (
        <HistoryList
          loading={loading}
          downloads={downloads}
          onSelect={openProject}
          onDownload={handlePrimary}
        />
      ) : activeTab === "notifications" ? (
        <NotificationsList
          loading={loading}
          notifications={notifications}
          projects={projects}
          onRead={markNotification}
          onOpen={openProject}
        />
      ) : activeTab === "account" ? (
        <AccountPanel
          user={user}
          account={account}
          purchases={userPurchases}
          projects={userProjects}
          notice={notice}
          onSubscribe={subscribeNow}
          onVip={buyVipNow}
          onRedeem={redeemPromo}
          onRequest={submitRequest}
          onProjectSubmit={submitProjectApplication}
          onOpenProject={openProject}
          onProjectEdit={saveOwnerProjectEdit}
          onProjectVersion={publishOwnerVersion}
          onProjectScreenshots={uploadOwnerScreenshots}
          onDeleteScreenshot={deleteOwnerScreenshot}
        />
      ) : (
        <Catalog
          loading={loading}
          projects={projects}
          activeTab={activeTab}
          account={account}
          onSelect={openProject}
          onFavorite={toggleFavorite}
          onPrimary={handlePrimary}
          onVip={buyVipNow}
        />
      )}

      {selected && (
        <ProjectDrawer
          project={selected}
          notice={detailNotice}
          account={account}
          onClose={() => setSelected(null)}
          onFavorite={toggleFavorite}
          onPrimary={handlePrimary}
          onReview={submitReview}
          onReport={submitReport}
          onRequest={submitRequest}
          onUserProfile={openUserProfile}
          onAutoArchive={downloadAutoArchive}
        />
      )}
      {selectedProfile && (
        <UserProfileDrawer
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onOpenProject={openProject}
          onReportAuthor={submitAuthorReport}
        />
      )}
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function FilterPanel({
  search,
  language,
  topic,
  collection,
  category,
  price,
  license,
  date,
  sort,
  filterOptions,
  onSearch,
  onLanguage,
  onTopic,
  onCollection,
  onCategory,
  onPrice,
  onLicense,
  onDate,
  onSort,
  onReset
}) {
  const [open, setOpen] = useState(false);
  const collections = [
    ...new Set([...collectionPresets, ...(filterOptions.collections || [])])
  ];
  const activeCount =
    [language, category, price, license, date, collection, topic].filter(Boolean).length +
    (sort && sort !== "new" ? 1 : 0);

  return (
    <section className="filterPanel">
      <div className="filterBar">
        <div className="searchBox">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Поиск проектов, языков, тегов"
          />
        </div>
        <button
          type="button"
          className={`filterToggle ${open || activeCount ? "active" : ""}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ListFilter size={16} />
          Фильтры
          {activeCount > 0 && <span className="filterCount">{activeCount}</span>}
        </button>
      </div>

      {open && (
        <div className="filterBody">
          <div className="controls">
            <select value={language} onChange={(event) => onLanguage(event.target.value)}>
          <option value="">Все языки</option>
          {filterOptions.languages.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select value={category} onChange={(event) => onCategory(event.target.value)}>
          <option value="">Все категории</option>
          {filterOptions.categories.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select value={price} onChange={(event) => onPrice(event.target.value)}>
          <option value="">Любая цена</option>
          <option value="free">Бесплатные</option>
          <option value="paid">Платные</option>
        </select>

        <select value={license} onChange={(event) => onLicense(event.target.value)}>
          <option value="">Любая лицензия</option>
          <option value="free">Free</option>
          <option value="personal">Personal</option>
          <option value="commercial">Commercial</option>
        </select>

        <select value={date} onChange={(event) => onDate(event.target.value)}>
          <option value="">Любая дата</option>
          <option value="today">Сегодня</option>
          <option value="week">7 дней</option>
          <option value="month">30 дней</option>
          <option value="year">Год</option>
        </select>

        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          <option value="new">Новые</option>
          <option value="updated">Обновленные</option>
          <option value="popular">Популярные</option>
          <option value="rating">По рейтингу</option>
          <option value="price">По цене</option>
        </select>
      </div>

      <div className="quickFilters">
        <span>
          <FolderKanban size={15} />
          Коллекции
        </span>
        {collections.map((item) => (
          <button
            type="button"
            className={collection === item ? "active" : ""}
            onClick={() => onCollection(collection === item ? "" : item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="quickFilters">
        <span>
          <ListFilter size={15} />
          Фильтры
        </span>
        {quickFilters.map((item) => (
          <button
            type="button"
            className={topic === item ? "active" : ""}
            onClick={() => onTopic(topic === item ? "" : item)}
            key={item}
          >
            {item}
          </button>
        ))}
        <button type="button" className="ghostFilter" onClick={onReset}>
          Сбросить
        </button>
      </div>
        </div>
      )}
    </section>
  );
}

function Catalog({ loading, projects, activeTab, account, onSelect, onFavorite, onPrimary, onVip }) {
  if (loading) {
    return (
      <section className="grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton" key={index} />
        ))}
      </section>
    );
  }

  if (projects.length === 0) {
    return (
      <>
        {activeTab === "vip" && <VipBanner account={account} onVip={onVip} />}
        <section className="emptyState">
          <Star size={26} />
          <h2>
            {activeTab === "saved"
              ? "Сохраненных пока нет"
              : activeTab === "top"
                ? "Топ пока пуст"
                : activeTab === "vip"
                  ? "VIP-проектов пока нет"
                  : "Каталог пуст"}
          </h2>
          <p>
            {activeTab === "saved"
              ? "Сохраняй полезные проекты, чтобы быстро возвращаться к ним."
              : activeTab === "top"
                ? "Популярные проекты появятся после просмотров и скачиваний."
                : activeTab === "vip"
                  ? "Эксклюзивные проекты появятся здесь. Оформи VIP заранее."
                  : "Первую публикацию можно добавить во вкладке администратора."}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      {activeTab === "vip" && <VipBanner account={account} onVip={onVip} />}
      <section className="grid">
        {projects.map((project, index) => (
          <ProjectCard
            project={project}
            account={account}
            index={index}
            onSelect={onSelect}
            onFavorite={onFavorite}
            onPrimary={onPrimary}
            key={project.id}
          />
        ))}
      </section>
    </>
  );
}

function VipBanner({ account, onVip }) {
  return (
    <section className="vipBanner">
      <div>
        <strong>
          <Crown size={18} />
          {account.isVip ? "VIP активен" : "Платный VIP-раздел"}
        </strong>
        <p>
          {account.isVip
            ? account.vipUntil
              ? `Доступ открыт до ${formatDate(account.vipUntil)}.`
              : "Безлимитный доступ ко всем проектам каталога."
            : "Эксклюзивные проекты и безлимитные скачивания. Доступ ко всему каталогу."}
        </p>
      </div>
      {!account.isVip && (
        <button type="button" className="primary" onClick={onVip}>
          <Crown size={16} />
          {account.vipPriceLabel ? `VIP · ${account.vipPriceLabel}` : "Оформить VIP"}
        </button>
      )}
    </section>
  );
}

function AccessBadge({ tier, owned }) {
  if (!tier || tier === "free") return null;
  return (
    <span className={`accessBadge tier-${tier} ${owned ? "owned" : ""}`}>
      {tier === "vip" ? <Crown size={12} /> : owned ? <BadgeDollarSign size={12} /> : <Lock size={12} />}
      {owned ? "Куплено" : tierLabels[tier] || tier}
    </span>
  );
}

function ProjectCard({ project, account, index = 0, onSelect, onFavorite, onPrimary }) {
  const cover = project.screenshots[0]?.url;
  const state = accessState(project, account);
  const [burst, setBurst] = useState(false);
  const wasFavorite = useRef(project.isFavorite);
  useEffect(() => {
    if (project.isFavorite && !wasFavorite.current) {
      setBurst(true);
      const timer = setTimeout(() => setBurst(false), 520);
      wasFavorite.current = project.isFavorite;
      return () => clearTimeout(timer);
    }
    wasFavorite.current = project.isFavorite;
  }, [project.isFavorite]);

  return (
    <article
      className={`projectCard ${project.pinnedAt ? "pinnedCard" : ""}`}
      style={{ "--i": index }}
    >
      {project.pinnedAt && (
        <span className="pinBadge">
          <Pin size={13} />
          pinned
        </span>
      )}
      {project.isWeeklyPick && (
        <span className="pinBadge weeklyBadge">
          <Star size={13} />
          weekly
        </span>
      )}
      {project.isOnSale && (
        <span className="saleBadge">
          -{project.salePercent}% Stars
        </span>
      )}
      <button
        type="button"
        className={`favoriteButton ${project.isFavorite ? "saved" : ""} ${burst ? "burst" : ""}`}
        onClick={() => onFavorite(project)}
        aria-label={project.isFavorite ? "Убрать из избранного" : "Сохранить"}
      >
        <Star size={17} fill="currentColor" />
      </button>

      <button type="button" className="cover" onClick={() => onSelect(project)}>
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <div className="codePreview">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
      </button>

      <div className="cardBody">
        <div className="cardTitleRow">
          <h2>{project.title}</h2>
          {project.version && <span className="version">{project.version}</span>}
        </div>

        <div className="cardMetrics">
          <AccessBadge tier={project.accessTier} owned={project.owned} />
          <span>
            <Star size={14} fill="currentColor" />
            {project.averageRating || "0.0"} ({project.reviewCount})
          </span>
          <span>
            <BadgeDollarSign size={14} />
            {formatPrice(project)}
          </span>
          <span>
            <Download size={14} />
            {project.downloadCount || 0}
          </span>
        </div>

        <p>{project.summary || project.description || "Описание появится позже."}</p>

        <div className="chipRow">
          {[
            ...project.categories.map((value) => ({ value, kind: "cat" })),
            ...project.collections.map((value) => ({ value, kind: "col" })),
            ...project.languages.map((value) => ({ value, kind: "lang" })),
            ...project.tags.map((value) => ({ value, kind: "tag" }))
          ]
            .slice(0, 6)
            .map(({ value, kind }) => (
              <span className={`chip chip-${kind}`} key={`${kind}-${value}`}>
                {value}
              </span>
            ))}
        </div>

        <div className="cardActions">
          <button type="button" onClick={() => onSelect(project)}>
            <ExternalLink size={16} />
            Детали
          </button>
          <button type="button" className="primary" onClick={() => onPrimary(project)}>
            {state.action === "download" ? (
              <Download size={16} />
            ) : state.action === "purchase" ? (
              <CreditCard size={16} />
            ) : state.action === "vip" ? (
              <Crown size={16} />
            ) : (
              <Rocket size={16} />
            )}
            {state.label}
          </button>
        </div>
      </div>
    </article>
  );
}

function HistoryList({ loading, downloads, onSelect, onDownload }) {
  if (loading) {
    return <div className="skeleton listSkeleton" />;
  }

  if (downloads.length === 0) {
    return (
      <section className="emptyState">
        <History size={26} />
        <h2>История пустая</h2>
        <p>После скачивания проекты появятся здесь.</p>
      </section>
    );
  }

  return (
    <section className="listPanel">
      {downloads.map((item, index) => (
        <div className="activityRow" key={item.id} style={{ "--i": index }}>
          <div>
            <strong>{item.project.title}</strong>
            <span>
              {formatDate(item.createdAt)} · {item.version || "latest"} · {formatPrice(item.project)}
            </span>
          </div>
          <div className="rowActions">
            <button type="button" onClick={() => onSelect(item.project)}>
              <ExternalLink size={16} />
              Детали
            </button>
            <button type="button" className="primary" onClick={() => onDownload(item.project, item.versionId, item.fileId)}>
              <Download size={16} />
              Скачать
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function NotificationsList({ loading, notifications, projects, onRead, onOpen }) {
  if (loading) {
    return <div className="skeleton listSkeleton" />;
  }

  if (notifications.length === 0) {
    return (
      <section className="emptyState">
        <Bell size={26} />
        <h2>Уведомлений нет</h2>
        <p>Новые версии сохраненных проектов появятся здесь.</p>
      </section>
    );
  }

  return (
    <section className="listPanel">
      {notifications.map((item, index) => {
        const project =
          projects.find((candidate) => candidate.id === item.projectId) ||
          (item.projectSlug
            ? { id: item.projectId, slug: item.projectSlug, title: item.projectTitle }
            : null);
        return (
          <div
            className={`activityRow ${item.isRead ? "" : "unread"}`}
            key={item.id}
            style={{ "--i": index }}
          >
            <div>
              <strong>{item.title}</strong>
              <span>{item.body || item.projectTitle}</span>
              <small>{formatDate(item.createdAt)}</small>
            </div>
            <div className="rowActions">
              {!item.isRead && (
                <button type="button" onClick={() => onRead(item)}>
                  <Bell size={16} />
                  Прочитано
                </button>
              )}
              {project && (
                <button type="button" className="primary" onClick={() => onOpen(project)}>
                  <ExternalLink size={16} />
                  Открыть
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ProjectDrawer({
  project,
  notice,
  account,
  onClose,
  onFavorite,
  onPrimary,
  onReview,
  onReport,
  onRequest,
  onUserProfile,
  onAutoArchive
}) {
  const screenshots = project.screenshots;
  const state = accessState(project, account);

  return (
    <div className="drawerBackdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div>
            <h2>{project.title}</h2>
            <p>{project.summary}</p>
            <div className="cardMetrics drawerMetrics">
              <AccessBadge tier={project.accessTier} owned={project.owned} />
              <span>
                <Star size={14} fill="currentColor" />
                {project.averageRating || "0.0"} ({project.reviewCount})
              </span>
              <span>
                <BadgeDollarSign size={14} />
                {formatPrice(project)}
              </span>
              <span>
                <Scale size={14} />
                {licenseLabels[project.licenseType] || project.licenseType}
              </span>
              <span>
                <Download size={14} />
                {project.downloadCount || 0}
              </span>
              <span>
                <Eye size={14} />
                {project.viewCount || 0}
              </span>
            </div>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="gallery">
          {screenshots.length ? (
            screenshots.map((shot) => <img src={shot.url} alt="" key={shot.id} />)
          ) : (
            <div className="emptyGallery">
              <ImageIcon size={28} />
            </div>
          )}
        </div>

        <ProjectAuthorCard creator={project.createdBy} onOpen={onUserProfile} />
        <PublicSharePanel project={project} creator={project.createdBy} />

        <div className="drawerMeta">
          <Meta icon={<Code2 size={16} />} label={project.languages.join(", ") || "Язык не указан"} />
          <Meta icon={<Tags size={16} />} label={project.tags.join(", ") || "Без тегов"} />
          <Meta icon={<FolderKanban size={16} />} label={project.collections.join(", ") || "Без коллекции"} />
          <Meta icon={<BookOpen size={16} />} label={project.categories.join(", ") || "Без категории"} />
          <Meta icon={<CalendarDays size={16} />} label={formatDate(project.createdAt)} />
          {project.fileName && (
            <Meta icon={<Download size={16} />} label={`${project.fileName} ${formatBytes(project.fileSize)}`} />
          )}
        </div>

        {notice.text && <p className={`notice ${notice.type}`}>{notice.text}</p>}

        <section className="detailSection">
          <h3>Описание</h3>
          <p className="description">{project.description || project.summary}</p>
        </section>

        <InfoGrid project={project} />

        <section className="detailSection">
          <h3>Инструкция установки</h3>
          <pre className="codeBlock">{project.installation || "Инструкция пока не добавлена."}</pre>
        </section>

        <section className="detailSection">
          <h3>Примеры запуска</h3>
          <pre className="codeBlock">{project.runExamples || "Примеры запуска пока не добавлены."}</pre>
        </section>

        <section className="detailSection">
          <h3>Превью кода</h3>
          <pre className="codeBlock">{project.codePreview || "Snippet пока не добавлен."}</pre>
        </section>

        <section className="detailSection">
          <h3>Версии файлов</h3>
          <VersionList project={project} onPrimary={onPrimary} />
        </section>

        <section className="detailSection">
          <h3>Дополнительные файлы</h3>
          <FileList project={project} onPrimary={onPrimary} />
        </section>

        <section className="detailSection">
          <h3>Changelog</h3>
          <p className="description">{project.changelog || "Изменения пока не добавлены."}</p>
        </section>

        <ProjectLinks project={project} />

        {!state.unlocked && (
          <div className={`accessCta tier-${state.tier}`}>
            {state.tier === "vip" ? <Crown size={18} /> : state.tier === "subscription" ? <Rocket size={18} /> : <Lock size={18} />}
            <div>
              <strong>
                {state.tier === "paid"
                  ? "Платный исходник"
                  : state.tier === "subscription"
                    ? "Доступ по подписке"
                    : "Только для VIP"}
              </strong>
              <p>
                {state.tier === "paid"
                  ? `Купите исходник за ${formatPrice(project)}, чтобы скачать файлы.`
                  : state.tier === "subscription"
                    ? "Оформите подписку — и проект откроется вместе со всем разделом."
                    : "Проект доступен в VIP-разделе с безлимитными скачиваниями."}
              </p>
            </div>
          </div>
        )}

        <div className="drawerActions">
          <button type="button" onClick={() => onFavorite(project)}>
            <Star size={17} fill="currentColor" />
            {project.isFavorite ? "Сохранено" : "Сохранить"}
          </button>
          <button type="button" className="primary" onClick={() => onPrimary(project)}>
            {state.action === "download" ? (
              <Download size={17} />
            ) : state.action === "purchase" ? (
              <CreditCard size={17} />
            ) : state.action === "vip" ? (
              <Crown size={17} />
            ) : (
              <Rocket size={17} />
            )}
            {state.unlocked ? "Скачать latest" : state.label}
          </button>
          {state.unlocked && (
            <button type="button" onClick={() => onAutoArchive(project)}>
              <Archive size={17} />
              Autoarchive
            </button>
          )}
        </div>

        <TelegramShareCard project={project} />

        <section className="detailSection">
          <h3>Заказать доработку</h3>
          <form className="inlineForm" onSubmit={(event) => onRequest(event, project.id)}>
            <input type="hidden" name="type" value="custom" />
            <textarea name="message" rows={3} required placeholder="Опишите, что нужно доработать или кастомизировать в проекте" />
            <input name="budget" placeholder="Бюджет, напр. 1500 Stars" />
            <input name="contact" placeholder="Контакт для связи (@username, почта)" />
            <button type="submit" className="primary">
              <Wrench size={16} />
              Отправить заявку
            </button>
          </form>
        </section>

        <section className="detailSection">
          <h3>Отзывы</h3>
          <ReviewForm project={project} onReview={onReview} />
          <div className="reviews">
            {project.reviews.length ? (
              project.reviews.map((review) => <ReviewItem review={review} key={review.id} />)
            ) : (
              <p className="mutedText">Отзывов пока нет.</p>
            )}
          </div>
        </section>

        <section className="detailSection">
          <h3>README.md preview</h3>
          <pre className="codeBlock">{project.readmePreview || "README будет собран автоматически из описания, установки и требований."}</pre>
        </section>

        <section className="detailSection">
          <h3>Сообщить о проблеме</h3>
          <ReportForm project={project} onReport={onReport} />
        </section>
      </aside>
    </div>
  );
}

function VerifiedBadge({ verified }) {
  if (!verified) return null;
  return (
    <span className="verifiedBadge" title="Профиль проверен администратором">
      <CheckCircle2 size={13} />
      verified
    </span>
  );
}

function AuthorBadges({ user }) {
  if (!user) return null;
  return (
    <>
      <VerifiedBadge verified={user.isVerified} />
      {user.isTrusted && (
        <span className="verifiedBadge trustedBadge" title="Автору доверена автопубликация">
          <ShieldCheck size={13} />
          trusted
        </span>
      )}
      {user.isTopSeller && (
        <span className="verifiedBadge sellerBadge" title="Top seller">
          <BadgeDollarSign size={13} />
          top seller
        </span>
      )}
    </>
  );
}

function ProjectAuthorCard({ creator, onOpen }) {
  const hasCreator = creator?.id || creator?.username || creator?.telegramId;
  if (!hasCreator) return null;

  const name = displayUserName(creator);
  const username = creator?.username || "";
  const avatarLetter = String(name || "U").trim().slice(0, 1).toUpperCase();

  return (
    <section className="authorCard">
      <div className="profileAvatar">
        {creator.photoUrl ? <img src={creator.photoUrl} alt="" /> : <span>{avatarLetter}</span>}
      </div>
      <div className="authorCardBody">
        <strong>
          {name}
          <AuthorBadges user={creator} />
        </strong>
        <span>{username ? `@${username}` : "Автор без публичного username"}</span>
      </div>
      {username && (
        <button type="button" onClick={() => onOpen?.(username)}>
          <User size={16} />
          Профиль
        </button>
      )}
    </section>
  );
}

function PublicSharePanel({ project, creator }) {
  const links = [
    { label: "Проект", url: publicProjectLink(project.slug) },
    creator?.username ? { label: "Автор", url: publicUserLink(creator.username) } : null
  ].filter((item) => item?.url);

  if (!links.length) return null;

  return (
    <section className="sharePanel">
      {links.map((item) => (
        <label key={item.label}>
          {item.label}
          <span>
            <input readOnly value={item.url} onFocus={(event) => event.currentTarget.select()} />
            <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Открыть ссылку: ${item.label}`}>
              <ExternalLink size={16} />
            </a>
          </span>
        </label>
      ))}
    </section>
  );
}

function TelegramShareCard({ project }) {
  const link = publicProjectLink(project.slug);
  const text = [
    `${project.title} ${project.version ? `(${project.version})` : ""}`.trim(),
    project.summary || project.description || "",
    `Цена: ${formatPrice(project)}`,
    link
  ].filter(Boolean).join("\n");

  return (
    <section className="telegramShareCard">
      <div>
        <strong>
          <Send size={16} />
          Telegram share card
        </strong>
        <p>{project.summary || "Готовая карточка для шеринга проекта в Telegram."}</p>
      </div>
      <textarea readOnly rows={4} value={text} onFocus={(event) => event.currentTarget.select()} />
    </section>
  );
}

function UserProfileDrawer({ profile, onClose, onOpenProject, onReportAuthor }) {
  const name = displayUserName(profile);
  const publicLink = publicUserLink(profile.username);
  const avatarLetter = String(name || "U").trim().slice(0, 1).toUpperCase();

  return (
    <div className="drawerBackdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer profileDrawer" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div className="profileHero">
            <div className="profileAvatar large">
              {profile.photoUrl ? <img src={profile.photoUrl} alt="" /> : <span>{avatarLetter}</span>}
            </div>
            <div>
              <h2>
                {name}
                <AuthorBadges user={profile} />
              </h2>
              <p>{profile.username ? `@${profile.username}` : "Публичный username не указан"}</p>
            </div>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="profileStats">
          <span>
            <FolderKanban size={15} />
            <strong>{profile.stats?.projects || 0}</strong>
            проектов
          </span>
          <span>
            <Download size={15} />
            <strong>{profile.stats?.downloads || 0}</strong>
            скачиваний
          </span>
          <span>
            <Star size={15} fill="currentColor" />
            <strong>{profile.stats?.favorites || 0}</strong>
            избранных
          </span>
          <span>
            <MessageSquare size={15} />
            <strong>{profile.stats?.reviews || 0}</strong>
            отзывов
          </span>
        </div>

        {publicLink && (
          <section className="sharePanel single">
            <label>
              Публичная ссылка
              <span>
                <input readOnly value={publicLink} onFocus={(event) => event.currentTarget.select()} />
                <a href={publicLink} target="_blank" rel="noreferrer" aria-label="Открыть публичный профиль">
                  <ExternalLink size={16} />
                </a>
              </span>
            </label>
          </section>
        )}

        <section className="detailSection">
          <h3>Проекты автора</h3>
          {profile.projects?.length ? (
            <div className="versionList">
              {profile.projects.map((project) => (
                <div className="versionItem" key={project.id}>
                  <div>
                    <strong>{project.title}</strong>
                    <span>
                      {project.version || "latest"} · {formatPrice(project)} · {project.downloadCount || 0} скач.
                    </span>
                    <p>{project.summary || project.description}</p>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      onClose();
                      onOpenProject(project);
                    }}
                  >
                    <ExternalLink size={16} />
                    Открыть
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mutedText">У автора пока нет опубликованных проектов.</p>
          )}
        </section>

        <section className="detailSection">
          <h3>Жалоба на автора</h3>
          <form className="inlineForm" onSubmit={(event) => onReportAuthor(profile, event)}>
            <select name="reason" defaultValue="abuse">
              <option value="abuse">Нарушение / обман</option>
              <option value="malware">Подозрение на вредоносный код</option>
              <option value="support">Нет поддержки после покупки</option>
              <option value="other">Другое</option>
            </select>
            <textarea name="details" rows={3} placeholder="Опишите проблему" />
            <button type="submit">
              <Flag size={16} />
              Отправить жалобу
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function InfoGrid({ project }) {
  return (
    <section className="infoGrid" aria-label="Требования проекта">
      <InfoItem icon={<Monitor size={16} />} label="ОС" value={project.osSupport || "Не указано"} />
      <InfoItem icon={<Terminal size={16} />} label="Node.js" value={project.nodeVersion || "Не требуется"} />
      <InfoItem icon={<Terminal size={16} />} label="Python" value={project.pythonVersion || "Не требуется"} />
      <InfoItem icon={<Scale size={16} />} label="Лицензия" value={licenseLabels[project.licenseType] || project.licenseType} />
      <InfoItem icon={<FileCode2 size={16} />} label="Требования" value={project.requirements || "Не указано"} wide />
    </section>
  );
}

function InfoItem({ icon, label, value, wide = false }) {
  return (
    <div className={`infoItem ${wide ? "wide" : ""}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function VersionList({ project, onPrimary }) {
  if (!project.versions.length) {
    return <p className="mutedText">Версии пока не добавлены.</p>;
  }

  return (
    <div className="versionList">
      {project.versions.map((version) => (
        <div className="versionItem" key={version.id}>
          <div>
            <strong>{version.version || "Без номера"}</strong>
            <span>
              {formatDate(version.createdAt)} · {version.downloadCount} скачиваний
              {version.fileName ? ` · ${version.fileName} ${formatBytes(version.fileSize)}` : ""}
            </span>
            <div className="fileMetaLine">
              <ScanBadge status={version.scanStatus} notes={version.scanNotes} />
              <SignatureLink url={version.signatureUrl} />
              {version.fileSha256 && <small>SHA-256: {version.fileSha256.slice(0, 18)}...</small>}
            </div>
            {version.changelog && <p>{version.changelog}</p>}
          </div>
          {version.hasFile && (
            <button type="button" className="primary" onClick={() => onPrimary(project, version.id)}>
              <Download size={16} />
              Скачать
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FileList({ project, onPrimary }) {
  if (!project.files?.length) {
    return <p className="mutedText">Дополнительные файлы пока не добавлены.</p>;
  }

  return (
    <div className="versionList">
      {project.files.map((file) => (
        <div className="versionItem" key={file.id}>
          <div>
            <strong>{file.fileName || "Файл"}</strong>
            <span>
              {formatDate(file.createdAt)} · {file.downloadCount || 0} скачиваний
              {file.fileSize ? ` · ${formatBytes(file.fileSize)}` : ""}
            </span>
            <div className="fileMetaLine">
              <ScanBadge status={file.scanStatus} notes={file.scanNotes} />
              <SignatureLink url={file.signatureUrl} />
              {file.fileSha256 && <small>SHA-256: {file.fileSha256.slice(0, 18)}...</small>}
            </div>
          </div>
          {file.hasFile && (
            <button type="button" className="primary" onClick={() => onPrimary(project, null, file.id)}>
              <Download size={16} />
              Скачать
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectLinks({ project }) {
  const links = [
    { label: "GitHub", url: project.repositoryUrl, icon: <ExternalLink size={17} /> },
    { label: "Demo", url: project.demoUrl, icon: <Play size={17} /> },
    { label: "Документация", url: project.docsUrl, icon: <BookOpen size={17} /> },
    { label: "Видео", url: project.videoUrl, icon: <Video size={17} /> }
  ].filter((item) => item.url);

  if (!links.length) return null;

  return (
    <section className="detailSection">
      <h3>Ссылки</h3>
      <div className="drawerActions">
        {links.map((item) => (
          <a href={item.url} target="_blank" rel="noreferrer" key={item.label}>
            {item.icon}
            {item.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function Meta({ icon, label }) {
  return (
    <span>
      {icon}
      {label}
    </span>
  );
}

function ReviewForm({ project, onReview }) {
  return (
    <form className="inlineForm" onSubmit={(event) => onReview(project, event)}>
      <select name="rating" defaultValue="5">
        <option value="5">5 звезд</option>
        <option value="4">4 звезды</option>
        <option value="3">3 звезды</option>
        <option value="2">2 звезды</option>
        <option value="1">1 звезда</option>
      </select>
      <textarea name="comment" rows={3} placeholder="Комментарий" />
      <button type="submit" className="primary">
        <MessageSquare size={16} />
        Отправить отзыв
      </button>
    </form>
  );
}

function ReportForm({ project, onReport }) {
  return (
    <form className="inlineForm" onSubmit={(event) => onReport(project, event)}>
      <select name="reason" defaultValue="download">
        <option value="download">Не скачивается</option>
        <option value="malware">Подозрительный файл</option>
        <option value="description">Неверное описание</option>
        <option value="other">Другое</option>
      </select>
      <textarea name="details" rows={3} placeholder="Подробности" />
      <button type="submit">
        <Flag size={16} />
        Отправить жалобу
      </button>
    </form>
  );
}

function ReviewItem({ review }) {
  const author =
    review.author.firstName ||
    review.author.username ||
    "Пользователь";

  return (
    <div className="reviewItem">
      <div>
        <strong>{author}</strong>
        <span>
          <Star size={14} fill="currentColor" />
          {review.rating}
        </span>
      </div>
      {review.comment && <p>{review.comment}</p>}
      <small>{formatDate(review.createdAt)}</small>
    </div>
  );
}

function listValue(items) {
  return (items || []).join(", ");
}

function displayUserName(userItem) {
  return (
    [userItem.firstName, userItem.lastName].filter(Boolean).join(" ") ||
    userItem.username ||
    userItem.telegramId ||
    `ID ${userItem.id}`
  );
}

function StatusPill({ status }) {
  return <span className={`statusPill ${status}`}>{statusLabels[status] || status}</span>;
}

function ScanBadge({ status, notes }) {
  if (!status) return null;
  return (
    <span className={`scanBadge ${status}`} title={notes || ""}>
      <ShieldCheck size={13} />
      {scanStatusLabels[status] || status}
    </span>
  );
}

function SignatureLink({ url }) {
  if (!url) return null;
  return (
    <a className="signatureLink" href={url} target="_blank" rel="noreferrer">
      Подпись
    </a>
  );
}

function AccountPanel({
  user,
  account,
  purchases = [],
  projects = [],
  notice,
  onSubscribe,
  onVip,
  onRedeem,
  onRequest,
  onProjectSubmit,
  onOpenProject,
  onProjectEdit,
  onProjectVersion,
  onProjectScreenshots,
  onDeleteScreenshot
}) {
  const name = displayUserName(user || {});
  const publicLink = publicUserLink(user?.username || "");
  const avatarLetter = String(name || "U").trim().slice(0, 1).toUpperCase();

  return (
    <section className="accountLayout">
      <div className="accountCol">
        {notice.text && <p className={`notice ${notice.type}`}>{notice.text}</p>}

        <div className="statusCard accountIdentity">
          <div className="profileAvatar large">
            {user?.photoUrl ? <img src={user.photoUrl} alt="" /> : <span>{avatarLetter}</span>}
          </div>
          <div>
            <div className="sectionTitle identityTitle">
              <User size={19} />
              <h2>
                {name}
                <AuthorBadges user={user} />
              </h2>
            </div>
            <p className="mutedText">
              {user?.username ? `@${user.username}` : "Добавьте username в Telegram, чтобы получить публичную страницу."}
            </p>
            {publicLink && (
              <label className="publicLinkField">
                Публичная ссылка
                <span>
                  <input readOnly value={publicLink} onFocus={(event) => event.currentTarget.select()} />
                  <a href={publicLink} target="_blank" rel="noreferrer" aria-label="Открыть публичный профиль">
                    <ExternalLink size={16} />
                  </a>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="statusCard">
          <div className="sectionTitle">
            <CreditCard size={19} />
            <h2>Мой доступ</h2>
          </div>
          <div className="statusGrid">
            <div className={`statusTile ${account.isVip ? "active" : ""}`}>
              <span><Crown size={14} /> VIP</span>
              <strong>
                {account.isVip
                  ? account.vipUntil
                    ? `до ${formatDate(account.vipUntil)}`
                    : "активен"
                  : "нет"}
              </strong>
            </div>
            <div className={`statusTile ${account.isSubscriber ? "active" : ""}`}>
              <span><Rocket size={14} /> Подписка</span>
              <strong>
                {account.isSubscriber && account.subscriptionUntil
                  ? `до ${formatDate(account.subscriptionUntil)}`
                  : account.isSubscriber
                    ? "активна"
                    : "нет"}
              </strong>
            </div>
            <div className="statusTile">
              <span><Download size={14} /> Лимит на сегодня</span>
              <strong>
                {account.unlimited
                  ? "безлимит"
                  : `${account.remaining ?? 0} из ${account.downloadLimit}`}
              </strong>
            </div>
          </div>
        </div>

        <form className="statusCard" onSubmit={onRedeem}>
          <div className="sectionTitle">
            <Ticket size={19} />
            <h2>Промокод</h2>
          </div>
          <div className="promoRow">
            <input name="code" required placeholder="Введите промокод" />
            <button type="submit" className="primary">
              <Gift size={16} />
              Активировать
            </button>
          </div>
          <p className="mutedText">Промокод может открыть проект, подписку или VIP-доступ.</p>
        </form>

        <div className="statusCard">
          <div className="sectionTitle">
            <ShoppingBag size={19} />
            <h2>Купленные проекты</h2>
          </div>
          {purchases.length ? (
            <div className="versionList purchaseList">
              {purchases.map((purchase) => (
                <div className="versionItem purchaseItem" key={purchase.id}>
                  <div>
                    <strong>{purchase.project?.title || "Проект"}</strong>
                    <span>
                      {purchase.amountStars || 0} Stars · {purchase.status === "paid" ? "оплачено" : purchase.status} · {formatDate(purchase.createdAt)}
                    </span>
                    <p>{purchase.project?.summary || "Доступ сохранен в аккаунте. Повторная загрузка не требует новой оплаты."}</p>
                  </div>
                  {purchase.project?.slug && (
                    <button type="button" onClick={() => onOpenProject?.(purchase.project)}>
                      <Download size={16} />
                      Открыть
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mutedText">Покупок пока нет. После оплаты проект останется здесь и будет доступен повторно без новой оплаты.</p>
          )}
        </div>

        <OwnerProjects
          projects={projects}
          onOpenProject={onOpenProject}
          onProjectEdit={onProjectEdit}
          onProjectVersion={onProjectVersion}
          onProjectScreenshots={onProjectScreenshots}
          onDeleteScreenshot={onDeleteScreenshot}
        />
      </div>

      <div className="accountCol">
        <div className="planCard">
          <div className="sectionTitle">
            <Rocket size={19} />
            <h2>Подписка</h2>
          </div>
          <p>Безлимитные скачивания и доступ к проектам раздела «Подписка».</p>
          <div className="planPrice">{account.subscriptionPriceLabel || "по запросу"}</div>
          <button type="button" className="primary" onClick={onSubscribe} disabled={account.isSubscriber}>
            <Rocket size={16} />
            {account.isSubscriber ? "Подписка активна" : "Оформить подписку"}
          </button>
        </div>

        <div className="planCard vipPlan">
          <div className="sectionTitle">
            <Crown size={19} />
            <h2>VIP</h2>
          </div>
          <p>Весь каталог без ограничений, VIP-раздел и приоритетная поддержка.</p>
          <div className="planPrice">{account.vipPriceLabel || "по запросу"}</div>
          <button type="button" className="primary" onClick={onVip} disabled={account.isVip}>
            <Crown size={16} />
            {account.isVip ? "VIP активен" : "Получить VIP"}
          </button>
        </div>

        <form className="statusCard" onSubmit={(event) => onRequest(event)}>
          <div className="sectionTitle">
            <Wrench size={19} />
            <h2>Заказать разработку</h2>
          </div>
          <label>
            Что нужно
            <select name="type" defaultValue="custom">
              <option value="custom">Доработка / кастомный проект</option>
              <option value="source">Купить исходник под задачу</option>
            </select>
          </label>
          <textarea name="message" rows={4} required placeholder="Опишите задачу: что нужно сделать, сроки, детали" />
          <div className="formGrid">
            <input name="budget" placeholder="Бюджет" />
            <input name="contact" placeholder="Контакт (@username)" />
          </div>
          <button type="submit" className="primary">
            <Send size={16} />
            Отправить заявку
          </button>
        </form>

        <form className="statusCard submissionForm" onSubmit={onProjectSubmit}>
          <div className="sectionTitle">
            <FolderKanban size={19} />
            <h2>Выставить свой проект</h2>
          </div>
          <p className="mutedText">Проект попадет на проверку администратору. После публикации он появится в каталоге и профиле автора.</p>
          <label>
            Название
            <input name="title" required minLength={2} placeholder="Telegram parser kit" />
          </label>
          <label>
            Slug для ссылки
            <input name="slug" placeholder="telegram-parser-kit" />
          </label>
          <label>
            Короткое описание
            <input name="summary" required placeholder="Что делает проект в одну строку" />
          </label>
          <label>
            Полное описание
            <textarea name="description" rows={4} placeholder="Функции, установка, зависимости, примеры" />
          </label>
          <div className="formGrid">
            <label>
              Тип доступа
              <select name="accessTier" defaultValue="free">
                <option value="free">Free</option>
                <option value="paid">Платный исходник</option>
                <option value="subscription">По подписке</option>
                <option value="vip">VIP</option>
              </select>
            </label>
            <label>
              Цена в Stars
              <input name="priceCents" type="number" min="0" step="1" placeholder="0" />
            </label>
          </div>
          <div className="formGrid">
            <input name="languages" placeholder="Python, Node.js, PHP" />
            <input name="tags" placeholder="bot, parser, api" />
          </div>
          <label>
            Инструкция установки
            <textarea name="installation" rows={3} placeholder="npm install&#10;npm run start" />
          </label>
          <div className="uploadGrid">
            <label className="uploadBox">
              <Upload size={18} />
              Архив проекта
              <input name="package" type="file" />
            </label>
            <label className="uploadBox">
              <ImageIcon size={18} />
              Скриншоты
              <input name="screenshots" type="file" accept="image/*" multiple />
            </label>
            <label className="uploadBox">
              <Link2 size={18} />
              Доп. файлы
              <input name="files" type="file" multiple />
            </label>
          </div>
          <button type="submit" className="primary">
            <Send size={16} />
            Отправить на проверку
          </button>
        </form>
      </div>
    </section>
  );
}

function OwnerProjects({
  projects = [],
  onOpenProject,
  onProjectEdit,
  onProjectVersion,
  onProjectScreenshots,
  onDeleteScreenshot
}) {
  return (
    <div className="statusCard ownerProjects">
      <div className="sectionTitle">
        <FolderKanban size={19} />
        <h2>Мои проекты</h2>
      </div>
      {projects.length ? (
        <div className="ownerProjectList">
          {projects.map((project) => (
            <article className="ownerProjectItem" key={project.id}>
              <div className="ownerProjectHead">
                <div>
                  <strong>{project.title}</strong>
                  <span>
                    <StatusPill status={project.status} />
                    {project.isWeeklyPick && <span className="inlineBadge">weekly</span>}
                    {project.isOnSale && <span className="inlineBadge">sale -{project.salePercent}%</span>}
                  </span>
                </div>
                {project.slug && (
                  <button type="button" onClick={() => onOpenProject?.(project)}>
                    <ExternalLink size={15} />
                    Открыть
                  </button>
                )}
              </div>

              <form className="versionForm editProjectForm" onSubmit={(event) => onProjectEdit(project, event)}>
                <label>
                  Название
                  <input name="title" required minLength={2} defaultValue={project.title} />
                </label>
                <label>
                  Slug
                  <input name="slug" defaultValue={project.slug} />
                </label>
                <label className="wide">
                  Кратко
                  <input name="summary" defaultValue={project.summary} />
                </label>
                <label className="wide">
                  Описание
                  <textarea name="description" rows={3} defaultValue={project.description} />
                </label>
                <label className="wide">
                  Установка
                  <textarea name="installation" rows={3} defaultValue={project.installation} />
                </label>
                <label>
                  Цена в Telegram Stars
                  <input name="priceCents" type="number" min="0" step="1" defaultValue={project.priceCents || 0} />
                </label>
                <label>
                  Тип доступа
                  <select name="accessTier" defaultValue={project.accessTier || "free"}>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                    <option value="subscription">Подписка</option>
                    <option value="vip">VIP</option>
                  </select>
                </label>
                <label>
                  Языки
                  <input name="languages" defaultValue={listValue(project.languages)} />
                </label>
                <label>
                  Теги
                  <input name="tags" defaultValue={listValue(project.tags)} />
                </label>
                <button type="submit" className="primary wide">
                  <Save size={15} />
                  Сохранить правки
                </button>
              </form>

              <form className="versionForm" onSubmit={(event) => onProjectVersion(project, event)}>
                <input name="version" placeholder="v1.1.0" />
                <textarea name="changelog" rows={2} placeholder="Что изменилось" />
                <input name="package" type="file" />
                <button type="submit" className="primary">
                  <Upload size={15} />
                  Загрузить версию
                </button>
              </form>

              <div className="screenshotAdminGrid">
                {project.screenshots?.length ? (
                  project.screenshots.map((shot) => (
                    <div className="screenshotAdminItem" key={shot.id}>
                      <img src={shot.url} alt="" />
                      <button type="button" onClick={() => onDeleteScreenshot(project, shot)} aria-label="Удалить скриншот">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="mutedText">Скриншотов пока нет</span>
                )}
              </div>
              <form className="versionForm" onSubmit={(event) => onProjectScreenshots(project, event)}>
                <input name="screenshots" type="file" accept="image/*" multiple />
                <button type="submit">
                  <ImageIcon size={15} />
                  Добавить скриншоты
                </button>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <p className="mutedText">После первой заявки проект появится здесь. Проверенные авторы публикуются автоматически.</p>
      )}
    </div>
  );
}

function AdminPanel({
  notice,
  loading,
  mode,
  onMode,
  projects,
  users,
  reviews,
  reports,
  downloads,
  limits,
  promo,
  requests,
  purchases,
  onCreate,
  onEdit,
  onStatus,
  onPin,
  onWeekly,
  onSale,
  onArchive,
  onVersion,
  onFiles,
  onScreenshots,
  onDeleteScreenshot,
  onSendAuthorMessage,
  onReviewUpload,
  onToggleUploadHidden,
  onDeleteUpload,
  onBanUser,
  onVerifyUser,
  onToggleUserBadge,
  onModerateReview,
  onDeleteReview,
  onReportStatus,
  onBroadcast,
  onCreatePromo,
  onDeactivatePromo,
  onRequestStatus,
  onConfirmPurchase,
  onGrant
}) {
  const totalViews = projects.reduce((sum, project) => sum + (project.viewCount || 0), 0);
  const totalFavorites = projects.reduce((sum, project) => sum + (project.favoriteCount || 0), 0);
  const totalDownloads = projects.reduce((sum, project) => sum + (project.downloadCount || 0), 0);
  const bannedUsers = users.filter((item) => item.isBanned).length;

  return (
    <section className="adminLayout">
      <form className="adminForm" onSubmit={onCreate}>
        <div className="sectionTitle">
          <Plus size={19} />
          <h2>Новый проект</h2>
        </div>

        {notice.text && <p className={`notice ${notice.type}`}>{notice.text}</p>}

        <div className="formGrid">
          <label>
            Статус
            <select name="status" defaultValue="draft">
              <option value="draft">Черновик</option>
              <option value="pending">На проверке</option>
              <option value="published">Опубликовать сразу</option>
              <option value="hidden">Скрытый проект</option>
            </select>
          </label>
          <label>
            Тип доступа
            <select name="accessTier" defaultValue="free">
              <option value="free">Free — бесплатно</option>
              <option value="paid">Paid — купить исходник</option>
              <option value="subscription">Подписка</option>
              <option value="vip">VIP-раздел</option>
            </select>
          </label>
        </div>

        <label>
          Название
          <input name="title" required minLength={2} placeholder="Telegram parser kit" />
        </label>

        <label>
          Короткое описание
          <input name="summary" placeholder="Что делает проект в одну строку" />
        </label>

        <label>
          Полное описание
          <textarea name="description" rows={5} placeholder="Функции, установка, зависимости, примеры" />
        </label>

        <label>
          Инструкция установки
          <textarea name="installation" rows={4} placeholder="npm install&#10;cp .env.example .env&#10;npm run start" />
        </label>

        <label>
          Требования и зависимости
          <textarea name="requirements" rows={4} placeholder="PostgreSQL/SQLite, Redis, FFmpeg, API keys..." />
        </label>

        <div className="formGrid">
          <label>
            ОС
            <input name="osSupport" placeholder="Linux VPS, Ubuntu 22.04, Windows" />
          </label>
          <label>
            Лицензия
            <select name="licenseType" defaultValue="free">
              <option value="free">Free</option>
              <option value="personal">Personal</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
        </div>

        <div className="formGrid">
          <label>
            Node.js версия
            <input name="nodeVersion" placeholder=">=20, >=24, не требуется" />
          </label>
          <label>
            Python версия
            <input name="pythonVersion" placeholder=">=3.11, не требуется" />
          </label>
        </div>

        <label>
          Примеры запуска
          <textarea name="runExamples" rows={4} placeholder="node index.js&#10;python main.py --config config.yml" />
        </label>

        <label>
          Превью кода или demo snippet
          <textarea name="codePreview" rows={6} placeholder="const bot = new Telegraf(process.env.BOT_TOKEN);" />
        </label>

        <label>
          Changelog первой версии
          <textarea name="changelog" rows={4} placeholder="v1.0.0: первый релиз, что добавлено и исправлено" />
        </label>

        <div className="formGrid">
          <label>
            Языки
            <input name="languages" placeholder="Node.js, Python, Bash" />
          </label>
          <label>
            Теги
            <input name="tags" placeholder="bot, parser, api" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Коллекции
            <input name="collections" placeholder="Боты, Парсеры, AI" />
          </label>
          <label>
            Категории
            <input name="categories" placeholder="Backend, CLI, SaaS, Automation" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Цена в Telegram Stars
            <input name="priceCents" type="number" min="0" step="1" placeholder="0" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Версия
            <input name="version" placeholder="v1.0.0" />
          </label>
          <label>
            Slug
            <input name="slug" placeholder="telegram-parser-kit" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            GitHub
            <input name="repositoryUrl" type="url" placeholder="https://github.com/..." />
          </label>
          <label>
            Demo
            <input name="demoUrl" type="url" placeholder="https://..." />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Документация
            <input name="docsUrl" type="url" placeholder="https://docs.example.com" />
          </label>
          <label>
            Видео
            <input name="videoUrl" type="url" placeholder="https://youtube.com/..." />
          </label>
        </div>

        <div className="uploadGrid">
          <label className="uploadBox">
            <Upload size={19} />
            Файл версии
            <input name="package" type="file" />
          </label>
          <label className="uploadBox">
            <ImageIcon size={19} />
            Скриншоты
            <input name="screenshots" type="file" accept="image/*" multiple />
          </label>
          <label className="uploadBox">
            <Link2 size={19} />
            Доп. файлы
            <input name="files" type="file" multiple />
          </label>
        </div>
        <p className="mutedText uploadLimitText">
          Лимит загрузки: до {limits?.maxUploadMb || 100} MB на файл. Архивы получают SHA-256 и подпись автоматически.
        </p>

        <button type="submit" className="submitButton">
          <Save size={18} />
          Сохранить проект
        </button>
      </form>

      <div className="adminList">
        <div className="sectionTitle">
          <BarChart3 size={19} />
          <h2>Управление</h2>
        </div>

        <div className="adminTabs">
          <button type="button" className={mode === "projects" ? "active" : ""} onClick={() => onMode("projects")}>
            <FolderKanban size={16} />
            Проекты
          </button>
          <button type="button" className={mode === "users" ? "active" : ""} onClick={() => onMode("users")}>
            <Users size={16} />
            Пользователи
          </button>
          <button type="button" className={mode === "reviews" ? "active" : ""} onClick={() => onMode("reviews")}>
            <MessageSquare size={16} />
            Отзывы
          </button>
          <button type="button" className={mode === "reports" ? "active" : ""} onClick={() => onMode("reports")}>
            <Flag size={16} />
            Жалобы
          </button>
          <button type="button" className={mode === "downloads" ? "active" : ""} onClick={() => onMode("downloads")}>
            <Download size={16} />
            Логи
          </button>
          <button type="button" className={mode === "broadcast" ? "active" : ""} onClick={() => onMode("broadcast")}>
            <Megaphone size={16} />
            Рассылка
          </button>
          <button type="button" className={mode === "money" ? "active" : ""} onClick={() => onMode("money")}>
            <CreditCard size={16} />
            Монетизация
          </button>
        </div>

        <div className="adminStats">
          <span>
            <Eye size={15} />
            {totalViews} просмотров
          </span>
          <span>
            <Download size={15} />
            {totalDownloads} скачиваний
          </span>
          <span>
            <Star size={15} />
            {totalFavorites} избранных
          </span>
          <span>
            <Ban size={15} />
            {bannedUsers} банов
          </span>
        </div>

        {loading ? (
          <div className="skeleton listSkeleton" />
        ) : mode === "users" ? (
          <AdminUsers
            users={users}
            onBanUser={onBanUser}
            onVerifyUser={onVerifyUser}
            onToggleUserBadge={onToggleUserBadge}
          />
        ) : mode === "reviews" ? (
          <AdminReviews
            reviews={reviews}
            onModerateReview={onModerateReview}
            onDeleteReview={onDeleteReview}
          />
        ) : mode === "reports" ? (
          <AdminReports reports={reports} onReportStatus={onReportStatus} />
        ) : mode === "downloads" ? (
          <AdminDownloads downloads={downloads} />
        ) : mode === "broadcast" ? (
          <BroadcastPanel onBroadcast={onBroadcast} />
        ) : mode === "money" ? (
          <AdminMoney
            promo={promo}
            requests={requests}
            purchases={purchases}
            onCreatePromo={onCreatePromo}
            onDeactivatePromo={onDeactivatePromo}
            onRequestStatus={onRequestStatus}
            onConfirmPurchase={onConfirmPurchase}
            onGrant={onGrant}
          />
        ) : projects.length ? (
          projects.map((project) => (
            <AdminProjectCard
              project={project}
              onEdit={onEdit}
              onStatus={onStatus}
              onPin={onPin}
              onWeekly={onWeekly}
              onSale={onSale}
              onArchive={onArchive}
              onVersion={onVersion}
              onFiles={onFiles}
              onScreenshots={onScreenshots}
              onDeleteScreenshot={onDeleteScreenshot}
              onSendAuthorMessage={onSendAuthorMessage}
              onReviewUpload={onReviewUpload}
              onToggleUploadHidden={onToggleUploadHidden}
              onDeleteUpload={onDeleteUpload}
              key={project.id}
            />
          ))
        ) : (
          <section className="emptyState compactEmpty">
            <FolderKanban size={24} />
            <h2>Проектов пока нет</h2>
            <p>Создай первый черновик слева.</p>
          </section>
        )}
      </div>
    </section>
  );
}

function AdminProjectCard({
  project,
  onEdit,
  onStatus,
  onPin,
  onWeekly,
  onSale,
  onArchive,
  onVersion,
  onFiles,
  onScreenshots,
  onDeleteScreenshot,
  onSendAuthorMessage,
  onReviewUpload,
  onToggleUploadHidden,
  onDeleteUpload
}) {
  return (
    <div className="adminRow adminProject">
      <div className="adminRowMain">
        <div className="adminProjectHead">
          <div>
            <strong>{project.title}</strong>
            <span>
              {project.version || "no version"} · {project.updatedAt ? formatDate(project.updatedAt) : formatDate(project.createdAt)}
            </span>
          </div>
          <div className="adminHeadBadges">
            <StatusPill status={project.status} />
            {project.pinnedAt && (
              <span className="statusPill pinned">
                <Pin size={13} />
                pinned
              </span>
            )}
            {project.isWeeklyPick && <span className="inlineBadge">weekly</span>}
            {project.isOnSale && <span className="inlineBadge">sale -{project.salePercent}%</span>}
          </div>
        </div>

        <div className="adminMetrics">
          <span>
            <Eye size={14} />
            {project.viewCount || 0} просмотров
          </span>
          <span>
            <Download size={14} />
            {project.downloadCount || 0} скачиваний
          </span>
          <span>
            <Star size={14} />
            {project.favoriteCount || 0} избранных
          </span>
          <span>
            <MessageSquare size={14} />
            {project.reviewCount || 0} отзывов
          </span>
        </div>
        {(project.fileScanStatus || project.fileSignatureUrl) && (
          <div className="fileMetaLine adminScanLine">
            <ScanBadge status={project.fileScanStatus} notes={project.fileScanNotes} />
            <SignatureLink url={project.fileSignatureUrl} />
            {project.fileSha256 && <small>SHA-256: {project.fileSha256.slice(0, 18)}...</small>}
          </div>
        )}

        <div className="adminTool">
          <strong>
            <Megaphone size={15} />
            Модерация и витрина
          </strong>
          <form className="versionForm" onSubmit={(event) => onSale(project, event)}>
            <input name="percent" type="number" min="0" max="95" step="1" defaultValue={project.salePercent || 0} placeholder="Скидка %" />
            <input name="endsAt" type="datetime-local" defaultValue={project.saleEndsAt ? project.saleEndsAt.slice(0, 16).replace(" ", "T") : ""} />
            <button type="submit">
              <BadgeDollarSign size={15} />
              Скидка Stars
            </button>
          </form>
          <form className="versionForm" onSubmit={(event) => onSendAuthorMessage(project, event)}>
            <input name="title" placeholder="Тема сообщения автору" defaultValue="Нужны правки по проекту" />
            <textarea name="message" rows={2} required placeholder="Что нужно исправить или уточнить" />
            <button type="submit">
              <Send size={15} />
              Написать автору
            </button>
          </form>
        </div>

        <form className="versionForm editProjectForm" onSubmit={(event) => onEdit(project, event)}>
          <label>
            Название
            <input name="title" required minLength={2} defaultValue={project.title} />
          </label>
          <label>
            Статус
            <select name="status" defaultValue={project.status}>
              <option value="draft">Черновик</option>
              <option value="pending">На проверке</option>
              <option value="published">Опубликован</option>
              <option value="hidden">Скрыт</option>
              <option value="archived">Архив</option>
            </select>
          </label>
          <label>
            Кратко
            <input name="summary" defaultValue={project.summary} />
          </label>
          <label>
            Версия
            <input name="version" defaultValue={project.version} placeholder="v1.1.0" />
          </label>
          <label className="wide">
            Описание
            <textarea name="description" rows={3} defaultValue={project.description} />
          </label>
          <label className="wide">
            Установка
            <textarea name="installation" rows={3} defaultValue={project.installation} />
          </label>
          <label>
            Языки
            <input name="languages" defaultValue={listValue(project.languages)} />
          </label>
          <label>
            Теги
            <input name="tags" defaultValue={listValue(project.tags)} />
          </label>
          <label>
            Коллекции
            <input name="collections" defaultValue={listValue(project.collections)} />
          </label>
          <label>
            Категории
            <input name="categories" defaultValue={listValue(project.categories)} />
          </label>
          <label>
            Цена в Telegram Stars
            <input name="priceCents" type="number" min="0" step="1" defaultValue={project.priceCents || 0} />
          </label>
          <label>
            Лицензия
            <select name="licenseType" defaultValue={project.licenseType}>
              <option value="free">Free</option>
              <option value="personal">Personal</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
          <label>
            Тип доступа
            <select name="accessTier" defaultValue={project.accessTier || "free"}>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
              <option value="subscription">Подписка</option>
              <option value="vip">VIP</option>
            </select>
          </label>
          <label>
            Slug
            <input name="slug" defaultValue={project.slug} />
          </label>
          <label>
            GitHub
            <input name="repositoryUrl" type="url" defaultValue={project.repositoryUrl} />
          </label>
          <label>
            Demo
            <input name="demoUrl" type="url" defaultValue={project.demoUrl} />
          </label>
          <label>
            Документация
            <input name="docsUrl" type="url" defaultValue={project.docsUrl} />
          </label>
          <label>
            Видео
            <input name="videoUrl" type="url" defaultValue={project.videoUrl} />
          </label>
          <label className="wide">
            Changelog
            <textarea name="changelog" rows={3} defaultValue={project.changelog} />
          </label>
          <label className="wide">
            Требования
            <textarea name="requirements" rows={3} defaultValue={project.requirements} />
          </label>
          <label>
            ОС
            <input name="osSupport" defaultValue={project.osSupport} />
          </label>
          <label>
            Node.js
            <input name="nodeVersion" defaultValue={project.nodeVersion} />
          </label>
          <label>
            Python
            <input name="pythonVersion" defaultValue={project.pythonVersion} />
          </label>
          <label className="wide">
            Примеры запуска
            <textarea name="runExamples" rows={3} defaultValue={project.runExamples} />
          </label>
          <label className="wide">
            Превью кода
            <textarea name="codePreview" rows={4} defaultValue={project.codePreview} />
          </label>
          <label className="uploadBox wide">
            <Upload size={17} />
            Заменить файл latest
            <input name="package" type="file" />
          </label>
          <button type="submit" className="primary wide">
            <Save size={15} />
            Сохранить правки
          </button>
        </form>

        <div className="adminTool">
          <strong>
            <Send size={15} />
            Версии
          </strong>
          <div className="adminFileList uploadReviewList">
            {project.versions?.length ? (
              project.versions.map((version) => (
                <UploadReviewItem
                  item={version}
                  kind="version"
                  project={project}
                  onReviewUpload={onReviewUpload}
                  onToggleUploadHidden={onToggleUploadHidden}
                  onDeleteUpload={onDeleteUpload}
                  key={version.id}
                />
              ))
            ) : (
              <span>Версии не добавлены</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onVersion(project, event)}>
            <input name="version" placeholder="v1.1.0" />
            <textarea name="changelog" rows={2} placeholder="Changelog этой версии" />
            <input name="package" type="file" />
            <button type="submit" className="primary">
              <Send size={15} />
              Добавить версию
            </button>
          </form>
        </div>

        <div className="adminTool">
          <strong>
            <Link2 size={15} />
            Дополнительные файлы
          </strong>
          <div className="adminFileList">
            {project.files?.length ? (
              project.files.map((file) => (
                <UploadReviewItem
                  item={file}
                  kind="file"
                  project={project}
                  onReviewUpload={onReviewUpload}
                  onToggleUploadHidden={onToggleUploadHidden}
                  onDeleteUpload={onDeleteUpload}
                  key={file.id}
                />
              ))
            ) : (
              <span>Файлы не добавлены</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onFiles(project, event)}>
            <input name="files" type="file" multiple />
            <button type="submit">
              <Upload size={15} />
              Загрузить файлы
            </button>
          </form>
        </div>

        <div className="adminTool">
          <strong>
            <ImageIcon size={15} />
            Скриншоты
          </strong>
          <div className="screenshotAdminGrid">
            {project.screenshots?.length ? (
              project.screenshots.map((shot) => (
                <div className="screenshotAdminItem" key={shot.id}>
                  <img src={shot.url} alt="" />
                  <button type="button" onClick={() => onDeleteScreenshot(project, shot)} aria-label="Удалить скриншот">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <span className="mutedText">Скриншотов пока нет</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onScreenshots(project, event)}>
            <input name="screenshots" type="file" accept="image/*" multiple />
            <button type="submit">
              <ImageIcon size={15} />
              Добавить скриншоты
            </button>
          </form>
        </div>
      </div>

      <div className="adminSideActions">
        <button type="button" className="primary" onClick={() => onStatus(project, "published")}>
          <Eye size={16} />
          Опубликовать
        </button>
        <button type="button" onClick={() => onStatus(project, "draft")}>
          <Edit3 size={16} />
          В черновик
        </button>
        <button type="button" onClick={() => onStatus(project, "hidden")}>
          <EyeOff size={16} />
          Скрыть
        </button>
        <button type="button" onClick={() => onPin(project)}>
          <Pin size={16} />
          {project.pinnedAt ? "Открепить" : "Закрепить"}
        </button>
        <button type="button" onClick={() => onWeekly(project)}>
          <Star size={16} />
          {project.isWeeklyPick ? "Убрать weekly" : "В weekly"}
        </button>
        <button type="button" className="dangerButton" onClick={() => onArchive(project.id)}>
          <Archive size={16} />
          В архив
        </button>
      </div>
    </div>
  );
}

function UploadReviewItem({ item, kind, project, onReviewUpload, onToggleUploadHidden, onDeleteUpload }) {
  const checklist = item.reviewChecklist || {};
  return (
    <div className={`uploadReviewItem ${item.isHidden ? "hiddenUpload" : ""}`}>
      <div>
        <strong>
          {kind === "version" ? item.version || "Версия" : item.fileName || "Файл"}
          <span className={`inlineBadge ${item.reviewStatus === "rejected" ? "danger" : ""}`}>
            {item.reviewStatus || "pending"}
          </span>
          {item.isHidden && <span className="inlineBadge danger">hidden</span>}
        </strong>
        <span>
          {formatDate(item.createdAt)} · {formatBytes(item.fileSize)} · {item.downloadCount || 0} скач.
        </span>
        <div className="fileMetaLine">
          <ScanBadge status={item.scanStatus} notes={item.scanNotes} />
          <SignatureLink url={item.signatureUrl} />
          {item.fileSha256 && <small>SHA-256: {item.fileSha256.slice(0, 18)}...</small>}
        </div>
      </div>
      <form className="reviewChecklist" onSubmit={(event) => onReviewUpload(project, item, kind, event)}>
        <select name="status" defaultValue={item.reviewStatus || "pending"}>
          <option value="pending">Ожидает</option>
          <option value="approved">Проверен</option>
          <option value="changes">Нужны правки</option>
          <option value="rejected">Отклонен</option>
        </select>
        <label><input name="opens" type="checkbox" defaultChecked={Boolean(checklist.opens)} /> архив</label>
        <label><input name="readme" type="checkbox" defaultChecked={Boolean(checklist.readme)} /> README</label>
        <label><input name="license" type="checkbox" defaultChecked={Boolean(checklist.license)} /> license</label>
        <label><input name="noSecrets" type="checkbox" defaultChecked={Boolean(checklist.noSecrets)} /> no secrets</label>
        <label><input name="dependencies" type="checkbox" defaultChecked={Boolean(checklist.dependencies)} /> deps</label>
        <textarea name="notes" rows={2} defaultValue={item.reviewNotes || ""} placeholder="Заметки ревью" />
        <button type="submit" className="primary">
          <ShieldCheck size={14} />
          Сохранить ревью
        </button>
      </form>
      <div className="rowActions">
        <button type="button" onClick={() => onToggleUploadHidden(project, item, kind)}>
          {item.isHidden ? <Eye size={15} /> : <EyeOff size={15} />}
          {item.isHidden ? "Показать" : "Скрыть"}
        </button>
        <button type="button" className="dangerButton" onClick={() => onDeleteUpload(project, item, kind)}>
          <Trash2 size={15} />
          Удалить
        </button>
      </div>
    </div>
  );
}

function AdminUsers({ users, onBanUser, onVerifyUser, onToggleUserBadge }) {
  if (!users.length) {
    return (
      <section className="emptyState compactEmpty">
        <Users size={24} />
        <h2>Пользователей пока нет</h2>
        <p>Они появятся после входа через WebApp.</p>
      </section>
    );
  }

  return (
    <section className="listPanel adminSimpleList">
      {users.map((userItem) => (
        <div className="activityRow" key={userItem.id}>
          <div>
            <strong>
              {displayUserName(userItem)}
              <AuthorBadges user={userItem} />
              {userItem.isAdmin && <span className="inlineBadge">admin</span>}
              {userItem.isBanned && <span className="inlineBadge danger">ban</span>}
            </strong>
            <span>
              ID {userItem.telegramId} · {userItem.projectCount || 0} проектов · {userItem.downloadCount} скач. · {userItem.favoriteCount} изб. · {userItem.reviewCount} отзыв.
            </span>
            {userItem.banReason && <small>{userItem.banReason}</small>}
          </div>
          <form className="miniInline" onSubmit={(event) => onBanUser(userItem, event)}>
            <button
              type="button"
              className={userItem.isVerified ? "" : "primary"}
              onClick={() => onVerifyUser(userItem)}
            >
              <CheckCircle2 size={15} />
              {userItem.isVerified ? "Снять галочку" : "Верифицировать"}
            </button>
            <button type="button" className={userItem.isTrusted ? "primary" : ""} onClick={() => onToggleUserBadge(userItem, "trusted")}>
              <ShieldCheck size={15} />
              {userItem.isTrusted ? "Trusted" : "Дать trusted"}
            </button>
            <button type="button" className={userItem.isTopSeller ? "primary" : ""} onClick={() => onToggleUserBadge(userItem, "topSeller")}>
              <BadgeDollarSign size={15} />
              {userItem.isTopSeller ? "Top seller" : "Top seller"}
            </button>
            <input name="reason" defaultValue={userItem.banReason} placeholder="Причина бана" />
            <button
              type="submit"
              name="banned"
              value={userItem.isBanned ? "0" : "1"}
              className={userItem.isBanned ? "primary" : "dangerButton"}
            >
              <Ban size={15} />
              {userItem.isBanned ? "Разбанить" : "Забанить"}
            </button>
          </form>
        </div>
      ))}
    </section>
  );
}

function AdminReviews({ reviews, onModerateReview, onDeleteReview }) {
  if (!reviews.length) {
    return (
      <section className="emptyState compactEmpty">
        <MessageSquare size={24} />
        <h2>Отзывов пока нет</h2>
        <p>Отзывы пользователей появятся здесь для модерации.</p>
      </section>
    );
  }

  return (
    <section className="listPanel adminSimpleList">
      {reviews.map((review) => (
        <div className="activityRow" key={review.id}>
          <div>
            <strong>
              {review.project.title} · {review.rating}/5
              <StatusPill status={review.status} />
            </strong>
            <span>{displayUserName(review.author)} · {formatDate(review.createdAt)}</span>
            {review.comment && <p>{review.comment}</p>}
          </div>
          <div className="rowActions">
            {review.status === "hidden" ? (
              <button type="button" className="primary" onClick={() => onModerateReview(review, "published")}>
                <Eye size={15} />
                Опубликовать
              </button>
            ) : (
              <button type="button" onClick={() => onModerateReview(review, "hidden")}>
                <EyeOff size={15} />
                Скрыть
              </button>
            )}
            <button type="button" className="dangerButton" onClick={() => onDeleteReview(review)}>
              <Trash2 size={15} />
              Удалить
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function AdminReports({ reports, onReportStatus }) {
  if (!reports.length) {
    return (
      <section className="emptyState compactEmpty">
        <Flag size={24} />
        <h2>Жалоб пока нет</h2>
        <p>Сообщения о вредоносном коде и проблемах проекта появятся здесь.</p>
      </section>
    );
  }

  return (
    <section className="listPanel adminSimpleList">
      {reports.map((report) => (
        <div
          className={`activityRow ${report.reason === "malware" ? "malwareReport" : ""}`}
          key={report.id}
        >
          <div>
            <strong>
              {report.subjectType === "author"
                ? `Автор: ${displayUserName(report.targetAuthor)}`
                : report.project.title}
              <span className={`inlineBadge ${report.reason === "malware" ? "danger" : ""}`}>
                {reportReasonLabels[report.reason] || report.reason}
              </span>
              {report.subjectType === "author" && <span className="inlineBadge">author</span>}
              <span className={`inlineBadge reportStatus ${report.status}`}>
                {reportStatusLabels[report.status] || report.status}
              </span>
            </strong>
            <span>
              Отправил: {displayUserName(report.author)} · ID {report.author.telegramId} · {formatDate(report.createdAt)}
            </span>
            {report.subjectType === "author" && report.targetAuthor?.telegramId && (
              <small>На автора: ID {report.targetAuthor.telegramId}</small>
            )}
            {report.details && <p>{report.details}</p>}
          </div>
          <div className="rowActions">
            <button type="button" onClick={() => onReportStatus(report, "reviewing")}>
              Проверяется
            </button>
            <button type="button" className="primary" onClick={() => onReportStatus(report, "resolved")}>
              Решена
            </button>
            <button type="button" className="dangerButton" onClick={() => onReportStatus(report, "rejected")}>
              Отклонить
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function AdminDownloads({ downloads }) {
  if (!downloads.length) {
    return (
      <section className="emptyState compactEmpty">
        <Download size={24} />
        <h2>Скачиваний пока нет</h2>
        <p>Когда пользователи начнут скачивать файлы, здесь появится журнал.</p>
      </section>
    );
  }

  return (
    <section className="listPanel adminSimpleList">
      {downloads.map((item) => {
        const target = item.fileName || item.version || "latest";
        return (
          <div className="activityRow downloadLogRow" key={item.id}>
            <div>
              <strong>
                {item.project.title}
                <span className="inlineBadge">{tierLabels[item.project.accessTier] || item.project.accessTier}</span>
              </strong>
              <span>
                {displayUserName(item.user)} · ID {item.user.telegramId} · {formatDate(item.createdAt)}
              </span>
              <small>
                Файл: {target}
                {item.versionId ? ` · версия #${item.versionId}` : ""}
                {item.fileId ? ` · доп. файл #${item.fileId}` : ""}
              </small>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function BroadcastPanel({ onBroadcast }) {
  return (
    <form className="adminTool broadcastForm" onSubmit={onBroadcast}>
      <strong>
        <Megaphone size={16} />
        Рассылка всем пользователям
      </strong>
      <label>
        Заголовок
        <input name="title" required placeholder="Новая подборка проектов" />
      </label>
      <label>
        Сообщение
        <textarea name="message" rows={5} required placeholder="Текст, который уйдет в уведомления и Telegram-бота." />
      </label>
      <button type="submit" className="primary">
        <Send size={16} />
        Отправить рассылку
      </button>
    </form>
  );
}

const requestTypeLabels = {
  source: "Исходник",
  custom: "Доработка",
  subscription: "Подписка",
  vip: "VIP"
};
const requestStatusLabels = {
  new: "Новая",
  in_progress: "В работе",
  done: "Готово",
  rejected: "Отклонена"
};

function AdminMoney({
  promo,
  requests,
  purchases,
  onCreatePromo,
  onDeactivatePromo,
  onRequestStatus,
  onConfirmPurchase,
  onGrant
}) {
  const pendingPurchases = purchases.filter((item) => item.status === "pending");

  return (
    <div className="moneyPanel">
      <form className="adminTool" onSubmit={onGrant}>
        <strong>
          <Crown size={16} />
          Выдать доступ вручную
        </strong>
        <div className="formGrid">
          <input name="telegramId" required placeholder="Telegram ID пользователя" />
          <select name="kind" defaultValue="vip">
            <option value="vip">VIP</option>
            <option value="subscription">Подписка</option>
          </select>
        </div>
        <input name="days" type="number" min="0" placeholder="Дней (0 = бессрочно для VIP)" />
        <button type="submit" className="primary">
          <Gift size={15} />
          Выдать доступ
        </button>
      </form>

      <form className="adminTool" onSubmit={onCreatePromo}>
        <strong>
          <Ticket size={16} />
          Новый промокод
        </strong>
        <div className="formGrid">
          <input name="code" required placeholder="Код, напр. WELCOME" />
          <select name="type" defaultValue="project">
            <option value="project">На проект</option>
            <option value="subscription">Подписка</option>
            <option value="vip">VIP</option>
          </select>
        </div>
        <div className="formGrid">
          <input name="projectId" type="number" min="1" placeholder="ID проекта (для типа «На проект»)" />
          <input name="days" type="number" min="0" placeholder="Дней (подписка/VIP)" />
        </div>
        <div className="formGrid">
          <input name="maxUses" type="number" min="0" placeholder="Лимит активаций (0 = ∞)" />
          <input name="expiresAt" placeholder="Истекает: 2026-12-31" />
        </div>
        <button type="submit" className="primary">
          <Plus size={15} />
          Создать промокод
        </button>
      </form>

      <div className="adminTool">
        <strong>
          <Ticket size={16} />
          Промокоды
        </strong>
        <div className="listPanel adminSimpleList">
          {promo.length ? (
            promo.map((code) => (
              <div className="activityRow" key={code.id}>
                <div>
                  <strong>
                    {code.code}
                    <span className="inlineBadge">{tierLabels[code.type] || code.type}</span>
                    {!code.isActive && <span className="inlineBadge danger">off</span>}
                  </strong>
                  <span>
                    {code.projectTitle ? `${code.projectTitle} · ` : ""}
                    {code.days ? `${code.days} дн. · ` : ""}
                    {code.usedCount}/{code.maxUses || "∞"} активаций
                    {code.expiresAt ? ` · до ${code.expiresAt}` : ""}
                  </span>
                </div>
                {code.isActive && (
                  <div className="rowActions">
                    <button type="button" className="dangerButton" onClick={() => onDeactivatePromo(code)}>
                      <Ban size={15} />
                      Отключить
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="mutedText">Промокодов пока нет.</p>
          )}
        </div>
      </div>

      <div className="adminTool">
        <strong>
          <Wrench size={16} />
          Заявки на разработку и исходники
        </strong>
        <div className="listPanel adminSimpleList">
          {requests.length ? (
            requests.map((request) => (
              <div className="activityRow" key={request.id}>
                <div>
                  <strong>
                    {requestTypeLabels[request.type] || request.type}
                    <span className="inlineBadge">{requestStatusLabels[request.status] || request.status}</span>
                  </strong>
                  <span>
                    {request.userName} · ID {request.telegramId}
                    {request.projectTitle ? ` · ${request.projectTitle}` : ""}
                    {request.budget ? ` · бюджет ${request.budget}` : ""}
                  </span>
                  {request.message && <p>{request.message}</p>}
                  {request.contact && <small>Контакт: {request.contact}</small>}
                </div>
                <div className="rowActions">
                  <button type="button" onClick={() => onRequestStatus(request, "in_progress")}>
                    В работу
                  </button>
                  <button type="button" className="primary" onClick={() => onRequestStatus(request, "done")}>
                    Готово
                  </button>
                  <button type="button" className="dangerButton" onClick={() => onRequestStatus(request, "rejected")}>
                    Отклонить
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="mutedText">Заявок пока нет.</p>
          )}
        </div>
      </div>

      <div className="adminTool">
        <strong>
          <CreditCard size={16} />
          Покупки {pendingPurchases.length ? `· ${pendingPurchases.length} ждут подтверждения` : ""}
        </strong>
        <div className="listPanel adminSimpleList">
          {purchases.length ? (
            purchases.map((purchase) => (
              <div className="activityRow" key={purchase.id}>
                <div>
                  <strong>
                    {purchase.projectTitle}
                    <span className={`inlineBadge ${purchase.status === "pending" ? "danger" : ""}`}>
                      {purchase.status === "pending" ? "ожидает" : "оплачено"}
                    </span>
                  </strong>
                  <span>
                    {purchase.userName} · ID {purchase.telegramId} · {purchase.source}
                    {purchase.promoCode ? ` · ${purchase.promoCode}` : ""} · {formatDate(purchase.createdAt)}
                  </span>
                </div>
                {purchase.status === "pending" && (
                  <div className="rowActions">
                    <button type="button" className="primary" onClick={() => onConfirmPurchase(purchase)}>
                      <CreditCard size={15} />
                      Подтвердить
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="mutedText">Покупок пока нет.</p>
          )}
        </div>
      </div>
    </div>
  );
}
