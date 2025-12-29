-- Simple test: manually merge ONE duplicate to verify the logic works
-- Let's test with Al Pacino specifically

-- Step 1: Show Al Pacino duplicates
SELECT id, title, type, wikipedia_id 
FROM nodes 
WHERE title = 'Al Pacino'
ORDER BY id;

-- Step 2: Manually merge (replace IDs with actual values from step 1)
-- This is a manual test - YOU MUST UPDATE THE IDs below!

-- Example: If Al Pacino has IDs 5 and 265:
-- UPDATE edges SET source = 5 WHERE source = 265;
-- UPDATE edges SET target = 5 WHERE target = 265;
-- UPDATE expansions SET source_id = 5 WHERE source_id = 265;
-- DELETE FROM nodes WHERE id = 265;

-- After running, check again:
-- SELECT id, title, type, wikipedia_id FROM nodes WHERE title = 'Al Pacino';
