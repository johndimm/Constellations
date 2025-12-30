-- Migration Script: Merge Duplicate Nodes with Same wikipedia_id
-- This script finds duplicate nodes with the same wikipedia_id (case-insensitive title matching)
-- and merges them, keeping the most complete record

-- Step 1: Check for duplicates with same wikipedia_id (case-insensitive title)
SELECT 
  lower(title) as normalized_title,
  type,
  wikipedia_id,
  array_agg(id ORDER BY 
    CASE WHEN title = initcap(title) OR title = upper(title) OR title = lower(title) THEN 0 ELSE 1 END,
    id
  ) as all_ids,
  count(*) as duplicate_count
FROM nodes
WHERE wikipedia_id IS NOT NULL AND wikipedia_id != ''
GROUP BY lower(title), type, wikipedia_id
HAVING count(*) > 1
ORDER BY duplicate_count DESC, normalized_title;

-- Step 2: Merge duplicates (CAREFUL: This modifies data!)
DO $$
DECLARE
  dup_record RECORD;
  drop_id INTEGER;
  merged_count INTEGER := 0;
  ids_array INTEGER[];
  keep_id INTEGER;
BEGIN
  -- Find all duplicate groups (case-insensitive title + type + wikipedia_id)
  FOR dup_record IN
    WITH dups AS (
      SELECT 
        lower(title) as normalized_title,
        type,
        wikipedia_id,
        array_agg(id ORDER BY 
          -- Prefer properly cased titles, then oldest
          CASE 
            WHEN title ~ '^[A-Z][a-z]' THEN 0  -- Title case
            WHEN title = upper(title) THEN 1   -- ALL CAPS
            WHEN title = lower(title) THEN 2   -- all lowercase
            ELSE 3                             -- Mixed case
          END,
          id
        ) as all_ids
      FROM nodes
      WHERE wikipedia_id IS NOT NULL AND wikipedia_id != ''
      GROUP BY lower(title), type, wikipedia_id
      HAVING count(*) > 1
    )
    SELECT 
      normalized_title,
      type,
      wikipedia_id,
      all_ids
    FROM dups
  LOOP
    -- Get the array of IDs
    ids_array := dup_record.all_ids;
    keep_id := ids_array[1];
    
    -- Process IDs 2 onwards (the ones to drop)
    FOR i IN 2..array_length(ids_array, 1) LOOP
      drop_id := ids_array[i];
      
      RAISE NOTICE 'Merging % "%" (ID %, wikipedia_id: %) into ID %', 
        dup_record.type, dup_record.normalized_title, drop_id, dup_record.wikipedia_id, keep_id;
      
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
      
      -- Update any expansions cache if it exists
      -- (Add this if you have an expansions table)
      -- UPDATE expansions SET source_id = keep_id WHERE source_id = drop_id;
      
      -- Delete the duplicate node
      DELETE FROM nodes WHERE id = drop_id;
      
      merged_count := merged_count + 1;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Duplicate merge complete! Merged % duplicate nodes with same wikipedia_id.', merged_count;
END $$;

-- Step 3: Verify no duplicates remain with same wikipedia_id
SELECT 
  lower(title) as normalized_title,
  type,
  wikipedia_id,
  count(*) as count
FROM nodes
WHERE wikipedia_id IS NOT NULL AND wikipedia_id != ''
GROUP BY lower(title), type, wikipedia_id
HAVING count(*) > 1;

-- Should return 0 rows
