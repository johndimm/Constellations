-- Preview: Show what will be merged (matches your dup.sql query pattern)
-- This shows duplicates grouped by lower(title) + wikipedia_id (includes type for safety)

WITH duplicates AS (
  SELECT 
    lower(title) as normalized_title,
    type,
    COALESCE(wikipedia_id, '') as wiki_id_normalized,
    array_agg(id ORDER BY 
      -- Prefer properly cased titles, then ones with wikipedia_id, then oldest
      CASE 
        WHEN title ~ '^[A-Z][a-z]' THEN 0  -- Title case (e.g., "Last Tango")
        WHEN title = initcap(title) THEN 0.5  -- Initcap (e.g., "Last Tango In Paris")
        WHEN title = upper(title) THEN 1   -- ALL CAPS
        WHEN title = lower(title) THEN 2   -- all lowercase
        ELSE 3                             -- Mixed case
      END,
      CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
      id
    ) as all_ids,
    array_agg(title ORDER BY id) as all_titles,
    count(*) as duplicate_count
  FROM nodes
  GROUP BY lower(title), type, COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
)
SELECT 
  normalized_title,
  type,
  CASE WHEN wiki_id_normalized = '' THEN 'NULL/empty' ELSE wiki_id_normalized END as wikipedia_id,
  all_titles,
  all_ids,
  all_ids[1] as keep_id,
  all_ids[2:array_length(all_ids, 1)] as drop_ids,
  duplicate_count
FROM duplicates
ORDER BY duplicate_count DESC, normalized_title;

-- Summary count
SELECT 
  count(*) as total_duplicate_groups,
  sum(duplicate_count - 1) as total_nodes_to_merge
FROM (
  SELECT 
    count(*) as duplicate_count
  FROM nodes
  GROUP BY lower(title), type, COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
) sub;
