-- Add type_internal column to nodes table
-- This column stores the simplified "person" or "event" classification for app logic
-- while preserving the original detailed type in the "type" column

-- Step 1: Add the column (if it doesn't exist)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS type_internal TEXT;

-- Step 2: Populate type_internal based on existing type column
-- "person" for person nodes, "event" for everything else
UPDATE nodes 
SET type_internal = CASE 
  WHEN LOWER(type) = 'person' THEN 'person'
  ELSE 'event'
END
WHERE type_internal IS NULL;

-- Step 3: Create index for faster lookups
CREATE INDEX IF NOT EXISTS nodes_type_internal_idx ON nodes(type_internal);

-- Step 4: Verify
SELECT 
  type_internal,
  type as original_type,
  count(*) as count
FROM nodes
GROUP BY type_internal, type
ORDER BY type_internal, count DESC
LIMIT 20;

-- Show summary
SELECT 
  type_internal,
  count(*) as count
FROM nodes
GROUP BY type_internal
ORDER BY type_internal;
