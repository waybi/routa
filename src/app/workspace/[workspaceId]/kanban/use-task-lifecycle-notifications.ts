"use client";

/**
 * Turns `kanban:task-lifecycle` SSE events into user-visible notifications.
 *
 * Three surfaces, deliberately:
 * - toast: for the user who is looking at the board right now
 * - notification center (bell): so the event survives a tab switch
 * - OS notification: only while the tab is hidden, which is exactly the case
 *   the board could not cover before (you walk away, the agent finishes, and
 *   nothing tells you)
 */

import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "@/i18n";
import { toast } from "@/client/components/toast";
import { useNotifications, type AppNotification } from "@/client/components/notification-center";
import type { KanbanTaskLifecyclePayload } from "@/client/hooks/use-kanban-events";

type LifecyclePhase = KanbanTaskLifecyclePayload["phase"];

const NOTIFIED_PHASES: ReadonlySet<LifecyclePhase> = new Set<LifecyclePhase>([
  "completed",
  "failed",
  "needs_review",
  "blocked",
]);

function formatTitle(template: string, taskTitle: string): string {
  return template.replace("{title}", taskTitle);
}

function notificationTypeFor(phase: LifecyclePhase): AppNotification["type"] {
  return phase === "failed" ? "error" : "task";
}

export interface UseTaskLifecycleNotificationsOptions {
  /** Opens the card the notification refers to. */
  onOpenTask?: (taskId: string) => void;
  /** Escape hatch for tests and for surfaces that should stay quiet. */
  enabled?: boolean;
}

export function useTaskLifecycleNotifications({
  onOpenTask,
  enabled = true,
}: UseTaskLifecycleNotificationsOptions = {}): (event: KanbanTaskLifecyclePayload) => void {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const onOpenTaskRef = useRef(onOpenTask);
  // Reconnects replay recent frames; dedupe so one completion notifies once.
  const seenEventKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onOpenTaskRef.current = onOpenTask;
  }, [onOpenTask]);

  // Ask once, lazily: a permission prompt on page load is hostile, but we do
  // want the grant in place before the first long run finishes.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    void Notification.requestPermission().catch(() => {
      // Denied or unavailable: the toast and bell still cover the in-app case.
    });
  }, [enabled]);

  return useCallback((event: KanbanTaskLifecyclePayload) => {
    if (!enabled) return;
    if (!NOTIFIED_PHASES.has(event.phase)) return;

    const eventKey = `${event.taskId}:${event.phase}:${event.timestamp ?? ""}`;
    if (seenEventKeysRef.current.has(eventKey)) return;
    seenEventKeysRef.current.add(eventKey);
    if (seenEventKeysRef.current.size > 200) {
      seenEventKeysRef.current = new Set(Array.from(seenEventKeysRef.current).slice(-100));
    }

    const templates: Record<string, string> = {
      completed: t.feedback.taskCompleted,
      failed: t.feedback.taskFailed,
      needs_review: t.feedback.taskNeedsReview,
      blocked: t.feedback.taskBlocked,
    };
    const title = formatTitle(templates[event.phase] ?? t.feedback.taskCompleted, event.taskTitle);
    const description = event.lastMessagePreview;
    const openTask = () => onOpenTaskRef.current?.(event.taskId);

    if (event.phase === "failed") {
      toast.error(title, { description, action: { label: t.feedback.openCard, onClick: openTask } });
    } else if (event.phase === "completed") {
      toast.success(title, { description, action: { label: t.feedback.openCard, onClick: openTask } });
    } else {
      toast.info(title, { description, action: { label: t.feedback.openCard, onClick: openTask } });
    }

    addNotification({
      type: notificationTypeFor(event.phase),
      title,
      message: description ?? "",
      metadata: { taskId: event.taskId, sessionId: event.sessionId, phase: event.phase },
    });

    if (
      typeof document !== "undefined"
      && document.visibilityState === "hidden"
      && typeof window !== "undefined"
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      try {
        // `tag` collapses repeats for the same card instead of stacking.
        new Notification(title, { body: description, tag: event.taskId });
      } catch {
        // Some environments expose Notification but refuse construction.
      }
    }
  }, [addNotification, enabled, t]);
}
