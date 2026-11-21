-- Run after 039 (or any later script). Creates the global partner catalog.
--
-- A global partner belongs to no project: every project can bind it in a
-- workflow, and only platform administrators may edit it. Its rules, skills and
-- MCP servers are stored as ids and resolved against whichever project is
-- running, so one definition serves every project without duplicating prompts
-- or gates.
--
-- Kept in its own table so project partners (`agents`) keep their existing
-- per-project semantics untouched. The id is global, matching how workflows
-- reference a partner by id alone.

CREATE TABLE IF NOT EXISTS global_partners (
    id         VARCHAR(64)  NOT NULL,
    name       VARCHAR(255) NOT NULL,
    payload    JSON         NOT NULL,
    updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_global_partners_updated (updated_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;
