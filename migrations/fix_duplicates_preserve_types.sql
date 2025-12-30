-- Merge duplicates while preserving original types
-- Uses type_internal for matching, but keeps the original detailed type

-- Step 1: Ensure type_internal column exists and is populated
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS type_internal TEXT;
UPDATE nodes 
SET type_internal = CASE 
  WHEN LOWER(type) = 'person' THEN 'person'
  ELSE 'event'
END
WHERE type_internal IS NULL;

-- Step 2: Preview duplicates that will be merged
WITH duplicates AS (
  SELECT 
    lower(title) as normalized_title,
    COALESCE(wikipedia_id, '') as wikipedia_id,
    array_agg(DISTINCT type) as original_types,
    array_agg(id ORDER BY 
      -- Prefer properly cased titles
      CASE 
        WHEN title ~ '^[A-Z][a-z]' THEN 0
        WHEN title = initcap(title) THEN 0.5
        WHEN title = upper(title) THEN 1
        WHEN title = lower(title) THEN 2
        ELSE 3
      END,
      CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
      id
    ) as all_ids,
    array_agg(title ORDER BY id) as all_titles,
    count(*) as duplicate_count
  FROM nodes
  GROUP BY lower(title), COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
)
SELECT 
  normalized_title,
  CASE WHEN wikipedia_id = '' THEN 'NULL/empty' ELSE wikipedia_id END as wikipedia_id,
  original_types,
  all_titles,
  all_ids,
  all_ids[1] as keep_id,
  all_ids[2:array_length(all_ids, 1)] as drop_ids,
  duplicate_count
FROM duplicates
ORDER BY duplicate_count DESC, normalized_title
LIMIT 50;

-- Step 3: Merge duplicates (CAREFUL: This modifies data!)
DO $$
DECLARE
  dup_record RECORD;
  drop_id INTEGER;
  merged_count INTEGER := 0;
  ids_array INTEGER[];
  keep_id INTEGER;
  type_to_keep TEXT;
  original_type_to_keep TEXT;
BEGIN
  RAISE NOTICE 'Merging duplicates while preserving original types...';
  
  -- Find all duplicate groups (case-insensitive title + wikipedia_id)
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
    original_type_to_keep := dup_record.all_types[1];
    
    -- Determine type_internal: "person" if any is a person, otherwise "event"
    SELECT type_internal INTO type_to_keep FROM nodes WHERE id = keep_id;
    IF type_to_keep IS NULL THEN
      type_to_keep := CASE WHEN LOWER(original_type_to_keep) = 'person' THEN 'person' ELSE 'event' END;
    END IF;
    
    -- Process IDs 2 onwards (the ones to drop)
    FOR i IN 2..array_length(ids_array, 1) LOOP
      drop_id := ids_array[i];
      
      RAISE NOTICE 'Merging "%" (ID %, type: %, type_internal: %, wikipedia_id: %) into ID % (keeping type: "%", type_internal: "%")', 
        dup_record.normalized_title, drop_id, 
        (SELECT type FROM nodes WHERE id = drop_id),
        (SELECT type_internal FROM nodes WHERE id = drop_id),
        CASE WHEN dup_record.wikipedia_id = '' THEN 'NULL/empty' ELSE dup_record.wikipedia_id END, 
        keep_id, original_type_to_keep, type_to_keep;
      
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
    
    -- Ensure type_internal is set on the kept node
    UPDATE nodes SET type_internal = type_to_keep WHERE id = keep_id AND type_internal IS NULL;
  END LOOP;
  
  RAISE NOTICE 'Duplicate merge complete! Merged % duplicate nodes.', merged_count;
END $$;

-- Step 4: Verify no duplicates remain
SELECT 
  'Duplicates check' as check_type,
  count(*) as remaining_duplicates
FROM (
  SELECT 
    lower(title) as normalized_title,
    COALESCE(wikipedia_id, '') as wikipedia_id,
    count(*) as dup_count
  FROM nodes
  GROUP BY lower(title), COALESCE(wikipedia_id, '')
  HAVING count(*) > 1
) duplicates;

-- Step 5: Verify type_internal is populated
SELECT 
  'Type internal check' as check_type,
  type_internal,
  count(*) as count
FROM nodes
GROUP BY type_internal
ORDER BY type_internal;
