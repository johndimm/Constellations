-- Create database schema from scratch
-- Run this on an empty database: psql $DATABASE_URL -f migrations/create_schema.sql

-- Create nodes table
CREATE TABLE IF NOT EXISTS nodes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  is_person BOOLEAN,
  wikipedia_id TEXT NOT NULL DEFAULT '',
  description TEXT,
  year INTEGER,
  image_url TEXT,
  wiki_summary TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(title, type, wikipedia_id)
);

-- Create edges table (person_id -> event_id, always person-to-event connections)
CREATE TABLE IF NOT EXISTS edges (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(person_id, event_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS edges_person_idx ON edges (person_id);
CREATE INDEX IF NOT EXISTS edges_event_idx ON edges (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS nodes_title_type_wiki_idx ON nodes (lower(title), type, wikipedia_id);
CREATE INDEX IF NOT EXISTS nodes_is_person_idx ON nodes(is_person);

-- Verify tables were created
SELECT 
  'Schema created successfully' as status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'nodes') as nodes_table_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'edges') as edges_table_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'nodes' AND column_name = 'is_person') as is_person_column_exists;
