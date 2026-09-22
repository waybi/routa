CREATE TABLE "kanban_events" (
    "id"            TEXT PRIMARY KEY NOT NULL,
    "workspace_id"  TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "resource_id"   TEXT,
    "payload"       JSONB NOT NULL,
    "created_at"    TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX "idx_kanban_events_workspace_created" ON "kanban_events" ("workspace_id", "created_at");
