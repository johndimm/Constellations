-- Preview: Show duplicates that will be merged (ignores type, merges across types)
-- Groups by lower(title) + wikipedia_id (NO type)

WITH duplicates AS (
  SELECT 
    lower(title) as normalized_title,
    COALESCE(wikipedia_id, '') as wikipedia_id,
    array_agg(DISTINCT type) as types,
    array_agg(id ORDER BY id) as all_ids,
    array_agg(title ORDER BY id) as all_titles,
    array_agg(type ORDER BY id) as all_types,
    count(*) as duplicate_count
  FROM nodes
  GROUP BY lower(title), COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
)
SELECT 
  normalized_title,
  CASE WHEN wikipedia_id = '' THEN 'NULL/empty' ELSE wikipedia_id END as wikipedia_id,
  types,
  all_titles,
  all_types,
  all_ids,
  all_ids[1] as suggested_keep_id,
  all_ids[2:array_length(all_ids, 1)] as suggested_drop_ids,
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
  GROUP BY lower(title), COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
) sub;
