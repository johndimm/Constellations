select lower(title)
-- , wikipedia_id
, count(*)
from nodes
group by 1
having count(*) > 1
;
