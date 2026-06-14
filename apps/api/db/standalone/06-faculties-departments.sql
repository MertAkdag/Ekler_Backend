-- 06 — faculties + departments seed (data only; tables exist in 02-schema).
-- Source: RN migration 20250222200000_faculties_departments.sql. Idempotent.
-- Needed for onboarding faculty/department pickers (empty DB had none).

insert into public.faculties (name) values
  ('Mühendislik Fakültesi'),
  ('Fen-Edebiyat Fakültesi'),
  ('İktisadi ve İdari Bilimler Fakültesi'),
  ('Tıp Fakültesi'),
  ('Hukuk Fakültesi'),
  ('Eğitim Fakültesi'),
  ('Mimarlık Fakültesi'),
  ('Güzel Sanatlar Fakültesi'),
  ('İletişim Fakültesi'),
  ('Diş Hekimliği Fakültesi'),
  ('Eczacılık Fakültesi'),
  ('İlahiyat Fakültesi'),
  ('Sağlık Bilimleri Fakültesi'),
  ('Spor Bilimleri Fakültesi'),
  ('Ziraat Fakültesi'),
  ('Veteriner Fakültesi'),
  ('Teknoloji Fakültesi'),
  ('Turizm Fakültesi'),
  ('Denizcilik Fakültesi'),
  ('Havacılık ve Uzay Bilimleri Fakültesi')
on conflict (name) do nothing;

-- ─── Seed: Bölümler ──────────────────────────────────────────────────────────

-- Mühendislik
with f as (select id from public.faculties where name = 'Mühendislik Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Bilgisayar Mühendisliği', (select id from f), 4),
  ('Yazılım Mühendisliği', (select id from f), 4),
  ('Elektrik-Elektronik Mühendisliği', (select id from f), 4),
  ('Makine Mühendisliği', (select id from f), 4),
  ('İnşaat Mühendisliği', (select id from f), 4),
  ('Endüstri Mühendisliği', (select id from f), 4),
  ('Kimya Mühendisliği', (select id from f), 4),
  ('Biyomedikal Mühendisliği', (select id from f), 4),
  ('Çevre Mühendisliği', (select id from f), 4),
  ('Gıda Mühendisliği', (select id from f), 4),
  ('Metalurji ve Malzeme Mühendisliği', (select id from f), 4),
  ('Mekatronik Mühendisliği', (select id from f), 4),
  ('Havacılık Mühendisliği', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Fen-Edebiyat
with f as (select id from public.faculties where name = 'Fen-Edebiyat Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Matematik', (select id from f), 4),
  ('Fizik', (select id from f), 4),
  ('Kimya', (select id from f), 4),
  ('Biyoloji', (select id from f), 4),
  ('Türk Dili ve Edebiyatı', (select id from f), 4),
  ('Tarih', (select id from f), 4),
  ('Psikoloji', (select id from f), 4),
  ('Sosyoloji', (select id from f), 4),
  ('Felsefe', (select id from f), 4),
  ('İstatistik', (select id from f), 4),
  ('Moleküler Biyoloji ve Genetik', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- İİBF
with f as (select id from public.faculties where name = 'İktisadi ve İdari Bilimler Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('İktisat', (select id from f), 4),
  ('İşletme', (select id from f), 4),
  ('Kamu Yönetimi', (select id from f), 4),
  ('Uluslararası İlişkiler', (select id from f), 4),
  ('Maliye', (select id from f), 4),
  ('Siyaset Bilimi', (select id from f), 4),
  ('Çalışma Ekonomisi', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Tıp (6 yıl)
with f as (select id from public.faculties where name = 'Tıp Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Tıp', (select id from f), 6)
on conflict (faculty_id, name) do nothing;

-- Hukuk
with f as (select id from public.faculties where name = 'Hukuk Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Hukuk', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Eğitim
with f as (select id from public.faculties where name = 'Eğitim Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Bilgisayar ve Öğretim Teknolojileri', (select id from f), 4),
  ('Matematik Öğretmenliği', (select id from f), 4),
  ('Türkçe Öğretmenliği', (select id from f), 4),
  ('İngilizce Öğretmenliği', (select id from f), 4),
  ('Sınıf Öğretmenliği', (select id from f), 4),
  ('Okul Öncesi Öğretmenliği', (select id from f), 4),
  ('Rehberlik ve Psikolojik Danışmanlık', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Mimarlık
with f as (select id from public.faculties where name = 'Mimarlık Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Mimarlık', (select id from f), 4),
  ('Şehir ve Bölge Planlama', (select id from f), 4),
  ('İç Mimarlık', (select id from f), 4),
  ('Peyzaj Mimarlığı', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Diş Hekimliği (5 yıl)
with f as (select id from public.faculties where name = 'Diş Hekimliği Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Diş Hekimliği', (select id from f), 5)
on conflict (faculty_id, name) do nothing;

-- Eczacılık (5 yıl)
with f as (select id from public.faculties where name = 'Eczacılık Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Eczacılık', (select id from f), 5)
on conflict (faculty_id, name) do nothing;

-- İletişim
with f as (select id from public.faculties where name = 'İletişim Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Gazetecilik', (select id from f), 4),
  ('Halkla İlişkiler', (select id from f), 4),
  ('Radyo, TV ve Sinema', (select id from f), 4),
  ('Reklamcılık', (select id from f), 4),
  ('Yeni Medya', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Güzel Sanatlar
with f as (select id from public.faculties where name = 'Güzel Sanatlar Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Grafik Tasarım', (select id from f), 4),
  ('Resim', (select id from f), 4),
  ('Heykel', (select id from f), 4),
  ('Seramik', (select id from f), 4),
  ('Endüstriyel Tasarım', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Sağlık Bilimleri
with f as (select id from public.faculties where name = 'Sağlık Bilimleri Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Hemşirelik', (select id from f), 4),
  ('Fizyoterapi ve Rehabilitasyon', (select id from f), 4),
  ('Beslenme ve Diyetetik', (select id from f), 4),
  ('Ebelik', (select id from f), 4)
on conflict (faculty_id, name) do nothing;

-- Veteriner (5 yıl)
with f as (select id from public.faculties where name = 'Veteriner Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Veteriner Hekimliği', (select id from f), 5)
on conflict (faculty_id, name) do nothing;

-- Teknoloji
with f as (select id from public.faculties where name = 'Teknoloji Fakültesi' limit 1)
insert into public.departments (name, faculty_id, duration_years) values
  ('Bilişim Sistemleri Mühendisliği', (select id from f), 4),
  ('Enerji Sistemleri Mühendisliği', (select id from f), 4),
  ('Otomotiv Mühendisliği', (select id from f), 4)
on conflict (faculty_id, name) do nothing;
