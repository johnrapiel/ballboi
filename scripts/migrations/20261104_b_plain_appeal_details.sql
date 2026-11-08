-- Appeals filed before Nov 4 carry developer instructions in their Details
-- line (B16). Rewrite them to the plain words new appeals use:
-- "Appeal BB-00012 against a ban. Decide it in Appeals."
-- Text only, and only on appeal rows that still have the old wording, so it
-- runs safely more than once.
UPDATE content_reports
SET details = replace(split_part(details, '. The person was told', 1), 'against a suspend', 'against a suspension')
  || '. Decide it in Appeals.'
WHERE source = 'appeal'
  AND details LIKE '%/api/admin/appeals/%';
