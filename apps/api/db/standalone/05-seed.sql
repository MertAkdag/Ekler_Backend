-- ============================================================================
-- 05 — seed data (cities + universities + domain aliases)
--
-- The 02 dump is schema-only (empty start), so universities/cities were empty
-- and resolve_university_domain() returned null → EVERY login failed at the
-- university-resolution step ("OTP_INVALID") before the code was even checked.
-- This seeds the reference data so .edu.tr logins resolve. Idempotent.
--
-- Source: RN migration 20250222100000_universities_and_cities.sql.
-- NOTE: university `domain` is the student form already (e.g. ogr.atu.edu.tr).
-- ============================================================================

insert into public.cities (id, name) values
  ('a0000001-0001-4000-8000-000000000001'::uuid, 'Adana'),
  ('a0000002-0001-4000-8000-000000000002'::uuid, 'Ankara'),
  ('a0000003-0001-4000-8000-000000000003'::uuid, 'İstanbul'),
  ('a0000004-0001-4000-8000-000000000004'::uuid, 'İzmir'),
  ('a0000005-0001-4000-8000-000000000005'::uuid, 'Eskişehir'),
  ('a0000006-0001-4000-8000-000000000006'::uuid, 'Bursa'),
  ('a0000007-0001-4000-8000-000000000007'::uuid, 'Kocaeli'),
  ('a0000008-0001-4000-8000-000000000008'::uuid, 'Konya'),
  ('a0000009-0001-4000-8000-000000000009'::uuid, 'Kayseri'),
  ('a000000a-0001-4000-8000-00000000000a'::uuid, 'Trabzon'),
  ('a000000b-0001-4000-8000-00000000000b'::uuid, 'Kahramanmaraş')
on conflict (name) do nothing;

insert into public.universities (id, name, domain, city_id) values
  (gen_random_uuid(), 'Adana Alparslan Türkeş Üniversitesi', 'ogr.atu.edu.tr', (select id from public.cities where name = 'Adana' limit 1)),
  (gen_random_uuid(), 'Çukurova Üniversitesi', 'ogr.cu.edu.tr', (select id from public.cities where name = 'Adana' limit 1)),
  (gen_random_uuid(), 'Orta Doğu Teknik Üniversitesi', 'ogr.metu.edu.tr', (select id from public.cities where name = 'Ankara' limit 1)),
  (gen_random_uuid(), 'Ankara Üniversitesi', 'ogr.ankara.edu.tr', (select id from public.cities where name = 'Ankara' limit 1)),
  (gen_random_uuid(), 'Hacettepe Üniversitesi', 'ogr.hacettepe.edu.tr', (select id from public.cities where name = 'Ankara' limit 1)),
  (gen_random_uuid(), 'Gazi Üniversitesi', 'ogr.gazi.edu.tr', (select id from public.cities where name = 'Ankara' limit 1)),
  (gen_random_uuid(), 'Bilkent Üniversitesi', 'ogr.bilkent.edu.tr', (select id from public.cities where name = 'Ankara' limit 1)),
  (gen_random_uuid(), 'Boğaziçi Üniversitesi', 'ogr.boun.edu.tr', (select id from public.cities where name = 'İstanbul' limit 1)),
  (gen_random_uuid(), 'İstanbul Teknik Üniversitesi', 'ogr.itu.edu.tr', (select id from public.cities where name = 'İstanbul' limit 1)),
  (gen_random_uuid(), 'Yıldız Teknik Üniversitesi', 'ogr.yildiz.edu.tr', (select id from public.cities where name = 'İstanbul' limit 1)),
  (gen_random_uuid(), 'Koç Üniversitesi', 'ogr.ku.edu.tr', (select id from public.cities where name = 'İstanbul' limit 1)),
  (gen_random_uuid(), 'İstanbul Bilgi Üniversitesi', 'ogr.ibu.edu.tr', (select id from public.cities where name = 'İstanbul' limit 1)),
  (gen_random_uuid(), 'Ege Üniversitesi', 'ogr.ege.edu.tr', (select id from public.cities where name = 'İzmir' limit 1)),
  (gen_random_uuid(), 'Dokuz Eylül Üniversitesi', 'ogr.deu.edu.tr', (select id from public.cities where name = 'İzmir' limit 1)),
  (gen_random_uuid(), 'Eskişehir Osmangazi Üniversitesi', 'ogr.ogu.edu.tr', (select id from public.cities where name = 'Eskişehir' limit 1)),
  (gen_random_uuid(), 'Anadolu Üniversitesi', 'ogr.anadolu.edu.tr', (select id from public.cities where name = 'Eskişehir' limit 1)),
  (gen_random_uuid(), 'Uludağ Üniversitesi', 'ogr.uludag.edu.tr', (select id from public.cities where name = 'Bursa' limit 1)),
  (gen_random_uuid(), 'Gebze Teknik Üniversitesi', 'ogr.gtu.edu.tr', (select id from public.cities where name = 'Kocaeli' limit 1)),
  (gen_random_uuid(), 'Selçuk Üniversitesi', 'ogr.selcuk.edu.tr', (select id from public.cities where name = 'Konya' limit 1)),
  (gen_random_uuid(), 'Erciyes Üniversitesi', 'ogr.erciyes.edu.tr', (select id from public.cities where name = 'Kayseri' limit 1)),
  (gen_random_uuid(), 'Karadeniz Teknik Üniversitesi', 'ogr.ktu.edu.tr', (select id from public.cities where name = 'Trabzon' limit 1)),
  (gen_random_uuid(), 'Kahramanmaraş Sütçü İmam Üniversitesi', 'ogr.ksu.edu.tr', (select id from public.cities where name = 'Kahramanmaraş' limit 1))
on conflict (domain) do nothing;
