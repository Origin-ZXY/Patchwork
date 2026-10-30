CREATE TABLE IF NOT EXISTS patchwork_rooms (
  code TEXT PRIMARY KEY NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patchwork_rooms_expiry ON patchwork_rooms(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS patchwork_presence (
  room_code TEXT NOT NULL REFERENCES patchwork_rooms(code) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(room_code, seat)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patchwork_presence_seen ON patchwork_presence(last_seen);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS patchwork_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patchwork_limits_expiry ON patchwork_limits(expires_at);
