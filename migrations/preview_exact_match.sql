-- Preview: Show what will be merged (EXACT MATCH - matches your dup.sql query)
-- Groups by lower(title) + wikipedia_id (NO type check)

SELECT 
  lower(title) as normalized_title,
  COALESCE(wikipedia_id, '') as wikipedia_id,
  array_agg(DISTINCT type) as types,
  array_agg(id ORDER BY id) as all_ids,
  array_agg(title ORDER BY id) as all_titles,
  count(*) as duplicate_count
FROM nodes
GROUP BY lower(title), COALESCE(wikipedia_id, '')
HAVING count(*) > 1
ORDER BY duplicate_count DESC, normalized_title;

-- Summary count
SELECT 
  count(*) as total_duplicate_groups,
  sum(duplicate_count - 1) as total_nodes_to_merge
FROM (
  SELECT 
    count(*) as duplicate_count
  FROM nodes
  GROUP BY lower(title), COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
) sub;
