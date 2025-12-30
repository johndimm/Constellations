-- Migration Script: Merge Duplicates Across Types (when same wikipedia_id)
-- This merges duplicates with same title+wikipedia_id even if they have different types
-- Normalizes types to consistent capitalization: "Person" (capitalized) or "event" (lowercase)

-- Step 1: Preview what will be merged
-- Groups by lower(title) + wikipedia_id (ignores type, but will merge keeping best type)
WITH duplicates AS (
  SELECT 
    lower(title) as normalized_title,
    COALESCE(wikipedia_id, '') as wikipedia_id,
    array_agg(DISTINCT type) as types,
    array_agg(id ORDER BY 
      -- Prefer properly cased titles
      CASE 
        WHEN title ~ '^[A-Z][a-z]' THEN 0  -- Title case (e.g., "Last Tango")
        WHEN title = initcap(title) THEN 0.5  -- Initcap (e.g., "Last Tango In Paris")
        WHEN title = upper(title) THEN 1   -- ALL CAPS
        WHEN title = lower(title) THEN 2   -- all lowercase
        ELSE 3                             -- Mixed case
      END,
      -- Prefer person type, then lowercase types
      CASE 
        WHEN LOWER(type) = 'person' THEN 0
        WHEN LOWER(type) = 'event' THEN 1
        ELSE 2                             -- Other types (will be normalized)
      END,
      CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
      id
    ) as all_ids,
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
  all_ids[1] as keep_id,
  all_ids[2:array_length(all_ids, 1)] as drop_ids,
  duplicate_count
FROM duplicates
ORDER BY duplicate_count DESC, normalized_title
LIMIT 50;

-- Step 2: Merge duplicates (CAREFUL: This modifies data!)
-- This merges across types, keeping the most appropriate type
DO $$
DECLARE
  dup_record RECORD;
  drop_id INTEGER;
  merged_count INTEGER := 0;
  ids_array INTEGER[];
  keep_id INTEGER;
  type_to_keep TEXT;
BEGIN
  -- Find all duplicate groups (case-insensitive title + wikipedia_id, ignoring type)
  FOR dup_record IN
    WITH dups AS (
      SELECT 
        lower(title) as normalized_title,
        COALESCE(wikipedia_id, '') as wiki_id_normalized,
        array_agg(id ORDER BY 
          -- Prefer properly cased titles
          CASE 
            WHEN title ~ '^[A-Z][a-z]' THEN 0
            WHEN title = initcap(title) THEN 0.5
            WHEN title = upper(title) THEN 1
            WHEN title = lower(title) THEN 2
            ELSE 3
          END,
          -- Prefer Person type, then properly cased types, then lowercase
          CASE 
            WHEN LOWER(type) = 'person' THEN 0
            WHEN type = initcap(type) THEN 1  -- Title case type
            ELSE 2                             -- Lowercase type like "event"
          END,
          CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
          id
        ) as all_ids,
        array_agg(type ORDER BY id) as all_types
      FROM nodes
      GROUP BY lower(title), COALESCE(wikipedia_id, '')
      HAVING count(*) > 1
    )
    SELECT 
      normalized_title,
      wiki_id_normalized as wikipedia_id,
      all_ids,
      all_types
    FROM dups
  LOOP
    -- Get the array of IDs and types
    ids_array := dup_record.all_ids;
    keep_id := ids_array[1];
    
    -- Determine normalized type: "person" (lowercase) if any is a person, otherwise "event" (lowercase)
    -- Check if any of the types is "person"
    type_to_keep := 'event';  -- Default to lowercase "event"
    FOR i IN 1..array_length(dup_record.all_types, 1) LOOP
      IF LOWER(dup_record.all_types[i]) = 'person' THEN
        type_to_keep := 'person';  -- Lowercase "person"
        EXIT;
      END IF;
    END LOOP;
    
    -- Update the kept node to have the normalized type
    UPDATE nodes SET type = type_to_keep WHERE id = keep_id;
    
    -- Process IDs 2 onwards (the ones to drop)
    FOR i IN 2..array_length(ids_array, 1) LOOP
      drop_id := ids_array[i];
      
      RAISE NOTICE 'Merging "%" (ID %, type: %, wikipedia_id: %) into ID % (keeping type: "%")', 
        dup_record.normalized_title, drop_id, 
        (SELECT type FROM nodes WHERE id = drop_id),
        CASE WHEN dup_record.wikipedia_id = '' THEN 'NULL/empty' ELSE dup_record.wikipedia_id END, 
        keep_id, type_to_keep;
      
      -- Delete edges that would become duplicates after merge
      DELETE FROM edges 
      WHERE person_id = drop_id 
        AND EXISTS (
          SELECT 1 FROM edges e2 
          WHERE e2.person_id = keep_id 
            AND e2.event_id = edges.event_id
        );
      
      DELETE FROM edges 
      WHERE event_id = drop_id 
        AND EXISTS (
          SELECT 1 FROM edges e2 
          WHERE e2.person_id = edges.person_id 
            AND e2.event_id = keep_id
        );
      
      -- Update the remaining edges
      UPDATE edges 
      SET person_id = keep_id 
      WHERE person_id = drop_id;
      
      UPDATE edges 
      SET event_id = keep_id 
      WHERE event_id = drop_id;
      
      -- Delete the duplicate node
      DELETE FROM nodes WHERE id = drop_id;
      
      merged_count := merged_count + 1;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Duplicate merge complete! Merged % duplicate nodes (across types).', merged_count;
END $$;

-- Step 3: Verify no duplicates remain
SELECT 
  lower(title) as normalized_title,
  COALESCE(wikipedia_id, '') as wikipedia_id,
  count(*) as count
FROM nodes
GROUP BY lower(title), COALESCE(wikipedia_id, '')
HAVING count(*) > 1
ORDER BY count DESC, normalized_title;

-- Should return 0 rows if all duplicates were merged
