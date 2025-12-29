-- Check the actual schema of edges table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'edges' 
ORDER BY ordinal_position;

-- Also check nodes table for reference
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'nodes' 
ORDER BY ordinal_position;

-- And expansions table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'expansions' 
ORDER BY ordinal_position;
