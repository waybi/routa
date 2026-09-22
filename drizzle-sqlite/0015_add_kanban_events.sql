CREATE TABLE `kanban_events` (
    `id`            text PRIMARY KEY NOT NULL,
    `workspace_id`  text NOT NULL,
    `type`          text NOT NULL,
    `resource_id`   text,
    `payload`       text NOT NULL,
    `created_at`    integer NOT NULL
);

CREATE INDEX `idx_kanban_events_workspace_created` ON `kanban_events` (`workspace_id`, `created_at`);
