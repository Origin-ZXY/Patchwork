ALTER TABLE patchwork_rooms ADD COLUMN creator_hash TEXT;
--> statement-breakpoint
CREATE INDEX patchwork_rooms_creator ON patchwork_rooms(creator_hash, expires_at);
--> statement-breakpoint
ALTER TABLE patchwork_presence ADD COLUMN read_window INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE patchwork_presence ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0;
