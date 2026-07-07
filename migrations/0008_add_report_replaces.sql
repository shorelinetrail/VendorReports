-- Reports can be replaced by a newer version; the old file is kept and linked.
ALTER TABLE visit_reports ADD COLUMN replaces_id TEXT REFERENCES visit_reports(id);
