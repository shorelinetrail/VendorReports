-- Free-text coordination notes on a visit ("vendor called, running late").
CREATE TABLE visit_comments (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_visit ON visit_comments(visit_id);
