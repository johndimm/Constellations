-- Diagnostic Script: Check for duplicates with same wikipedia_id (case-insensitive title)
-- Run this to see exactly what duplicates exist

-- 1. Count duplicates with same wikipedia_id
SELECT 
  count(*) as duplicate_groups,
  sum(dup_count - 1) as total_duplicate_nodes
FROM (
  SELECT count(*) as dup_count
  FROM nodes
  WHERE wikipedia_id IS NOT NULL AND wikipedia_id != ''
  GROUP BY lower(title), type, wikipedia_id
  HAVING count(*) > 1
) sub;

-- 2. Show all duplicate groups with same wikipedia_id
WITH duplicates AS (
  SELECT 
    lower(title) as normalized_title,
    type,
    wikipedia_id,
    array_agg(id ORDER BY id) as all_ids,
    array_agg(title ORDER BY id) as all_titles,
    count(*) as duplicate_count
  FROM nodes
  WHERE wikipedia_id IS NOT NULL AND wikipedia_id != ''
  GROUP BY lower(title), type, wikipedia_id
  HAVING count(*) > 1
)
SELECT 
  normalized_title,
  type,
  wikipedia_id,
  all_titles,
  all_ids,
  all_ids[1] as suggested_keep_id,
  all_ids[2:array_length(all_ids, 1)] as suggested_drop_ids,
  duplicate_count
FROM duplicates
ORDER BY duplicate_count DESC, normalized_title
LIMIT 20;

-- 3. Specifically check for "Last Tango in Paris"
SELECT id, title, type, wikipedia_id, description, year
FROM nodes
WHERE lower(title) LIKE '%tango%paris%'
ORDER BY id;
