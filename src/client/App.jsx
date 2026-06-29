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
const collectionPresets = ["Bots", "Parsers", "Automation", "AI"];
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
  draft: "Draft",
  pending: "Pending review",
  published: "Published",
  hidden: "Hidden",
  archived: "Archive"
};
const tierLabels = {
  free: "Free",
  paid: "Paid",
  subscription: "Subscription",
  vip: "VIP"
};
const reportReasonLabels = {
  malware: "Malicious code",
  broken: "Download does not work",
  outdated: "Outdated",
  abuse: "Violation",
  support: "No support",
  author: "Author report",
  other: "Other"
};
const reportStatusLabels = {
  new: "New",
  reviewing: "In review",
  resolved: "Resolved",
  rejected: "Rejected"
};
const scanStatusLabels = {
  clean: "Approved",
  warning: "Warning",
  blocked: "Blocked",
  pending: "Pending review"
};

// Decide what the primary action on a project should be for the current viewer.
function accessState(project, account) {
  const tier = project.accessTier || "free";
  const unlocked =
    tier === "free" ||
    project.owned ||
    account.isVip ||
    (tier === "subscription" && account.isSubscriber);

  if (unlocked) return { unlocked: true, action: "download", label: "Download", tier };
  if (tier === "paid") {
    return {
      unlocked: false,
      action: "purchase",
      label: `Buy · ${formatPrice(project)}`,
      tier
    };
  }
  if (tier === "subscription") {
    return { unlocked: false, action: "subscribe", label: "Unlock with subscription", tier };
  }
  return { unlocked: false, action: "vip", label: "Get VIP access", tier };
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
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value.replace(" ", "T")));
}

function formatPrice(project) {
  if (project.accessTier === "subscription") return "Subscription";
  if (project.accessTier === "vip") return "VIP";
  if (project.isOnSale && project.salePriceCents > 0) return `${project.salePriceCents} Stars · -${project.salePercent}%`;
  return project.priceCents > 0 || project.accessTier === "paid"
    ? `${Math.max(1, Number(project.priceCents) || 0)} Stars`
    : "Free";
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
      { id: "catalog", label: "Catalog" },
      { id: "top", label: "Top" },
      { id: "vip", label: "VIP" },
      { id: "saved", label: "Saved" },
      { id: "account", label: "Account" },
      { id: "history", label: "History" },
      {
        id: "notifications",
        label: unreadCount ? `Notifications ${unreadCount}` : "Notifications"
      }
    ];
    if (user?.isAdmin) tabs.push({ id: "admin", label: "Admin" });
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
          setNotice({ type: "success", text: "Stars payment completed. Access updated." });
        }
      });
      return;
    }
    window.open(invoiceUrl, "_blank", "noopener,noreferrer");
  }

  async function archiveProject(projectId) {
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    setNotice({ type: "success", text: "Project archived." });
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
      setNotice({ type: "success", text: `Saved: ${payload.project.title}` });
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
      setNotice({ type: "success", text: `Version updated: ${payload.project.title}` });
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
      setNotice({ type: "success", text: `Changes saved: ${payload.project.title}` });
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
      setNotice({ type: "success", text: `Status updated: ${statusLabels[status] || status}` });
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
        text: project.pinnedAt ? "Project unpinned." : "Project pinned to the top of the catalog."
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
      setNotice({ type: "success", text: "Files added to the project." });
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
      setNotice({ type: "success", text: "Screenshots updated." });
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
      setNotice({ type: "success", text: "Screenshot deleted." });
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
          ? "Changes were sent for review."
          : "Project updated."
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
          ? "Version uploaded and waiting for review."
          : "Version published."
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
      setNotice({ type: "success", text: "Screenshots updated." });
      await refreshAccountData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deleteOwnerScreenshot(project, screenshot) {
    try {
      await api(`/api/projects/${project.id}/screenshots/${screenshot.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Screenshot deleted." });
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
      setNotice({ type: "success", text: "Badge updated." });
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
      setNotice({ type: "success", text: project.isWeeklyPick ? "Removed from weekly picks." : "Added to weekly picks." });
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
      setNotice({ type: "success", text: "Seasonal sale updated." });
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
      setNotice({ type: "success", text: "Message sent to the author." });
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
      setNotice({ type: "success", text: "File review saved." });
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
      setNotice({ type: "success", text: item.isHidden ? "File shown." : "File hidden." });
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
      setNotice({ type: "success", text: "File deleted." });
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
      setNotice({ type: "success", text: banned ? "User banned." : "User unbanned." });
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
        text: userItem.isVerified ? "Verification removed." : "User verified."
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
      setNotice({ type: "success", text: status === "hidden" ? "Review hidden." : "Review published." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function removeReview(review) {
    try {
      await api(`/api/admin/reviews/${review.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Review deleted." });
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
      setNotice({ type: "success", text: "Report status updated." });
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
        text: `Broadcast created: ${payload.notifications} notifications, Telegram: ${payload.telegramSent} sent.`
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
      setDetailNotice({ type: "success", text: "Review saved." });
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
      setDetailNotice({ type: "success", text: "Report sent." });
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
      setNotice({ type: "success", text: "Author report sent." });
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
          text: `Limit ${account.downloadLimit} downloads for today is exhausted. Subscribe or get VIP for unlimited downloads.`
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
        setDetailNotice({ type: "success", text: "Access unlocked. You can download now." });
        setNotice({ type: "success", text: `Purchased: ${project.title}` });
      } else if (result.status === "invoice" && result.invoiceUrl) {
        openStarsInvoice(result.invoiceUrl);
        setDetailNotice({ type: "success", text: "Opened Telegram Stars checkout." });
      } else if (result.status === "pending") {
        const text = "Purchase request created. We will contact you about payment.";
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
        text: result.status === "active" ? "Subscription activated." : "Opened subscription checkout via Stars."
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
        text: result.status === "active" ? "VIP access activated." : "Opened VIP checkout via Stars."
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
      setNotice({ type: "success", text: "Promo code redeemed." });
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
      const text = "Request sent. We will contact you.";
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
          ? `Project published: ${payload.project.title}.`
          : `Submission sent: ${payload.project.title}. Admin will review and publish the project.`
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
      setNotice({ type: "success", text: "Promo code created." });
      await refreshAdminData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function deactivatePromo(code) {
    try {
      await api(`/api/admin/promo/${code.id}`, { method: "DELETE" });
      setNotice({ type: "success", text: "Promo code disabled." });
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
      setNotice({ type: "success", text: "Purchase confirmed." });
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
      setNotice({ type: "success", text: "Access granted to user." });
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
            The WebApp should be opened from the Telegram bot. For local mode,
            check `ALLOW_DEV_AUTH=true`.
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
            <small>~/projects · scripts · source</small>
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
            {user.firstName || user.username || "Account"}
          </span>
        </div>
      </header>

      <section className="statsStrip" aria-label="Statistics">
        <Stat label="projects" value={stats.projects} />
        <Stat label="users" value={stats.users} />
        <Stat label="downloads" value={stats.downloads} />
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

      <nav className="tabs" aria-label="Sections" ref={tabsRef}>
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
            placeholder="Search projects, languages, tags"
          />
        </div>
        <button
          type="button"
          className={`filterToggle ${open || activeCount ? "active" : ""}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <ListFilter size={16} />
          Filters
          {activeCount > 0 && <span className="filterCount">{activeCount}</span>}
        </button>
      </div>

      {open && (
        <div className="filterBody">
          <div className="controls">
            <select value={language} onChange={(event) => onLanguage(event.target.value)}>
          <option value="">All languages</option>
          {filterOptions.languages.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select value={category} onChange={(event) => onCategory(event.target.value)}>
          <option value="">All categories</option>
          {filterOptions.categories.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>

        <select value={price} onChange={(event) => onPrice(event.target.value)}>
          <option value="">Any price</option>
          <option value="free">Free</option>
          <option value="paid">Paid</option>
        </select>

        <select value={license} onChange={(event) => onLicense(event.target.value)}>
          <option value="">Any license</option>
          <option value="free">Free</option>
          <option value="personal">Personal</option>
          <option value="commercial">Commercial</option>
        </select>

        <select value={date} onChange={(event) => onDate(event.target.value)}>
          <option value="">Any date</option>
          <option value="today">Today</option>
          <option value="week">7 days</option>
          <option value="month">30 days</option>
          <option value="year">Year</option>
        </select>

        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          <option value="new">Newest</option>
          <option value="updated">Updated</option>
          <option value="popular">Popular</option>
          <option value="rating">By rating</option>
          <option value="price">By price</option>
        </select>
      </div>

      <div className="quickFilters">
        <span>
          <FolderKanban size={15} />
          Collections
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
          Filters
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
          Reset
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
              ? "No saved projects yet"
              : activeTab === "top"
                ? "Top is empty"
                : activeTab === "vip"
                  ? "No VIP projects yet"
                  : "Catalog is empty"}
          </h2>
          <p>
            {activeTab === "saved"
              ? "Save useful projects so you can return to them quickly."
              : activeTab === "top"
                ? "Popular projects will appear after views and downloads."
                : activeTab === "vip"
                  ? "Exclusive projects will appear here. Get VIP access in advance."
                  : "Add the first publication in the admin tab."}
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
          {account.isVip ? "VIP active" : "Paid VIP section"}
        </strong>
        <p>
          {account.isVip
            ? account.vipUntil
              ? `Access is active until ${formatDate(account.vipUntil)}.`
              : "Unlimited access to every catalog project."
            : "Exclusive projects and unlimited downloads. Access to the full catalog."}
        </p>
      </div>
      {!account.isVip && (
        <button type="button" className="primary" onClick={onVip}>
          <Crown size={16} />
          {account.vipPriceLabel ? `VIP · ${account.vipPriceLabel}` : "Get VIP"}
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
      {owned ? "Owned" : tierLabels[tier] || tier}
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
        aria-label={project.isFavorite ? "Remove from saved" : "Save"}
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

        <p>{project.summary || project.description || "Description will be added later."}</p>

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
            Details
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
        <h2>History is empty</h2>
        <p>Downloaded projects will appear here.</p>
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
              Details
            </button>
            <button type="button" className="primary" onClick={() => onDownload(item.project, item.versionId, item.fileId)}>
              <Download size={16} />
              Download
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
        <h2>No notifications</h2>
        <p>New versions of saved projects will appear here.</p>
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
                  Mark read
                </button>
              )}
              {project && (
                <button type="button" className="primary" onClick={() => onOpen(project)}>
                  <ExternalLink size={16} />
                  Open
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
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">
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
          <Meta icon={<Code2 size={16} />} label={project.languages.join(", ") || "No language specified"} />
          <Meta icon={<Tags size={16} />} label={project.tags.join(", ") || "No tags"} />
          <Meta icon={<FolderKanban size={16} />} label={project.collections.join(", ") || "No collection"} />
          <Meta icon={<BookOpen size={16} />} label={project.categories.join(", ") || "No category"} />
          <Meta icon={<CalendarDays size={16} />} label={formatDate(project.createdAt)} />
          {project.fileName && (
            <Meta icon={<Download size={16} />} label={`${project.fileName} ${formatBytes(project.fileSize)}`} />
          )}
        </div>

        {notice.text && <p className={`notice ${notice.type}`}>{notice.text}</p>}

        <section className="detailSection">
          <h3>Description</h3>
          <p className="description">{project.description || project.summary}</p>
        </section>

        <InfoGrid project={project} />

        <section className="detailSection">
          <h3>Installation guide</h3>
          <pre className="codeBlock">{project.installation || "Installation guide has not been added yet."}</pre>
        </section>

        <section className="detailSection">
          <h3>Run examples</h3>
          <pre className="codeBlock">{project.runExamples || "Run examples have not been added yet."}</pre>
        </section>

        <section className="detailSection">
          <h3>Code preview</h3>
          <pre className="codeBlock">{project.codePreview || "Snippet has not been added yet."}</pre>
        </section>

        <section className="detailSection">
          <h3>File versions</h3>
          <VersionList project={project} onPrimary={onPrimary} />
        </section>

        <section className="detailSection">
          <h3>Additional files</h3>
          <FileList project={project} onPrimary={onPrimary} />
        </section>

        <section className="detailSection">
          <h3>Changelog</h3>
          <p className="description">{project.changelog || "No changes have been added yet."}</p>
        </section>

        <ProjectLinks project={project} />

        {!state.unlocked && (
          <div className={`accessCta tier-${state.tier}`}>
            {state.tier === "vip" ? <Crown size={18} /> : state.tier === "subscription" ? <Rocket size={18} /> : <Lock size={18} />}
            <div>
              <strong>
                {state.tier === "paid"
                  ? "Paid source"
                  : state.tier === "subscription"
                    ? "Subscription access"
                    : "VIP only"}
              </strong>
              <p>
                {state.tier === "paid"
                  ? `Buy the source for ${formatPrice(project)}, to download the files.`
                  : state.tier === "subscription"
                    ? "Subscribe to unlock this project and the whole section."
                    : "This project is available in the VIP section with unlimited downloads."}
              </p>
            </div>
          </div>
        )}

        <div className="drawerActions">
          <button type="button" onClick={() => onFavorite(project)}>
            <Star size={17} fill="currentColor" />
            {project.isFavorite ? "Saved" : "Save"}
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
            {state.unlocked ? "Download latest" : state.label}
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
          <h3>Order customization</h3>
          <form className="inlineForm" onSubmit={(event) => onRequest(event, project.id)}>
            <input type="hidden" name="type" value="custom" />
            <textarea name="message" rows={3} required placeholder="Describe what should be improved or customized in this project" />
            <input name="budget" placeholder="Budget, e.g. 1500 Stars" />
            <input name="contact" placeholder="Contact (@username, email)" />
            <button type="submit" className="primary">
              <Wrench size={16} />
              Send request
            </button>
          </form>
        </section>

        <section className="detailSection">
          <h3>Reviews</h3>
          <ReviewForm project={project} onReview={onReview} />
          <div className="reviews">
            {project.reviews.length ? (
              project.reviews.map((review) => <ReviewItem review={review} key={review.id} />)
            ) : (
              <p className="mutedText">No reviews yet.</p>
            )}
          </div>
        </section>

        <section className="detailSection">
          <h3>README.md preview</h3>
          <pre className="codeBlock">{project.readmePreview || "README will be assembled automatically from description, installation and requirements."}</pre>
        </section>

        <section className="detailSection">
          <h3>Report a problem</h3>
          <ReportForm project={project} onReport={onReport} />
        </section>
      </aside>
    </div>
  );
}

function VerifiedBadge({ verified }) {
  if (!verified) return null;
  return (
    <span className="verifiedBadge" title="Profile verified by admin">
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
        <span className="verifiedBadge trustedBadge" title="Author is trusted for auto-publication">
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
        <span>{username ? `@${username}` : "Author has no public username"}</span>
      </div>
      {username && (
        <button type="button" onClick={() => onOpen?.(username)}>
          <User size={16} />
          Profile
        </button>
      )}
    </section>
  );
}

function PublicSharePanel({ project, creator }) {
  const links = [
    { label: "Project", url: publicProjectLink(project.slug) },
    creator?.username ? { label: "Author", url: publicUserLink(creator.username) } : null
  ].filter((item) => item?.url);

  if (!links.length) return null;

  return (
    <section className="sharePanel">
      {links.map((item) => (
        <label key={item.label}>
          {item.label}
          <span>
            <input readOnly value={item.url} onFocus={(event) => event.currentTarget.select()} />
            <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open link: ${item.label}`}>
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
    `Price: ${formatPrice(project)}`,
    link
  ].filter(Boolean).join("\n");

  return (
    <section className="telegramShareCard">
      <div>
        <strong>
          <Send size={16} />
          Telegram share card
        </strong>
        <p>{project.summary || "Ready-to-share project card for Telegram."}</p>
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
              <p>{profile.username ? `@${profile.username}` : "Public username is not set"}</p>
            </div>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="profileStats">
          <span>
            <FolderKanban size={15} />
            <strong>{profile.stats?.projects || 0}</strong>
            projects
          </span>
          <span>
            <Download size={15} />
            <strong>{profile.stats?.downloads || 0}</strong>
            downloads
          </span>
          <span>
            <Star size={15} fill="currentColor" />
            <strong>{profile.stats?.favorites || 0}</strong>
            favorites
          </span>
          <span>
            <MessageSquare size={15} />
            <strong>{profile.stats?.reviews || 0}</strong>
            reviews
          </span>
        </div>

        {publicLink && (
          <section className="sharePanel single">
            <label>
              Public link
              <span>
                <input readOnly value={publicLink} onFocus={(event) => event.currentTarget.select()} />
                <a href={publicLink} target="_blank" rel="noreferrer" aria-label="Open public profile">
                  <ExternalLink size={16} />
                </a>
              </span>
            </label>
          </section>
        )}

        <section className="detailSection">
          <h3>Author projects</h3>
          {profile.projects?.length ? (
            <div className="versionList">
              {profile.projects.map((project) => (
                <div className="versionItem" key={project.id}>
                  <div>
                    <strong>{project.title}</strong>
                    <span>
                      {project.version || "latest"} · {formatPrice(project)} · {project.downloadCount || 0} downloads
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
                    Open
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mutedText">This author has no published projects yet.</p>
          )}
        </section>

        <section className="detailSection">
          <h3>Author report</h3>
          <form className="inlineForm" onSubmit={(event) => onReportAuthor(profile, event)}>
            <select name="reason" defaultValue="abuse">
              <option value="abuse">Violation / fraud</option>
              <option value="malware">Suspected malicious code</option>
              <option value="support">No support after purchase</option>
              <option value="other">Other</option>
            </select>
            <textarea name="details" rows={3} placeholder="Describe the issue" />
            <button type="submit">
              <Flag size={16} />
              Send report
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function InfoGrid({ project }) {
  return (
    <section className="infoGrid" aria-label="Project requirements">
      <InfoItem icon={<Monitor size={16} />} label="OS" value={project.osSupport || "Not specified"} />
      <InfoItem icon={<Terminal size={16} />} label="Node.js" value={project.nodeVersion || "Not required"} />
      <InfoItem icon={<Terminal size={16} />} label="Python" value={project.pythonVersion || "Not required"} />
      <InfoItem icon={<Scale size={16} />} label="License" value={licenseLabels[project.licenseType] || project.licenseType} />
      <InfoItem icon={<FileCode2 size={16} />} label="Requirements" value={project.requirements || "Not specified"} wide />
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
    return <p className="mutedText">No versions have been added yet.</p>;
  }

  return (
    <div className="versionList">
      {project.versions.map((version) => (
        <div className="versionItem" key={version.id}>
          <div>
            <strong>{version.version || "No version number"}</strong>
            <span>
              {formatDate(version.createdAt)} · {version.downloadCount} downloads
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
              Download
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FileList({ project, onPrimary }) {
  if (!project.files?.length) {
    return <p className="mutedText">No additional files have been added yet.</p>;
  }

  return (
    <div className="versionList">
      {project.files.map((file) => (
        <div className="versionItem" key={file.id}>
          <div>
            <strong>{file.fileName || "File"}</strong>
            <span>
              {formatDate(file.createdAt)} · {file.downloadCount || 0} downloads
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
              Download
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
    { label: "Docs", url: project.docsUrl, icon: <BookOpen size={17} /> },
    { label: "Video", url: project.videoUrl, icon: <Video size={17} /> }
  ].filter((item) => item.url);

  if (!links.length) return null;

  return (
    <section className="detailSection">
      <h3>Links</h3>
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
        <option value="5">5 stars</option>
        <option value="4">4 stars</option>
        <option value="3">3 stars</option>
        <option value="2">2 stars</option>
        <option value="1">1 star</option>
      </select>
      <textarea name="comment" rows={3} placeholder="Comment" />
      <button type="submit" className="primary">
        <MessageSquare size={16} />
        Send review
      </button>
    </form>
  );
}

function ReportForm({ project, onReport }) {
  return (
    <form className="inlineForm" onSubmit={(event) => onReport(project, event)}>
      <select name="reason" defaultValue="download">
        <option value="download">Download does not work</option>
        <option value="malware">Suspicious file</option>
        <option value="description">Incorrect description</option>
        <option value="other">Other</option>
      </select>
      <textarea name="details" rows={3} placeholder="Details" />
      <button type="submit">
        <Flag size={16} />
        Send report
      </button>
    </form>
  );
}

function ReviewItem({ review }) {
  const author =
    review.author.firstName ||
    review.author.username ||
    "User";

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
      Signature
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
              {user?.username ? `@${user.username}` : "Add a Telegram username to get a public page."}
            </p>
            {publicLink && (
              <label className="publicLinkField">
                Public link
                <span>
                  <input readOnly value={publicLink} onFocus={(event) => event.currentTarget.select()} />
                  <a href={publicLink} target="_blank" rel="noreferrer" aria-label="Open public profile">
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
            <h2>My access</h2>
          </div>
          <div className="statusGrid">
            <div className={`statusTile ${account.isVip ? "active" : ""}`}>
              <span><Crown size={14} /> VIP</span>
              <strong>
                {account.isVip
                  ? account.vipUntil
                    ? `until ${formatDate(account.vipUntil)}`
                    : "active"
                  : "none"}
              </strong>
            </div>
            <div className={`statusTile ${account.isSubscriber ? "active" : ""}`}>
              <span><Rocket size={14} /> Subscription</span>
              <strong>
                {account.isSubscriber && account.subscriptionUntil
                  ? `until ${formatDate(account.subscriptionUntil)}`
                  : account.isSubscriber
                    ? "active"
                    : "none"}
              </strong>
            </div>
            <div className="statusTile">
              <span><Download size={14} /> Daily limit</span>
              <strong>
                {account.unlimited
                  ? "unlimited"
                  : `${account.remaining ?? 0} of ${account.downloadLimit}`}
              </strong>
            </div>
          </div>
        </div>

        <form className="statusCard" onSubmit={onRedeem}>
          <div className="sectionTitle">
            <Ticket size={19} />
            <h2>Promo code</h2>
          </div>
          <div className="promoRow">
            <input name="code" required placeholder="Enter promo code" />
            <button type="submit" className="primary">
              <Gift size={16} />
              Redeem
            </button>
          </div>
          <p className="mutedText">A promo code can unlock a project, subscription or VIP access.</p>
        </form>

        <div className="statusCard">
          <div className="sectionTitle">
            <ShoppingBag size={19} />
            <h2>Purchased projects</h2>
          </div>
          {purchases.length ? (
            <div className="versionList purchaseList">
              {purchases.map((purchase) => (
                <div className="versionItem purchaseItem" key={purchase.id}>
                  <div>
                    <strong>{purchase.project?.title || "Project"}</strong>
                    <span>
                      {purchase.amountStars || 0} Stars · {purchase.status === "paid" ? "paid" : purchase.status} · {formatDate(purchase.createdAt)}
                    </span>
                    <p>{purchase.project?.summary || "Access is saved in the account. Re-downloading does not require another payment."}</p>
                  </div>
                  {purchase.project?.slug && (
                    <button type="button" onClick={() => onOpenProject?.(purchase.project)}>
                      <Download size={16} />
                      Open
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mutedText">No purchases yet. After payment, the project will stay here and remain downloadable without another payment.</p>
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
            <h2>Subscription</h2>
          </div>
          <p>Unlimited downloads and access to subscription projects.</p>
          <div className="planPrice">{account.subscriptionPriceLabel || "on request"}</div>
          <button type="button" className="primary" onClick={onSubscribe} disabled={account.isSubscriber}>
            <Rocket size={16} />
            {account.isSubscriber ? "Subscription active" : "Subscribe"}
          </button>
        </div>

        <div className="planCard vipPlan">
          <div className="sectionTitle">
            <Crown size={19} />
            <h2>VIP</h2>
          </div>
          <p>The full catalog without limits, VIP section and priority support.</p>
          <div className="planPrice">{account.vipPriceLabel || "on request"}</div>
          <button type="button" className="primary" onClick={onVip} disabled={account.isVip}>
            <Crown size={16} />
            {account.isVip ? "VIP active" : "Get VIP"}
          </button>
        </div>

        <form className="statusCard" onSubmit={(event) => onRequest(event)}>
          <div className="sectionTitle">
            <Wrench size={19} />
            <h2>Order development</h2>
          </div>
          <label>
            What you need
            <select name="type" defaultValue="custom">
              <option value="custom">Customization / custom project</option>
              <option value="source">Buy source code for a task</option>
            </select>
          </label>
          <textarea name="message" rows={4} required placeholder="Describe the task: scope, timeline, details" />
          <div className="formGrid">
            <input name="budget" placeholder="Budget" />
            <input name="contact" placeholder="Contact (@username)" />
          </div>
          <button type="submit" className="primary">
            <Send size={16} />
            Send request
          </button>
        </form>

        <form className="statusCard submissionForm" onSubmit={onProjectSubmit}>
          <div className="sectionTitle">
            <FolderKanban size={19} />
            <h2>Submit your project</h2>
          </div>
          <p className="mutedText">The project will be sent to admin review. After publication, it will appear in the catalog and author profile.</p>
          <label>
            Title
            <input name="title" required minLength={2} placeholder="Telegram parser kit" />
          </label>
          <label>
            Link slug
            <input name="slug" placeholder="telegram-parser-kit" />
          </label>
          <label>
            Short description
            <input name="summary" required placeholder="What the project does in one line" />
          </label>
          <label>
            Full description
            <textarea name="description" rows={4} placeholder="Features, installation, dependencies, examples" />
          </label>
          <div className="formGrid">
            <label>
              Access type
              <select name="accessTier" defaultValue="free">
                <option value="free">Free</option>
                <option value="paid">Paid source</option>
                <option value="subscription">Subscription</option>
                <option value="vip">VIP</option>
              </select>
            </label>
            <label>
              Price in Stars
              <input name="priceCents" type="number" min="0" step="1" placeholder="0" />
            </label>
          </div>
          <div className="formGrid">
            <input name="languages" placeholder="Python, Node.js, PHP" />
            <input name="tags" placeholder="bot, parser, api" />
          </div>
          <label>
            Installation guide
            <textarea name="installation" rows={3} placeholder="npm install&#10;npm run start" />
          </label>
          <div className="uploadGrid">
            <label className="uploadBox">
              <Upload size={18} />
              Project archive
              <input name="package" type="file" />
            </label>
            <label className="uploadBox">
              <ImageIcon size={18} />
              Screenshots
              <input name="screenshots" type="file" accept="image/*" multiple />
            </label>
            <label className="uploadBox">
              <Link2 size={18} />
              Extra files
              <input name="files" type="file" multiple />
            </label>
          </div>
          <button type="submit" className="primary">
            <Send size={16} />
            Send for review
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
        <h2>My projects</h2>
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
                    Open
                  </button>
                )}
              </div>

              <form className="versionForm editProjectForm" onSubmit={(event) => onProjectEdit(project, event)}>
                <label>
                  Title
                  <input name="title" required minLength={2} defaultValue={project.title} />
                </label>
                <label>
                  Slug
                  <input name="slug" defaultValue={project.slug} />
                </label>
                <label className="wide">
                  Summary
                  <input name="summary" defaultValue={project.summary} />
                </label>
                <label className="wide">
                  Description
                  <textarea name="description" rows={3} defaultValue={project.description} />
                </label>
                <label className="wide">
                  Installation
                  <textarea name="installation" rows={3} defaultValue={project.installation} />
                </label>
                <label>
                  Price in Telegram Stars
                  <input name="priceCents" type="number" min="0" step="1" defaultValue={project.priceCents || 0} />
                </label>
                <label>
                  Access type
                  <select name="accessTier" defaultValue={project.accessTier || "free"}>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                    <option value="subscription">Subscription</option>
                    <option value="vip">VIP</option>
                  </select>
                </label>
                <label>
                  Languages
                  <input name="languages" defaultValue={listValue(project.languages)} />
                </label>
                <label>
                  Tags
                  <input name="tags" defaultValue={listValue(project.tags)} />
                </label>
                <button type="submit" className="primary wide">
                  <Save size={15} />
                  Save changes
                </button>
              </form>

              <form className="versionForm" onSubmit={(event) => onProjectVersion(project, event)}>
                <input name="version" placeholder="v1.1.0" />
                <textarea name="changelog" rows={2} placeholder="What changed" />
                <input name="package" type="file" />
                <button type="submit" className="primary">
                  <Upload size={15} />
                  Upload version
                </button>
              </form>

              <div className="screenshotAdminGrid">
                {project.screenshots?.length ? (
                  project.screenshots.map((shot) => (
                    <div className="screenshotAdminItem" key={shot.id}>
                      <img src={shot.url} alt="" />
                      <button type="button" onClick={() => onDeleteScreenshot(project, shot)} aria-label="Delete screenshot">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="mutedText">No screenshots yet</span>
                )}
              </div>
              <form className="versionForm" onSubmit={(event) => onProjectScreenshots(project, event)}>
                <input name="screenshots" type="file" accept="image/*" multiple />
                <button type="submit">
                  <ImageIcon size={15} />
                  Add screenshots
                </button>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <p className="mutedText">After your first submission, the project will appear here. Verified authors publish automatically.</p>
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
          <h2>New project</h2>
        </div>

        {notice.text && <p className={`notice ${notice.type}`}>{notice.text}</p>}

        <div className="formGrid">
          <label>
            Status
            <select name="status" defaultValue="draft">
              <option value="draft">Draft</option>
              <option value="pending">Pending review</option>
              <option value="published">Publish now</option>
              <option value="hidden">Hidden project</option>
            </select>
          </label>
          <label>
            Access type
            <select name="accessTier" defaultValue="free">
              <option value="free">Free</option>
              <option value="paid">Paid source</option>
              <option value="subscription">Subscription</option>
              <option value="vip">VIP section</option>
            </select>
          </label>
        </div>

        <label>
          Title
          <input name="title" required minLength={2} placeholder="Telegram parser kit" />
        </label>

        <label>
          Short description
          <input name="summary" placeholder="What the project does in one line" />
        </label>

        <label>
          Full description
          <textarea name="description" rows={5} placeholder="Features, installation, dependencies, examples" />
        </label>

        <label>
          Installation guide
          <textarea name="installation" rows={4} placeholder="npm install&#10;cp .env.example .env&#10;npm run start" />
        </label>

        <label>
          Requirements and dependencies
          <textarea name="requirements" rows={4} placeholder="PostgreSQL/SQLite, Redis, FFmpeg, API keys..." />
        </label>

        <div className="formGrid">
          <label>
            OS
            <input name="osSupport" placeholder="Linux VPS, Ubuntu 22.04, Windows" />
          </label>
          <label>
            License
            <select name="licenseType" defaultValue="free">
              <option value="free">Free</option>
              <option value="personal">Personal</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
        </div>

        <div className="formGrid">
          <label>
            Node.js version
            <input name="nodeVersion" placeholder=">=20, >=24, not required" />
          </label>
          <label>
            Python version
            <input name="pythonVersion" placeholder=">=3.11, not required" />
          </label>
        </div>

        <label>
          Run examples
          <textarea name="runExamples" rows={4} placeholder="node index.js&#10;python main.py --config config.yml" />
        </label>

        <label>
          Code preview or demo snippet
          <textarea name="codePreview" rows={6} placeholder="const bot = new Telegraf(process.env.BOT_TOKEN);" />
        </label>

        <label>
          First version changelog
          <textarea name="changelog" rows={4} placeholder="v1.0.0: first release, additions and fixes" />
        </label>

        <div className="formGrid">
          <label>
            Languages
            <input name="languages" placeholder="Node.js, Python, Bash" />
          </label>
          <label>
            Tags
            <input name="tags" placeholder="bot, parser, api" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Collections
            <input name="collections" placeholder="Bots, Parsers, AI" />
          </label>
          <label>
            Categories
            <input name="categories" placeholder="Backend, CLI, SaaS, Automation" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Price in Telegram Stars
            <input name="priceCents" type="number" min="0" step="1" placeholder="0" />
          </label>
        </div>

        <div className="formGrid">
          <label>
            Version
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
            Docs
            <input name="docsUrl" type="url" placeholder="https://docs.example.com" />
          </label>
          <label>
            Video
            <input name="videoUrl" type="url" placeholder="https://youtube.com/..." />
          </label>
        </div>

        <div className="uploadGrid">
          <label className="uploadBox">
            <Upload size={19} />
            Version file
            <input name="package" type="file" />
          </label>
          <label className="uploadBox">
            <ImageIcon size={19} />
            Screenshots
            <input name="screenshots" type="file" accept="image/*" multiple />
          </label>
          <label className="uploadBox">
            <Link2 size={19} />
            Extra files
            <input name="files" type="file" multiple />
          </label>
        </div>
        <p className="mutedText uploadLimitText">
          Upload limit: up to {limits?.maxUploadMb || 100} MB per file. Archives receive SHA-256 and a signature automatically.
        </p>

        <button type="submit" className="submitButton">
          <Save size={18} />
          Save project
        </button>
      </form>

      <div className="adminList">
        <div className="sectionTitle">
          <BarChart3 size={19} />
          <h2>Management</h2>
        </div>

        <div className="adminTabs">
          <button type="button" className={mode === "projects" ? "active" : ""} onClick={() => onMode("projects")}>
            <FolderKanban size={16} />
            Projects
          </button>
          <button type="button" className={mode === "users" ? "active" : ""} onClick={() => onMode("users")}>
            <Users size={16} />
            Users
          </button>
          <button type="button" className={mode === "reviews" ? "active" : ""} onClick={() => onMode("reviews")}>
            <MessageSquare size={16} />
            Reviews
          </button>
          <button type="button" className={mode === "reports" ? "active" : ""} onClick={() => onMode("reports")}>
            <Flag size={16} />
            Reports
          </button>
          <button type="button" className={mode === "downloads" ? "active" : ""} onClick={() => onMode("downloads")}>
            <Download size={16} />
            Logs
          </button>
          <button type="button" className={mode === "broadcast" ? "active" : ""} onClick={() => onMode("broadcast")}>
            <Megaphone size={16} />
            Broadcast
          </button>
          <button type="button" className={mode === "money" ? "active" : ""} onClick={() => onMode("money")}>
            <CreditCard size={16} />
            Monetization
          </button>
        </div>

        <div className="adminStats">
          <span>
            <Eye size={15} />
            {totalViews} views
          </span>
          <span>
            <Download size={15} />
            {totalDownloads} downloads
          </span>
          <span>
            <Star size={15} />
            {totalFavorites} favorites
          </span>
          <span>
            <Ban size={15} />
            {bannedUsers} bans
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
            <h2>No projects yet</h2>
            <p>Create the first draft on the left.</p>
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
            {project.viewCount || 0} views
          </span>
          <span>
            <Download size={14} />
            {project.downloadCount || 0} downloads
          </span>
          <span>
            <Star size={14} />
            {project.favoriteCount || 0} favorites
          </span>
          <span>
            <MessageSquare size={14} />
            {project.reviewCount || 0} reviews
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
            Moderation and storefront
          </strong>
          <form className="versionForm" onSubmit={(event) => onSale(project, event)}>
            <input name="percent" type="number" min="0" max="95" step="1" defaultValue={project.salePercent || 0} placeholder="Discount %" />
            <input name="endsAt" type="datetime-local" defaultValue={project.saleEndsAt ? project.saleEndsAt.slice(0, 16).replace(" ", "T") : ""} />
            <button type="submit">
              <BadgeDollarSign size={15} />
              Stars sale
            </button>
          </form>
          <form className="versionForm" onSubmit={(event) => onSendAuthorMessage(project, event)}>
            <input name="title" placeholder="Author message subject" defaultValue="Project changes required" />
            <textarea name="message" rows={2} required placeholder="What needs to be fixed or clarified" />
            <button type="submit">
              <Send size={15} />
              Message author
            </button>
          </form>
        </div>

        <form className="versionForm editProjectForm" onSubmit={(event) => onEdit(project, event)}>
          <label>
            Title
            <input name="title" required minLength={2} defaultValue={project.title} />
          </label>
          <label>
            Status
            <select name="status" defaultValue={project.status}>
              <option value="draft">Draft</option>
              <option value="pending">Pending review</option>
              <option value="published">Published</option>
              <option value="hidden">Hidden</option>
              <option value="archived">Archive</option>
            </select>
          </label>
          <label>
            Summary
            <input name="summary" defaultValue={project.summary} />
          </label>
          <label>
            Version
            <input name="version" defaultValue={project.version} placeholder="v1.1.0" />
          </label>
          <label className="wide">
            Description
            <textarea name="description" rows={3} defaultValue={project.description} />
          </label>
          <label className="wide">
            Installation
            <textarea name="installation" rows={3} defaultValue={project.installation} />
          </label>
          <label>
            Languages
            <input name="languages" defaultValue={listValue(project.languages)} />
          </label>
          <label>
            Tags
            <input name="tags" defaultValue={listValue(project.tags)} />
          </label>
          <label>
            Collections
            <input name="collections" defaultValue={listValue(project.collections)} />
          </label>
          <label>
            Categories
            <input name="categories" defaultValue={listValue(project.categories)} />
          </label>
          <label>
            Price in Telegram Stars
            <input name="priceCents" type="number" min="0" step="1" defaultValue={project.priceCents || 0} />
          </label>
          <label>
            License
            <select name="licenseType" defaultValue={project.licenseType}>
              <option value="free">Free</option>
              <option value="personal">Personal</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
          <label>
            Access type
            <select name="accessTier" defaultValue={project.accessTier || "free"}>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
              <option value="subscription">Subscription</option>
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
            Docs
            <input name="docsUrl" type="url" defaultValue={project.docsUrl} />
          </label>
          <label>
            Video
            <input name="videoUrl" type="url" defaultValue={project.videoUrl} />
          </label>
          <label className="wide">
            Changelog
            <textarea name="changelog" rows={3} defaultValue={project.changelog} />
          </label>
          <label className="wide">
            Requirements
            <textarea name="requirements" rows={3} defaultValue={project.requirements} />
          </label>
          <label>
            OS
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
            Run examples
            <textarea name="runExamples" rows={3} defaultValue={project.runExamples} />
          </label>
          <label className="wide">
            Code preview
            <textarea name="codePreview" rows={4} defaultValue={project.codePreview} />
          </label>
          <label className="uploadBox wide">
            <Upload size={17} />
            Replace latest file
            <input name="package" type="file" />
          </label>
          <button type="submit" className="primary wide">
            <Save size={15} />
            Save changes
          </button>
        </form>

        <div className="adminTool">
          <strong>
            <Send size={15} />
            Versions
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
              <span>No versions added</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onVersion(project, event)}>
            <input name="version" placeholder="v1.1.0" />
            <textarea name="changelog" rows={2} placeholder="Changelog for this version" />
            <input name="package" type="file" />
            <button type="submit" className="primary">
              <Send size={15} />
              Add version
            </button>
          </form>
        </div>

        <div className="adminTool">
          <strong>
            <Link2 size={15} />
            Additional files
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
              <span>No files added</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onFiles(project, event)}>
            <input name="files" type="file" multiple />
            <button type="submit">
              <Upload size={15} />
              Upload files
            </button>
          </form>
        </div>

        <div className="adminTool">
          <strong>
            <ImageIcon size={15} />
            Screenshots
          </strong>
          <div className="screenshotAdminGrid">
            {project.screenshots?.length ? (
              project.screenshots.map((shot) => (
                <div className="screenshotAdminItem" key={shot.id}>
                  <img src={shot.url} alt="" />
                  <button type="button" onClick={() => onDeleteScreenshot(project, shot)} aria-label="Delete screenshot">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <span className="mutedText">No screenshots yet</span>
            )}
          </div>
          <form className="versionForm" onSubmit={(event) => onScreenshots(project, event)}>
            <input name="screenshots" type="file" accept="image/*" multiple />
            <button type="submit">
              <ImageIcon size={15} />
              Add screenshots
            </button>
          </form>
        </div>
      </div>

      <div className="adminSideActions">
        <button type="button" className="primary" onClick={() => onStatus(project, "published")}>
          <Eye size={16} />
          Publish
        </button>
        <button type="button" onClick={() => onStatus(project, "draft")}>
          <Edit3 size={16} />
          Move to draft
        </button>
        <button type="button" onClick={() => onStatus(project, "hidden")}>
          <EyeOff size={16} />
          Hide
        </button>
        <button type="button" onClick={() => onPin(project)}>
          <Pin size={16} />
          {project.pinnedAt ? "Unpin" : "Pin"}
        </button>
        <button type="button" onClick={() => onWeekly(project)}>
          <Star size={16} />
          {project.isWeeklyPick ? "Remove weekly" : "Add weekly"}
        </button>
        <button type="button" className="dangerButton" onClick={() => onArchive(project.id)}>
          <Archive size={16} />
          Archive
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
          {kind === "version" ? item.version || "Version" : item.fileName || "File"}
          <span className={`inlineBadge ${item.reviewStatus === "rejected" ? "danger" : ""}`}>
            {item.reviewStatus || "pending"}
          </span>
          {item.isHidden && <span className="inlineBadge danger">hidden</span>}
        </strong>
        <span>
          {formatDate(item.createdAt)} · {formatBytes(item.fileSize)} · {item.downloadCount || 0} downloads
        </span>
        <div className="fileMetaLine">
          <ScanBadge status={item.scanStatus} notes={item.scanNotes} />
          <SignatureLink url={item.signatureUrl} />
          {item.fileSha256 && <small>SHA-256: {item.fileSha256.slice(0, 18)}...</small>}
        </div>
      </div>
      <form className="reviewChecklist" onSubmit={(event) => onReviewUpload(project, item, kind, event)}>
        <select name="status" defaultValue={item.reviewStatus || "pending"}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="changes">Changes needed</option>
          <option value="rejected">Rejected</option>
        </select>
        <label><input name="opens" type="checkbox" defaultChecked={Boolean(checklist.opens)} /> archive</label>
        <label><input name="readme" type="checkbox" defaultChecked={Boolean(checklist.readme)} /> README</label>
        <label><input name="license" type="checkbox" defaultChecked={Boolean(checklist.license)} /> license</label>
        <label><input name="noSecrets" type="checkbox" defaultChecked={Boolean(checklist.noSecrets)} /> no secrets</label>
        <label><input name="dependencies" type="checkbox" defaultChecked={Boolean(checklist.dependencies)} /> deps</label>
        <textarea name="notes" rows={2} defaultValue={item.reviewNotes || ""} placeholder="Review notes" />
        <button type="submit" className="primary">
          <ShieldCheck size={14} />
          Save review
        </button>
      </form>
      <div className="rowActions">
        <button type="button" onClick={() => onToggleUploadHidden(project, item, kind)}>
          {item.isHidden ? <Eye size={15} /> : <EyeOff size={15} />}
          {item.isHidden ? "Show" : "Hide"}
        </button>
        <button type="button" className="dangerButton" onClick={() => onDeleteUpload(project, item, kind)}>
          <Trash2 size={15} />
          Delete
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
        <h2>No users yet</h2>
        <p>They will appear after opening the WebApp.</p>
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
              ID {userItem.telegramId} · {userItem.projectCount || 0} projects · {userItem.downloadCount} downloads · {userItem.favoriteCount} favorites · {userItem.reviewCount} reviews
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
              {userItem.isVerified ? "Remove verification" : "Verify"}
            </button>
            <button type="button" className={userItem.isTrusted ? "primary" : ""} onClick={() => onToggleUserBadge(userItem, "trusted")}>
              <ShieldCheck size={15} />
              {userItem.isTrusted ? "Trusted" : "Grant trusted"}
            </button>
            <button type="button" className={userItem.isTopSeller ? "primary" : ""} onClick={() => onToggleUserBadge(userItem, "topSeller")}>
              <BadgeDollarSign size={15} />
              {userItem.isTopSeller ? "Top seller" : "Top seller"}
            </button>
            <input name="reason" defaultValue={userItem.banReason} placeholder="Ban reason" />
            <button
              type="submit"
              name="banned"
              value={userItem.isBanned ? "0" : "1"}
              className={userItem.isBanned ? "primary" : "dangerButton"}
            >
              <Ban size={15} />
              {userItem.isBanned ? "Unban" : "Ban"}
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
        <h2>No reviews yet</h2>
        <p>User reviews will appear here for moderation.</p>
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
                Publish
              </button>
            ) : (
              <button type="button" onClick={() => onModerateReview(review, "hidden")}>
                <EyeOff size={15} />
                Hide
              </button>
            )}
            <button type="button" className="dangerButton" onClick={() => onDeleteReview(review)}>
              <Trash2 size={15} />
              Delete
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
        <h2>No reports yet</h2>
        <p>Malware and project issue reports will appear here.</p>
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
                ? `Author: ${displayUserName(report.targetAuthor)}`
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
              Reported by: {displayUserName(report.author)} · ID {report.author.telegramId} · {formatDate(report.createdAt)}
            </span>
            {report.subjectType === "author" && report.targetAuthor?.telegramId && (
              <small>Target author: ID {report.targetAuthor.telegramId}</small>
            )}
            {report.details && <p>{report.details}</p>}
          </div>
          <div className="rowActions">
            <button type="button" onClick={() => onReportStatus(report, "reviewing")}>
              In review
            </button>
            <button type="button" className="primary" onClick={() => onReportStatus(report, "resolved")}>
              Resolved
            </button>
            <button type="button" className="dangerButton" onClick={() => onReportStatus(report, "rejected")}>
              Reject
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
        <h2>No downloads yet</h2>
        <p>When users start downloading files, the log will appear here.</p>
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
                File: {target}
                {item.versionId ? ` · version #${item.versionId}` : ""}
                {item.fileId ? ` · extra file #${item.fileId}` : ""}
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
        Broadcast to all users
      </strong>
      <label>
        Title
        <input name="title" required placeholder="New project collection" />
      </label>
      <label>
        Message
        <textarea name="message" rows={5} required placeholder="Text sent to notifications and the Telegram bot." />
      </label>
      <button type="submit" className="primary">
        <Send size={16} />
        Send broadcast
      </button>
    </form>
  );
}

const requestTypeLabels = {
  source: "Source",
  custom: "Customization",
  subscription: "Subscription",
  vip: "VIP"
};
const requestStatusLabels = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected"
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
          Grant access manually
        </strong>
        <div className="formGrid">
          <input name="telegramId" required placeholder="User Telegram ID" />
          <select name="kind" defaultValue="vip">
            <option value="vip">VIP</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>
        <input name="days" type="number" min="0" placeholder="Days (0 = permanent for VIP)" />
        <button type="submit" className="primary">
          <Gift size={15} />
          Grant access
        </button>
      </form>

      <form className="adminTool" onSubmit={onCreatePromo}>
        <strong>
          <Ticket size={16} />
          New promo code
        </strong>
        <div className="formGrid">
          <input name="code" required placeholder="Code, e.g. WELCOME" />
          <select name="type" defaultValue="project">
            <option value="project">Project access</option>
            <option value="subscription">Subscription</option>
            <option value="vip">VIP</option>
          </select>
        </div>
        <div className="formGrid">
          <input name="projectId" type="number" min="1" placeholder="Project ID (for project access)" />
          <input name="days" type="number" min="0" placeholder="Days (subscription/VIP)" />
        </div>
        <div className="formGrid">
          <input name="maxUses" type="number" min="0" placeholder="Redemption limit (0 = ∞)" />
          <input name="expiresAt" placeholder="Expires: 2026-12-31" />
        </div>
        <button type="submit" className="primary">
          <Plus size={15} />
          Create promo code
        </button>
      </form>

      <div className="adminTool">
        <strong>
          <Ticket size={16} />
          Promo codes
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
                    {code.days ? `${code.days} days · ` : ""}
                    {code.usedCount}/{code.maxUses || "∞"} redemptions
                    {code.expiresAt ? ` · until ${code.expiresAt}` : ""}
                  </span>
                </div>
                {code.isActive && (
                  <div className="rowActions">
                    <button type="button" className="dangerButton" onClick={() => onDeactivatePromo(code)}>
                      <Ban size={15} />
                      Disable
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="mutedText">No promo codes yet.</p>
          )}
        </div>
      </div>

      <div className="adminTool">
        <strong>
          <Wrench size={16} />
          Development and source requests
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
                    {request.budget ? ` · budget ${request.budget}` : ""}
                  </span>
                  {request.message && <p>{request.message}</p>}
                  {request.contact && <small>Contact: {request.contact}</small>}
                </div>
                <div className="rowActions">
                  <button type="button" onClick={() => onRequestStatus(request, "in_progress")}>
                    Start work
                  </button>
                  <button type="button" className="primary" onClick={() => onRequestStatus(request, "done")}>
                    Done
                  </button>
                  <button type="button" className="dangerButton" onClick={() => onRequestStatus(request, "rejected")}>
                    Reject
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="mutedText">No requests yet.</p>
          )}
        </div>
      </div>

      <div className="adminTool">
        <strong>
          <CreditCard size={16} />
          Purchases {pendingPurchases.length ? `· ${pendingPurchases.length} pending confirmation` : ""}
        </strong>
        <div className="listPanel adminSimpleList">
          {purchases.length ? (
            purchases.map((purchase) => (
              <div className="activityRow" key={purchase.id}>
                <div>
                  <strong>
                    {purchase.projectTitle}
                    <span className={`inlineBadge ${purchase.status === "pending" ? "danger" : ""}`}>
                      {purchase.status === "pending" ? "pending" : "paid"}
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
                      Confirm
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="mutedText">No purchases yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
