-- Diagnostic Script: Check what merge script will do
-- Run this to see exactly what the merge would process

-- 1. Count total duplicates
SELECT 
  count(*) as duplicate_groups,
  sum(dup_count - 1) as total_duplicate_nodes
FROM (
  SELECT count(*) as dup_count
  FROM nodes
  GROUP BY title, type
  HAVING count(*) > 1
) sub;

-- 2. Show all duplicate groups with details
WITH duplicates AS (
  SELECT 
    title,
    type,
    array_agg(id ORDER BY 
      CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
      id
    ) as all_ids,
    count(*) as duplicate_count
  FROM nodes
  GROUP BY title, type
  HAVING count(*) > 1
)
SELECT 
  title,
  type,
  all_ids,
  all_ids[1] as keep_id,
  all_ids[2:array_length(all_ids, 1)] as drop_ids,
  duplicate_count
FROM duplicates
ORDER BY duplicate_count DESC, title
LIMIT 20;

-- 3. Simple count by title to verify
SELECT title, type, count(*)
FROM nodes
GROUP BY title, type
HAVING count(*) > 1
ORDER BY count(*) DESC, title
LIMIT 10;
