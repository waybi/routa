"use client";

/**
 * NotificationCenter - In-app notification system
 * 
 * Features:
 * - Persistent notifications (require user click to dismiss)
 * - Bell icon with unread count badge
 * - Dropdown panel showing all notifications
 * - Links to message center for full history
 */

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useTranslation } from "@/i18n";
import { Bell } from "lucide-react";


// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  type: "pr_review" | "webhook" | "task" | "info" | "error";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: string;
  metadata?: Record<string, unknown>;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (notification: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

/**
 * Task id carried in `metadata`, if any. Entries persisted by older builds may
 * have no metadata, `null`, or a non-object value, so read defensively.
 */
function readNotificationTaskId(notification: Partial<AppNotification> | null | undefined): string | undefined {
  const metadata: unknown = notification?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const taskId = (metadata as Record<string, unknown>).taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : undefined;
}

/**
 * Inert fallback for trees rendered without the provider (unit tests,
 * Storybook, any surface that mounts a shell fragment in isolation).
 *
 * The bell now lives in the shared header, so throwing here turns "this
 * screen has no notification provider" into "this screen crashes". Missing
 * notifications are a degraded experience; a thrown render is an outage.
 */
const INERT_NOTIFICATION_CONTEXT: NotificationContextType = {
  notifications: [],
  unreadCount: 0,
  addNotification: () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
  clearAll: () => {},
};

export function useNotifications(): NotificationContextType {
  return useContext(NotificationContext) ?? INERT_NOTIFICATION_CONTEXT;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem("routa_notifications");
    if (!stored) return [];
    try {
      return JSON.parse(stored) as AppNotification[];
    } catch {
      return [];
    }
  });

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem("routa_notifications", JSON.stringify(notifications.slice(0, 100)));
  }, [notifications]);

  const addNotification = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    const newNotif: AppNotification = {
      ...n,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    // One entry per card: a newer notification about the same task replaces
    // the older one instead of stacking.
    const taskId = readNotificationTaskId(newNotif);
    setNotifications((prev) => [
      newNotif,
      ...(taskId ? prev.filter((item) => readNotificationTaskId(item) !== taskId) : prev),
    ]);
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

// ─── Bell Icon with Dropdown ─────────────────────────────────────────────────

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const init = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearTimeout(init);
      clearInterval(id);
    };
  }, []);

  const formatTime = (ts: string) => {
    if (!now) return "now";
    const diff = now - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getTypeIcon = (type: AppNotification["type"]) => {
    switch (type) {
      case "pr_review": return "🔍";
      case "webhook": return "🔔";
      case "task": return "✓";
      case "error": return "⚠️";
      default: return "ℹ️";
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative rounded-control p-1.5 text-secondary transition-colors hover:bg-hover hover:text-primary motion-reduce:transition-none"
        title={t.notifications.title}
        aria-label={t.notifications.title}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <Bell className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
        {/* Notifications are restored from localStorage, which the server
            render cannot see; show the badge only after mount (`now` is set
            by the mount effect) so SSR and the first client render match. */}
        {now > 0 && unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-bold text-on-accent">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-default bg-surface text-primary shadow-overlay">
            <div className="flex items-center justify-between border-b border-default px-3 py-2">
              <span className="text-xs font-semibold text-primary">{t.notifications.title}</span>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllAsRead} className="text-[11px] text-accent hover:underline">
                    {t.notifications.markAllRead}
                  </button>
                )}
                <a href="/messages" className="text-[11px] text-secondary hover:text-primary hover:underline">
                  {t.notifications.viewAll}
                </a>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-secondary">{t.notifications.empty}</div>
              ) : (
                notifications.slice(0, 20).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => { markAsRead(n.id); if (n.link) window.location.href = n.link; }}
                    className={`w-full border-b border-default px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-hover motion-reduce:transition-none ${!n.read ? "bg-accent-subtle" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm">{getTypeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-primary">{n.title}</span>
                          {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                        </div>
                        <p className="truncate text-[11px] text-secondary">{n.message}</p>
                        <span className="text-[10px] text-secondary">{formatTime(n.timestamp)}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
