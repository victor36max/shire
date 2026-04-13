CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='',
  contentless_delete=1
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages
WHEN NEW.role IN ('user', 'agent', 'inter_agent') AND json_extract(NEW.content, '$.text') IS NOT NULL
BEGIN
  INSERT INTO messages_fts(rowid, text)
  VALUES(NEW.id, json_extract(NEW.content, '$.text'));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages
WHEN OLD.role IN ('user', 'agent', 'inter_agent') AND json_extract(OLD.content, '$.text') IS NOT NULL
BEGIN
  DELETE FROM messages_fts WHERE rowid = OLD.id;
END;
