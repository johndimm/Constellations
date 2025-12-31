select a.id, b.id, a.title, b.title, a.is_person, b.is_person, a.wikipedia_id, b.wikipedia_id
from nodes a
join nodes b on lower(a.title) = lower(b.title) and a.title != b.title
;
