-- Migration Script: Merge Duplicates (EXACT MATCH - matches your dup.sql query)
-- This matches your exact query pattern: groups by lower(title) + wikipedia_id (NO type)
-- WARNING: This will merge duplicates across different types if they have same title/wikipedia_id
-- Only use this if you're sure you want to merge across types!

-- Step 1: Preview what will be merged (matches your dup.sql exactly)
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
ORDER BY duplicate_count DESC, normalized_title
LIMIT 20;

-- Step 2: Merge duplicates (CAREFUL: This modifies data!)
-- WARNING: This merges across types if they have same title/wikipedia_id!
DO $$
DECLARE
  dup_record RECORD;
  drop_id INTEGER;
  merged_count INTEGER := 0;
  ids_array INTEGER[];
  keep_id INTEGER;
  title_to_keep TEXT;
BEGIN
  -- Find all duplicate groups (case-insensitive title + wikipedia_id, NO type)
  FOR dup_record IN
    WITH dups AS (
      SELECT 
        lower(title) as normalized_title,
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
        array_agg(title ORDER BY 
          CASE 
            WHEN title ~ '^[A-Z][a-z]' THEN 0
            WHEN title = initcap(title) THEN 0.5
            WHEN title = upper(title) THEN 1
            WHEN title = lower(title) THEN 2
            ELSE 3
          END,
          CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
          id
        ) as all_titles
      FROM nodes
      GROUP BY lower(title), COALESCE(wikipedia_id, '')
      HAVING count(*) > 1
    )
    SELECT 
      normalized_title,
      wiki_id_normalized as wikipedia_id,
      all_ids,
      all_titles
    FROM dups
  LOOP
    -- Get the array of IDs and titles
    ids_array := dup_record.all_ids;
    keep_id := ids_array[1];
    title_to_keep := dup_record.all_titles[1];
    
    -- Process IDs 2 onwards (the ones to drop)
    FOR i IN 2..array_length(ids_array, 1) LOOP
      drop_id := ids_array[i];
      
      RAISE NOTICE 'Merging "%" (ID %, wikipedia_id: %) into ID % (keeping title: "%")', 
        dup_record.normalized_title, drop_id, 
        CASE WHEN dup_record.wikipedia_id = '' THEN 'NULL/empty' ELSE dup_record.wikipedia_id END, 
        keep_id, title_to_keep;
      
      -- Delete edges that would become duplicates after merge
      -- For person_id updates: delete if (keep_id, event_id) already exists
      DELETE FROM edges 
      WHERE person_id = drop_id 
        AND EXISTS (
          SELECT 1 FROM edges e2 
          WHERE e2.person_id = keep_id 
            AND e2.event_id = edges.event_id
        );
      
      -- For event_id updates: delete if (person_id, keep_id) already exists
      DELETE FROM edges 
      WHERE event_id = drop_id 
        AND EXISTS (
          SELECT 1 FROM edges e2 
          WHERE e2.person_id = edges.person_id 
            AND e2.event_id = keep_id
        );
      
      -- Now update the remaining edges (won't violate constraint)
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
  
  RAISE NOTICE 'Duplicate merge complete! Merged % duplicate nodes.', merged_count;
END $$;

-- Step 3: Verify no duplicates remain (matches your dup.sql query)
SELECT 
  lower(title) as normalized_title,
  COALESCE(wikipedia_id, '') as wikipedia_id,
  count(*) as count
FROM nodes
GROUP BY lower(title), COALESCE(wikipedia_id, '')
HAVING count(*) > 1
ORDER BY count DESC, normalized_title;

-- Should return 0 rows if all duplicates were merged
