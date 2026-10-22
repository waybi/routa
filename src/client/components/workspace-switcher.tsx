"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceData } from "../hooks/use-workspaces";
import { useTranslation } from "@/i18n";
import { normalizeWorkspaceQueryId } from "../utils/workspace-id";
import { Check, ChevronDown, Folder, Plus, Search } from "lucide-react";

export const DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY = "routa.desktop.last-workspace-id";

function hasWorkspaceStorageAccess(): boolean {
  return (
    typeof window !== "undefined"
    && window.localStorage != null
    && typeof window.localStorage.getItem === "function"
    && typeof window.localStorage.setItem === "function"
  );
}

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceData[];
  activeWorkspaceId: string | null;
  activeWorkspaceTitle?: string;
  onSelect: (workspaceId: string) => void;
  onCreate?: (title: string) => Promise<void> | void;
  loading?: boolean;
  compact?: boolean;
  /** Use desktop/VS Code style theme */
  desktop?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  activeWorkspaceTitle,
  onSelect,
  onCreate,
  loading,
  compact,
  desktop,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const visibleTitle = active?.title ?? activeWorkspaceTitle;

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setSearchQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeDropdown, open]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDropdown();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [closeDropdown, open]);

  useEffect(() => {
    if (!hasWorkspaceStorageAccess()) {
      return;
    }
    const normalizedWorkspaceId = normalizeWorkspaceQueryId(activeWorkspaceId);
    try {
      if (normalizedWorkspaceId) {
        window.localStorage.setItem(DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY, normalizedWorkspaceId);
      } else {
        window.localStorage.removeItem(DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY);
      }
    } catch {
      // localStorage may throw in restricted environments (quota, blocked storage)
    }
  }, [activeWorkspaceId]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title || !onCreate) return;
    await onCreate(title);
    setNewTitle("");
    closeDropdown();
  };

  const filteredWorkspaces = searchQuery
    ? workspaces.filter((ws) => ws.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : workspaces;

  // `compact` / `desktop` used to pick between two palettes; both now share
  // the redesign tokens and only differ in size.
  const dense = Boolean(desktop || compact);
  const triggerCls = `flex max-w-[240px] items-center gap-1.5 rounded-control border border-default bg-surface px-2.5 text-left text-primary transition-colors hover:bg-hover motion-reduce:transition-none ${dense ? "py-1 text-xs" : "py-1.5 text-[13px]"}`;
  const triggerIconSize = "h-3.5 w-3.5 text-secondary";
  const chevronCls = `h-3 w-3 text-secondary transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`;
  const dropdownBg = "border-default bg-surface text-primary shadow-overlay";
  const panelText = "text-primary";
  const activeItemCls = "bg-accent-subtle text-primary";
  const listItemBase = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs";
  const footerBorder = "border-default";
  const footerText = "text-secondary";
  const rowIcon = "h-3.5 w-3.5 text-secondary";
  const rowActiveIcon = "h-3 w-3 text-accent";
  const footerBtn = "rounded-md px-2 py-1.5 text-xs text-accent hover:bg-hover";
  const createInputCls = "h-7 border-default bg-canvas px-2 text-xs text-primary placeholder:text-secondary focus:border-accent";
  const createBtnCls = "rounded-md bg-accent px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90";
  const searchInputCls = "border-transparent text-xs text-primary placeholder:text-secondary";

  return (
    <div className="relative" ref={dropdownRef} data-testid="desktop-workspace-switcher">
      <button
        type="button"
        onClick={() => {
          if (open) {
            closeDropdown();
            return;
          }
          setOpen(true);
        }}
        className={triggerCls}
        title={visibleTitle ?? t.workspace.selectWorkspace}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Folder className={triggerIconSize} strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">
          {loading ? t.uiKit?.loading ?? "…" : (visibleTitle ?? t.workspace.select)}
        </span>
        <ChevronDown className={chevronCls} strokeWidth={2} />
      </button>

      {open && (
        <div
          className={`absolute left-0 top-full z-50 mt-1 min-w-[14rem] max-w-[18rem] rounded-lg border ${dropdownBg}`}
        >
          <div className="border-b border-default p-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-default bg-canvas px-2 py-1">
              <Search className="h-3.5 w-3.5 text-secondary" strokeWidth={2} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                  }
                }}
                aria-label={t.common.search}
                placeholder={t.common.search}
                className={`h-7 w-full rounded border bg-transparent outline-none ${searchInputCls} placeholder:truncate`}
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto px-1 py-1">
            {filteredWorkspaces.length === 0 && (
              <div className={`px-3 py-2 text-center text-[11px] ${footerText}`}>
                {t.workspace.noWorkspacesYet}
              </div>
            )}
            {filteredWorkspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  onSelect(ws.id);
                  closeDropdown();
                }}
                className={`${listItemBase} ${
                  ws.id === activeWorkspaceId
                    ? activeItemCls
                    : `${panelText} hover:bg-hover`
                }`}
              >
                <Folder className={rowIcon} strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{ws.title}</span>
                {ws.id === activeWorkspaceId ? (
                  <Check className={rowActiveIcon} fill="currentColor" />
                ) : null}
              </button>
            ))}
          </div>

          <div className={`border-t ${footerBorder} p-1.5`}>
            {creating ? (
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder={t.workspace.workspaceName}
                  className={`flex-1 rounded border ${createInputCls} focus:outline-none`}
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  className={createBtnCls}
                >
                  {t.common.create}
                </button>
              </div>
            ) : onCreate && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={`w-full rounded flex items-center justify-center gap-1.5 ${footerBtn}`}
              >
                <Plus className={rowIcon} strokeWidth={2} />
                {t.workspace.newWorkspace}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
