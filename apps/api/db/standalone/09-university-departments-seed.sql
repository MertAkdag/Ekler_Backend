-- 09-university-departments-seed.sql
-- =============================================================================
-- Per-university availability of canonical faculties/departments (YÖK Atlas).
-- Pilot universities: Adana (ATÜ, Çukurova) + Kahramanmaraş (KSÜ, İstiklal).
--
-- Idempotent: faculties/departments upserted (on conflict do nothing),
-- university_departments upserted (on conflict do update). Safe to re-run.
-- Each university resolves its domain from public.universities BY NAME (so a
-- wrong hardcoded domain can't be written); fails loudly if the uni is missing.
--
-- Conventions:
--   duration_years: Tıp 6, Diş/Eczacılık/Veteriner 5, önlisans/MYO 2, rest 4.
--   prep_mode: 'zorunlu' for full-English (İngilizce) programs, else 'none'.
--   medium: 'en' (İngilizce), 'mixed' (both TR+EN tracks at the uni),
--           NULL (other language / unspecified, e.g. Almanca/Fransızca/Arapça),
--           'tr' otherwise.
--   Name suffixes stripped to the canonical name: (İngilizce) (KKTC Uyruklu)
--   (M.T.O.K.) (Uzaktan Öğretim) campus parentheticals. Önlisans INCLUDED.
-- =============================================================================

-- ─── ADANA ALPARSLAN TÜRKEŞ B.T.Ü. (ogr.atu.edu.tr) ──────────────────────────
begin;
do $$ begin
  if not exists (select 1 from public.universities where name ilike '%alparslan türkeş%') then
    raise exception 'ATÜ universities tablosunda bulunamadı';
  end if;
end $$;
create temp table _atu(faculty_name text, dept_name text, duration int, prep_mode text, medium text) on commit drop;
insert into _atu values
 ('Bilgisayar ve Bilişim Fakültesi','Yapay Zeka Mühendisliği',4,'zorunlu','en'),
 ('Bilgisayar ve Bilişim Fakültesi','Bilgisayar Mühendisliği',4,'zorunlu','en'),
 ('Bilgisayar ve Bilişim Fakültesi','Yazılım Mühendisliği',4,'zorunlu','en'),
 ('Bilgisayar ve Bilişim Fakültesi','Veri Bilimi ve Analitiği',4,'zorunlu','en'),
 ('Bilgisayar ve Bilişim Fakültesi','Bilişim Sistemleri ve Teknolojileri',4,'none','tr'),
 ('Bilgisayar ve Bilişim Fakültesi','Bilgi Güvenliği Teknolojisi',4,'none','tr'),
 ('Havacılık ve Uzay Bilimleri Fakültesi','Havacılık ve Uzay Mühendisliği',4,'zorunlu','en'),
 ('Havacılık ve Uzay Bilimleri Fakültesi','İklim Bilimi ve Meteoroloji Mühendisliği',4,'zorunlu','en'),
 ('Havacılık ve Uzay Bilimleri Fakültesi','Havacılık Yönetimi',4,'none','tr'),
 ('Mühendislik Fakültesi','Elektrik-Elektronik Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Endüstri Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Makine Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Enerji Sistemleri Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','İnşaat Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Gıda Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Malzeme Bilimi ve Mühendisliği',4,'zorunlu','en'),
 ('Mimarlık ve Tasarım Fakültesi','Mimarlık',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Gastronomi ve Mutfak Sanatları',4,'none','tr'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Psikoloji',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Yönetim Bilişim Sistemleri',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','İşletme',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Uluslararası İlişkiler',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Uluslararası Ticaret ve Finansman',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Siyaset Bilimi ve Kamu Yönetimi',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','Turizm İşletmeciliği',4,'zorunlu','en'),
 ('İktisadi, İdari ve Sosyal Bilimler Fakültesi','İngilizce Mütercim ve Tercümanlık',4,'none','en'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Yapay Zeka Operatörlüğü',2,'none','tr'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Arka-Yüz Yazılım Geliştirme',2,'none','tr'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Büyük Veri Analistliği',2,'none','tr'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Ön-Yüz Yazılım Geliştirme',2,'none','tr'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Bulut Bilişim Operatörlüğü',2,'none','tr'),
 ('Bilişim Teknolojileri Meslek Yüksekokulu','Kurumsal Bilişim Uzmanlığı',2,'none','tr');
insert into public.faculties (name) select distinct faculty_name from _atu on conflict (name) do nothing;
insert into public.departments (name, faculty_id, duration_years)
  select a.dept_name, f.id, a.duration from _atu a join public.faculties f on f.name = a.faculty_name
  on conflict (faculty_id, name) do nothing;
insert into public.university_departments (university_domain, faculty_id, department_id, prep_mode, medium)
  select u.domain, f.id, d.id, a.prep_mode, a.medium
  from _atu a
  join public.faculties f on f.name = a.faculty_name
  join public.departments d on d.faculty_id = f.id and d.name = a.dept_name
  cross join (select domain from public.universities where name ilike '%alparslan türkeş%' limit 1) u
  on conflict (university_domain, department_id) do update
    set faculty_id = excluded.faculty_id, prep_mode = excluded.prep_mode, medium = excluded.medium;
commit;

-- ─── ÇUKUROVA ÜNİVERSİTESİ (ogr.cu.edu.tr) ───────────────────────────────────
begin;
do $$ begin
  if not exists (select 1 from public.universities where name ilike '%ukurova%') then
    raise exception 'Çukurova universities tablosunda bulunamadı';
  end if;
end $$;
create temp table _cu(faculty_name text, dept_name text, duration int, prep_mode text, medium text) on commit drop;
insert into _cu values
 ('Tıp Fakültesi','Tıp',6,'none','tr'),
 ('Diş Hekimliği Fakültesi','Diş Hekimliği',5,'none','tr'),
 ('Eczacılık Fakültesi','Eczacılık',5,'none','tr'),
 ('Mühendislik Fakültesi','Bilgisayar Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Elektrik-Elektronik Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Makine Mühendisliği',4,'zorunlu','en'),
 ('Mühendislik Fakültesi','Endüstri Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','İnşaat Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Otomotiv Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Gıda Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Biyomedikal Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Maden Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Çevre Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Jeoloji Mühendisliği',4,'none','tr'),
 ('Mühendislik Fakültesi','Tekstil Mühendisliği',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Hemşirelik',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Ebelik',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Beslenme ve Diyetetik',4,'zorunlu','en'),
 ('Ceyhan Veteriner Fakültesi','Veteriner',5,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Yapay Zeka ve Makine Öğrenmesi',4,'zorunlu','en'),
 ('Fen-Edebiyat Fakültesi','Matematik',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Bilgisayar Bilimleri',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Kimya',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','İstatistik',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Fizik',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Biyoloji',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Türk Dili ve Edebiyatı',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Psikoloji',4,'none','tr'),
 ('Fen-Edebiyat Fakültesi','Arkeoloji',4,'none','tr'),
 ('Mimarlık Fakültesi','Mimarlık',4,'none','tr'),
 ('Mimarlık Fakültesi','İç Mimarlık',4,'none','tr'),
 ('Mimarlık Fakültesi','Peyzaj Mimarlığı',4,'none','tr'),
 ('Eğitim Fakültesi','İlköğretim Matematik Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Bilgisayar ve Öğretim Teknolojileri Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Fen Bilgisi Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Okul Öncesi Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Türkçe Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Sosyal Bilgiler Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Sınıf Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Rehberlik ve Psikolojik Danışmanlık',4,'none','tr'),
 ('Eğitim Fakültesi','Felsefe Grubu Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','İngilizce Öğretmenliği',4,'none','en'),
 ('Eğitim Fakültesi','Almanca Öğretmenliği',4,'none',NULL),
 ('Eğitim Fakültesi','Fransızca Öğretmenliği',4,'none',NULL),
 ('Ceyhan Mühendislik Fakültesi','Makine Mühendisliği',4,'none','tr'),
 ('Ziraat Fakültesi','Bitki Koruma',4,'none','tr'),
 ('Ziraat Fakültesi','Bahçe Bitkileri',4,'none','tr'),
 ('Ziraat Fakültesi','Tarla Bitkileri',4,'none','tr'),
 ('Ziraat Fakültesi','Tarım Makineleri ve Teknolojileri Mühendisliği',4,'none','tr'),
 ('Ziraat Fakültesi','Toprak Bilimi ve Bitki Besleme',4,'none','tr'),
 ('Ziraat Fakültesi','Tarımsal Yapılar ve Sulama',4,'none','tr'),
 ('Ziraat Fakültesi','Zootekni',4,'none','tr'),
 ('Ziraat Fakültesi','Tarım Ekonomisi',4,'none','tr'),
 ('Su Ürünleri Fakültesi','Su Ürünleri Mühendisliği',4,'none','tr'),
 ('İletişim Fakültesi','Radyo, Televizyon ve Sinema',4,'none','tr'),
 ('İletişim Fakültesi','İletişim Bilimleri',4,'none','tr'),
 ('İletişim Fakültesi','Gazetecilik',4,'none','tr'),
 ('İlahiyat Fakültesi','İlahiyat',4,'none','tr'),
 ('Hukuk Fakültesi','Hukuk',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','İşletme',4,'none','mixed'),
 ('İktisadi ve İdari Bilimler Fakültesi','Siyaset Bilimi ve Uluslararası İlişkiler',4,'none','mixed'),
 ('İktisadi ve İdari Bilimler Fakültesi','İktisat',4,'none','mixed'),
 ('İktisadi ve İdari Bilimler Fakültesi','Ekonometri',4,'none','mixed'),
 ('İktisadi ve İdari Bilimler Fakültesi','Maliye',4,'none','tr'),
 ('Güzel Sanatlar Fakültesi','Grafik',4,'none','tr'),
 ('Kozan İşletme Fakültesi','İşletme',4,'none','tr'),
 ('Spor Bilimleri Fakültesi','Spor Yöneticiliği',4,'none','tr'),
 -- Önlisans / MYO
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Görüntüleme Teknikleri',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','İlk ve Acil Yardım',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Anestezi',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Ağız ve Diş Sağlığı',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Diş Protez Teknolojisi',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Laboratuvar Teknikleri',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Veri İşleme Teknikerliği',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Fizyoterapi',2,'none','tr'),
 ('Abdi Sütcü Sağlık Hizmetleri Meslek Yüksekokulu','Yaşlı Bakımı',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Çocuk Gelişimi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Elektrik',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Otomotiv Teknolojisi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','İç Mekan Tasarımı',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Elektronik Teknolojisi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Saç Bakımı ve Güzellik Hizmetleri',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Makine',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','İnşaat Teknolojisi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','İklimlendirme ve Soğutma Teknolojisi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Turizm ve Seyahat Hizmetleri',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Moda Tasarımı',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Emlak Yönetimi',2,'none','tr'),
 ('Adana Meslek Yüksekokulu','Tekstil Teknolojisi',2,'none','tr'),
 ('Aladağ Meslek Yüksekokulu','Ormancılık ve Orman Ürünleri',2,'none','tr'),
 ('Aladağ Meslek Yüksekokulu','Avcılık ve Yaban Hayatı',2,'none','tr'),
 ('Aladağ Meslek Yüksekokulu','Madencilik Teknolojisi',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Sivil Savunma ve İtfaiyecilik',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Büro Yönetimi ve Yönetici Asistanlığı',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Elektrik',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','İnşaat Teknolojisi',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Pazarlama',2,'none','tr'),
 ('Ceyhan Meslek Yüksekokulu','Tarım Makineleri',2,'none','tr'),
 ('İmamoğlu Meslek Yüksekokulu','Laboratuvar Teknolojisi',2,'none','tr'),
 ('İmamoğlu Meslek Yüksekokulu','Bilgisayar Teknolojisi',2,'none','tr'),
 ('İmamoğlu Meslek Yüksekokulu','Doğalgaz ve Tesisatı Teknolojisi',2,'none','tr'),
 ('Adana Organize Sanayi Bölgesi Teknik Bilimler Meslek Yüksekokulu','Elektrik',2,'none','tr'),
 ('Adana Organize Sanayi Bölgesi Teknik Bilimler Meslek Yüksekokulu','Makine',2,'none','tr'),
 ('Adana Organize Sanayi Bölgesi Teknik Bilimler Meslek Yüksekokulu','Elektronik Teknolojisi',2,'none','tr'),
 ('Adana Organize Sanayi Bölgesi Teknik Bilimler Meslek Yüksekokulu','Coğrafi Bilgi Sistemleri',2,'none','tr'),
 ('Adana Organize Sanayi Bölgesi Teknik Bilimler Meslek Yüksekokulu','Tekstil Teknolojisi',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','İş Sağlığı ve Güvenliği',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Harita ve Kadastro',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Cnc Programlama ve Operatörlüğü',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Bilgisayar Destekli Tasarım ve Animasyon',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Tıbbi ve Aromatik Bitkiler',2,'none','tr'),
 ('Karaisalı Meslek Yüksekokulu','Seracılık',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Bankacılık ve Sigortacılık',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Ofis Teknolojileri ve Veri Yönetimi',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Bahçe Tarımı',2,'none','tr'),
 ('Kozan Meslek Yüksekokulu','Yerel Yönetimler',2,'none','tr'),
 ('Yumurtalık Meslek Yüksekokulu','Su Altı Teknolojisi',2,'none','tr'),
 ('Yumurtalık Meslek Yüksekokulu','Dış Ticaret',2,'none','tr'),
 ('Yumurtalık Meslek Yüksekokulu','Turizm ve Otel İşletmeciliği',2,'none','tr'),
 ('Yumurtalık Meslek Yüksekokulu','Organik Tarım',2,'none','tr'),
 ('Pozantı Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Pozantı Meslek Yüksekokulu','Turizm ve Otel İşletmeciliği',2,'none','tr'),
 ('Pozantı Meslek Yüksekokulu','Bahçe Tarımı',2,'none','tr'),
 ('Tufanbeyli Meslek Yüksekokulu','Elektrik Enerjisi Üretim, İletim ve Dağıtımı',2,'none','tr');
insert into public.faculties (name) select distinct faculty_name from _cu on conflict (name) do nothing;
insert into public.departments (name, faculty_id, duration_years)
  select c.dept_name, f.id, c.duration from _cu c join public.faculties f on f.name = c.faculty_name
  on conflict (faculty_id, name) do nothing;
insert into public.university_departments (university_domain, faculty_id, department_id, prep_mode, medium)
  select u.domain, f.id, d.id, c.prep_mode, c.medium
  from _cu c
  join public.faculties f on f.name = c.faculty_name
  join public.departments d on d.faculty_id = f.id and d.name = c.dept_name
  cross join (select domain from public.universities where name ilike '%ukurova%' limit 1) u
  on conflict (university_domain, department_id) do update
    set faculty_id = excluded.faculty_id, prep_mode = excluded.prep_mode, medium = excluded.medium;
commit;

-- ─── KAHRAMANMARAŞ SÜTÇÜ İMAM ÜNİVERSİTESİ ───────────────────────────────────
begin;
do $$ begin
  if not exists (select 1 from public.universities where name ilike '%sütçü imam%') then
    raise exception 'KSÜ universities tablosunda bulunamadı';
  end if;
end $$;
create temp table _ksu(faculty_name text, dept_name text, duration int, prep_mode text, medium text) on commit drop;
insert into _ksu values
 ('Tıp Fakültesi','Tıp',6,'none','tr'),
 ('Diş Hekimliği Fakültesi','Diş Hekimliği',5,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Hemşirelik',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Ebelik',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Fizyoterapi ve Rehabilitasyon',4,'none','tr'),
 ('Afşin Sağlık Yüksekokulu','Hemşirelik',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','Bilgisayar Mühendisliği',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','İnşaat Mühendisliği',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','Makine Mühendisliği',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','Elektrik-Elektronik Mühendisliği',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','Gıda Mühendisliği',4,'none','tr'),
 ('Mühendislik-Mimarlık Fakültesi','Tekstil Mühendisliği',4,'none','tr'),
 ('Eğitim Fakültesi','İlköğretim Matematik Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Fen Bilgisi Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Okul Öncesi Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Türkçe Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Sosyal Bilgiler Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Sınıf Öğretmenliği',4,'none','tr'),
 ('Eğitim Fakültesi','Rehberlik ve Psikolojik Danışmanlık',4,'none','tr'),
 ('Eğitim Fakültesi','İngilizce Öğretmenliği',4,'none','en'),
 ('Orman Fakültesi','Orman Mühendisliği',4,'none','tr'),
 ('Orman Fakültesi','Orman Endüstrisi Mühendisliği',4,'none','tr'),
 ('Orman Fakültesi','Peyzaj Mimarlığı',4,'none','tr'),
 ('Fen Fakültesi','Matematik',4,'none','tr'),
 ('Fen Fakültesi','Kimya',4,'none','tr'),
 ('Fen Fakültesi','Biyoloji',4,'none','tr'),
 ('Ziraat Fakültesi','Bitki Koruma',4,'none','tr'),
 ('Ziraat Fakültesi','Bahçe Bitkileri',4,'none','tr'),
 ('Ziraat Fakültesi','Biyosistem Mühendisliği',4,'none','tr'),
 ('Ziraat Fakültesi','Tarla Bitkileri',4,'none','tr'),
 ('Ziraat Fakültesi','Toprak Bilimi ve Bitki Besleme',4,'none','tr'),
 ('Ziraat Fakültesi','Zootekni',4,'none','tr'),
 ('Ziraat Fakültesi','Tarım Ekonomisi',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Türk Dili ve Edebiyatı',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Tarih',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Coğrafya',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Psikoloji',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Arkeoloji',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Felsefe',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','İngilizce Mütercim ve Tercümanlık',4,'none','en'),
 ('İlahiyat Fakültesi','İlahiyat',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','Sosyal Hizmet',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','Sağlık Yönetimi',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','İşletme',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','Uluslararası Ticaret ve Lojistik',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','Kamu Yönetimi',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','İktisat',4,'none','tr'),
 ('İktisadi ve İdari Bilimler Fakültesi','Siyaset Bilimi ve Uluslararası İlişkiler',4,'none','tr'),
 ('Spor Bilimleri Fakültesi','Spor Yöneticiliği',4,'none','tr'),
 ('Güzel Sanatlar Fakültesi','Tekstil ve Moda Tasarımı',4,'none','tr'),
 ('Göksun Uygulamalı Bilimler Yüksekokulu','Finans ve Bankacılık',4,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','İlk ve Acil Yardım',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Anestezi',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Görüntüleme Teknikleri',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Dokümantasyon ve Sekreterlik',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Tıbbi Laboratuvar Teknikleri',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Fizyoterapi',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Optisyenlik',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Çocuk Gelişimi',2,'none','tr'),
 ('Kahramanmaraş Sağlık Hizmetleri Meslek Yüksekokulu','Yaşlı Bakımı',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','İlk ve Acil Yardım',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Tapu ve Kadastro',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Çocuk Gelişimi',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Harita ve Kadastro',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Bankacılık ve Sigortacılık',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Dış Ticaret',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','İşletme Yönetimi',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Göksun Meslek Yüksekokulu','Organik Tarım',2,'none','tr'),
 ('Andırın Meslek Yüksekokulu','Ormancılık ve Orman Ürünleri',2,'none','tr'),
 ('Andırın Meslek Yüksekokulu','Elektrik Enerjisi Üretim, İletim ve Dağıtımı',2,'none','tr'),
 ('Andırın Meslek Yüksekokulu','Yapı Denetimi',2,'none','tr'),
 ('Andırın Meslek Yüksekokulu','Madencilik Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Elektrik',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Makine',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','İnşaat Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Bilgisayar Destekli Tasarım ve Animasyon',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Otomotiv Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Elektronik Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Gıda Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Mimari Restorasyon',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','İklimlendirme ve Soğutma Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Kuyumculuk ve Takı Tasarımı',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Moda Tasarımı',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Tekstil Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Doğalgaz ve Tesisatı Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Mobilya ve Dekorasyon',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Giyim Üretim Teknolojisi',2,'none','tr'),
 ('Teknik Bilimler Meslek Yüksekokulu','Geleneksel El Sanatları',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Büro Yönetimi ve Yönetici Asistanlığı',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Aşçılık',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Bankacılık ve Sigortacılık',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Turizm ve Otel İşletmeciliği',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Çağrı Merkezi Hizmetleri',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Maliye',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','İşletme Yönetimi',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Halkla İlişkiler ve Tanıtım',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Lojistik',2,'none','tr'),
 ('Sosyal Bilimler Meslek Yüksekokulu','Pazarlama',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','İş Sağlığı ve Güvenliği',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','Büro Yönetimi ve Yönetici Asistanlığı',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','Bilgisayar Programcılığı',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','Kimya Teknolojisi',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Afşin Meslek Yüksekokulu','Madencilik Teknolojisi',2,'none','tr'),
 ('Pazarcık Meslek Yüksekokulu','Çağrı Merkezi Hizmetleri',2,'none','tr'),
 ('Pazarcık Meslek Yüksekokulu','Sosyal Güvenlik',2,'none','tr'),
 ('Pazarcık Meslek Yüksekokulu','Dış Ticaret',2,'none','tr'),
 ('Pazarcık Meslek Yüksekokulu','Yerel Yönetimler',2,'none','tr');
insert into public.faculties (name) select distinct faculty_name from _ksu on conflict (name) do nothing;
insert into public.departments (name, faculty_id, duration_years)
  select k.dept_name, f.id, k.duration from _ksu k join public.faculties f on f.name = k.faculty_name
  on conflict (faculty_id, name) do nothing;
insert into public.university_departments (university_domain, faculty_id, department_id, prep_mode, medium)
  select u.domain, f.id, d.id, k.prep_mode, k.medium
  from _ksu k
  join public.faculties f on f.name = k.faculty_name
  join public.departments d on d.faculty_id = f.id and d.name = k.dept_name
  cross join (select domain from public.universities where name ilike '%sütçü imam%' limit 1) u
  on conflict (university_domain, department_id) do update
    set faculty_id = excluded.faculty_id, prep_mode = excluded.prep_mode, medium = excluded.medium;
commit;

-- ─── KAHRAMANMARAŞ İSTİKLAL ÜNİVERSİTESİ ─────────────────────────────────────
begin;
do $$ begin
  if not exists (select 1 from public.universities where name ilike '%istiklal%') then
    raise exception 'Kahramanmaraş İstiklal universities tablosunda bulunamadı';
  end if;
end $$;
create temp table _ist(faculty_name text, dept_name text, duration int, prep_mode text, medium text) on commit drop;
insert into _ist values
 ('Sağlık Bilimleri Fakültesi','Hemşirelik',4,'none','tr'),
 ('Sağlık Bilimleri Fakültesi','Beslenme ve Diyetetik',4,'none','tr'),
 ('Mühendislik, Mimarlık ve Tasarım Fakültesi','Yazılım Mühendisliği',4,'none','tr'),
 ('Mühendislik, Mimarlık ve Tasarım Fakültesi','Endüstri Mühendisliği',4,'none','tr'),
 ('Mühendislik, Mimarlık ve Tasarım Fakültesi','Makine Mühendisliği',4,'none','tr'),
 ('İletişim Fakültesi','Dijital Oyun Tasarımı',4,'none','tr'),
 ('İletişim Fakültesi','Görsel İletişim Tasarımı',4,'none','tr'),
 ('Turizm Fakültesi','Gastronomi ve Mutfak Sanatları',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Türk Dili ve Edebiyatı',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Tarih',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','Psikoloji',4,'none','tr'),
 ('İnsan ve Toplum Bilimleri Fakültesi','İngilizce Mütercim ve Tercümanlık',4,'none','en'),
 ('İslami İlimler Fakültesi','İslami İlimler',4,'none',NULL),
 ('Airbus-Tusaş Havacılık Meslek Yüksekokulu','Uçak Teknolojisi',2,'none','tr'),
 ('Airbus-Tusaş Havacılık Meslek Yüksekokulu','Makine',2,'none','tr'),
 ('Airbus-Tusaş Havacılık Meslek Yüksekokulu','Metalurji',2,'none','tr'),
 ('Elbistan Sağlık Hizmetleri Meslek Yüksekokulu','Eczane Hizmetleri',2,'none','tr'),
 ('Elbistan Sağlık Hizmetleri Meslek Yüksekokulu','Optisyenlik',2,'none','tr'),
 ('Elbistan Sağlık Hizmetleri Meslek Yüksekokulu','Yaşlı Bakımı',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Sivil Savunma ve İtfaiyecilik',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Özel Güvenlik ve Koruma',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Alternatif Enerji Kaynakları Teknolojisi',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Kimya Teknolojisi',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Lojistik',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Gıda Kalite Kontrolü ve Analizi',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Gıda Teknolojisi',2,'none','tr'),
 ('Türkoğlu Meslek Yüksekokulu','Tekstil Teknolojisi',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Sivil Savunma ve İtfaiyecilik',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Laborant ve Veteriner Sağlık',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Elektrik',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Muhasebe ve Vergi Uygulamaları',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Elektronik Teknolojisi',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Otomotiv Teknolojisi',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Makine',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','İnşaat Teknolojisi',2,'none','tr'),
 ('Elbistan Meslek Yüksekokulu','Ofis Teknolojileri ve Veri Yönetimi',2,'none','tr');
insert into public.faculties (name) select distinct faculty_name from _ist on conflict (name) do nothing;
insert into public.departments (name, faculty_id, duration_years)
  select i.dept_name, f.id, i.duration from _ist i join public.faculties f on f.name = i.faculty_name
  on conflict (faculty_id, name) do nothing;
insert into public.university_departments (university_domain, faculty_id, department_id, prep_mode, medium)
  select u.domain, f.id, d.id, i.prep_mode, i.medium
  from _ist i
  join public.faculties f on f.name = i.faculty_name
  join public.departments d on d.faculty_id = f.id and d.name = i.dept_name
  cross join (select domain from public.universities where name ilike '%istiklal%' limit 1) u
  on conflict (university_domain, department_id) do update
    set faculty_id = excluded.faculty_id, prep_mode = excluded.prep_mode, medium = excluded.medium;
commit;
