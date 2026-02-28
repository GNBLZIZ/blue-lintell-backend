-- Update athletes with correct Instagram usernames (run in Supabase SQL Editor).
-- Instagram handles often differ from Twitter; wrong username → Apify returns no data → null in dashboard.
UPDATE athletes SET instagram_business_id = 'marcusrashford'   WHERE name = 'Marcus Rashford';
UPDATE athletes SET instagram_business_id = 'ktrippier2'        WHERE name = 'Kieran Trippier';
UPDATE athletes SET instagram_business_id = 'erling.haaland'     WHERE name = 'Erling Haaland';
UPDATE athletes SET instagram_business_id = 'mohamed_salah.official' WHERE name = 'Mo Salah';
UPDATE athletes SET instagram_business_id = 'bukayosaka87'      WHERE name = 'Bukayo Saka';
