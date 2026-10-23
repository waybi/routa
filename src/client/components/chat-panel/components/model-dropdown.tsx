"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Monitor } from "lucide-react";
import { useTranslation } from "@/i18n";


interface ModelDropdownProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  onFetchModels: () => Promise<string[]>;
}

export function ModelDropdown({
  selectedModel,
  onModelChange,
  onFetchModels,
}: ModelDropdownProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleToggle = async () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top });
    }
    if (!isOpen && models.length === 0) {
      setLoading(true);
      const fetchedModels = await onFetchModels();
      setModels(fetchedModels);
      setLoading(false);
    }
    setIsOpen((v) => !v);
    setFilter("");
  };

  const handleSelect = (model: string) => {
    onModelChange(model);
    setIsOpen(false);
    setFilter("");
  };

  const filteredModels = models.filter(
    (m) => !filter || m.toLowerCase().includes(filter.toLowerCase())
  );

  const displayName = selectedModel ? selectedModel.split("/").pop() : t.chatPanel.defaultModel;

  return (
    <div ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md border border-default hover:bg-hover text-xs font-medium text-primary bg-surface dark:bg-transparent transition-colors"
      >
        <Monitor className="w-3 h-3 text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        <span className="truncate max-w-30">{displayName}</span>
        {loading ? (
          <span className="w-3 h-3 border border-default border-t-transparent rounded-full animate-spin" />
        ) : (
          <ChevronDown className={`w-3 h-3 text-secondary transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        )}
      </button>

      {isOpen && dropdownPos && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed w-72 rounded-lg border border-default bg-surface shadow-xl z-9999 flex flex-col"
            style={{ left: dropdownPos.left, bottom: dropdownPos.bottom, maxHeight: "300px" }}
          >
            <div className="p-2 border-b border-default">
              <input
                autoFocus
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t.chatPanel.filterModels}
                className="w-full px-2 py-1 text-xs rounded border border-default bg-transparent outline-none focus:ring-1 focus:ring-accent text-primary"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              <button
                type="button"
                onClick={() => handleSelect("")}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  !selectedModel
                    ? "bg-accent-subtle text-accent"
                    : "hover:bg-hover text-primary"
                }`}
              >
                <span className="font-medium">{t.chatPanel.defaultModel}</span>
              </button>
              {filteredModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSelect(m)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    m === selectedModel
                      ? "bg-accent-subtle text-accent"
                      : "hover:bg-hover text-primary"
                  }`}
                >
                  <span className="text-secondary font-mono text-[10px] shrink-0">
                    {m.split("/")[0]}
                  </span>
                  <span className="font-medium truncate">{m.split("/").slice(1).join("/") || m}</span>
                </button>
              ))}
              {models.length === 0 && !loading && (
                <div className="px-3 py-3 text-xs text-secondary text-center">{t.chatPanel.noModelsFound}</div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
