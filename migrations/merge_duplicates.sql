-- Migration Script: Merge Duplicate Nodes (FIXED - Handle Unique Constraint)
-- This script finds duplicate nodes (same title+type) and merges them
-- Keeps the most complete record (has wikipedia_id) or oldest record

-- Step 1: Find all duplicate groups
SELECT title, type, count(*) as duplicate_count
FROM nodes
GROUP BY title, type
HAVING count(*) > 1
ORDER BY count(*) DESC, title;

-- Step 2: Merge duplicates (CAREFUL: This modifies data!)
DO $$
DECLARE
  dup_record RECORD;
  drop_id INTEGER;
  merged_count INTEGER := 0;
  ids_array INTEGER[];
  keep_id INTEGER;
BEGIN
  -- Find all duplicate groups (exact title+type match)
  FOR dup_record IN
    WITH dups AS (
      SELECT 
        title,
        type,
        array_agg(id ORDER BY 
          CASE WHEN wikipedia_id IS NOT NULL AND wikipedia_id != '' THEN 0 ELSE 1 END,
          id
        ) as all_ids
      FROM nodes
      GROUP BY title, type
      HAVING count(*) > 1
    )
    SELECT 
      title,
      type,
      all_ids
    FROM dups
  LOOP
    -- Get the array of IDs
    ids_array := dup_record.all_ids;
    keep_id := ids_array[1];
    
    -- Process IDs 2 onwards (the ones to drop)
    FOR i IN 2..array_length(ids_array, 1) LOOP
      drop_id := ids_array[i];
      
      RAISE NOTICE 'Merging % "%" (ID %) into ID %', 
        dup_record.type, dup_record.title, drop_id, keep_id;
      
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

-- Step 3: Verify no duplicates remain
SELECT title, type, count(*) as count
FROM nodes
GROUP BY title, type
HAVING count(*) > 1;

-- Should return 0 rows
