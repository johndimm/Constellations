# DANGEROUS MIGRATION SCRIPTS

⚠️ **WARNING**: Some migration scripts in this directory can destroy data if used incorrectly.

## Scripts that MODIFY existing data (use with extreme caution):
- `merge_duplicates*.sql` - These modify data by merging duplicate nodes
- `merge_all_duplicates*.sql` - These modify data by merging duplicates

## Scripts that ADD columns (safe):
- `add_type_internal_column.sql` - Only ADDS a column, doesn't modify existing data

## RECOMMENDED APPROACH:
1. Always backup your database before running any migration
2. Test migrations on a copy of the database first
3. Review the SQL carefully before executing
4. Use scripts with "preserve_types" in the name if you want to keep original types
