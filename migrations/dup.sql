select lower(title), type, wikipedia_id, count(*)
from nodes
group by 1, 2,3
having count(*) > 1
;
