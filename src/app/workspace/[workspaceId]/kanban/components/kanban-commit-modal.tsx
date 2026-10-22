"use client";

import React, { useState } from "react";
import { X, GitCommitHorizontal } from "lucide-react";

interface KanbanCommitModalProps {
  open: boolean;
  onClose: () => void;
  onCommit: (message: string) => Promise<void>;
  fileCount: number;
}

export function KanbanCommitModal({ open, onClose, onCommit, fileCount }: KanbanCommitModalProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    setLoading(true);
    try {
      await onCommit(message.trim());
      setMessage("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setMessage("");
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-default bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-primary">
              Create Commit
            </h2>
            <p className="mt-1 text-sm text-secondary">
              Commit {fileCount} staged file{fileCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-lg p-1 text-secondary transition hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="commit-message" className="block text-sm font-medium text-primary">
              Commit message
            </label>
            <textarea
              id="commit-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Brief description of your changes..."
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
              rows={4}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-secondary">
              Use present tense (&quot;add&quot; not &quot;added&quot;). Be concise but descriptive.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-lg border border-default px-4 py-2 text-sm font-medium text-primary transition hover:bg-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!message.trim() || loading}
              className="flex items-center gap-2 rounded-lg border border-success bg-success-subtle px-4 py-2 text-sm font-medium text-success transition hover:bg-success-subtle disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
            >
              <GitCommitHorizontal className="h-4 w-4" />
              {loading ? "Committing..." : "Commit"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
