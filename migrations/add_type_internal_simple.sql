-- Add type_internal column to nodes table
-- This is safe to run - it only adds a column, doesn't modify existing data

-- Add the column
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS type_internal TEXT;

-- Populate type_internal based on existing type column
-- "person" for person nodes, "event" for everything else
UPDATE nodes 
SET type_internal = CASE 
  WHEN LOWER(type) = 'person' THEN 'person'
  ELSE 'event'
END
WHERE type_internal IS NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS nodes_type_internal_idx ON nodes(type_internal);

-- Verify
SELECT 
  'Column added. Current distribution:' as status,
  type_internal,
  count(*) as count
FROM nodes
GROUP BY type_internal
ORDER BY type_internal;
