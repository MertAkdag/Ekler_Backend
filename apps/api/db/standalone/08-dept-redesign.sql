-- 08-dept-redesign.sql
-- Department-first redesign (2026-06-16). Idempotent — safe to re-run.
-- Doubles as the LIVE-PROD forward migration (apply once on the running DB) AND
-- the fresh-install delta (wired into setup.sh after 02/04/06).
--
-- Locked decisions:
--   A) Hazırlık = year 0 accepted everywhere (relax year_of_study CHECK to >= 0).
--   B) Courses leave the UI but the door stays open in the DB: keep `courses`,
--      keep course_id as a NULLABLE tag on notes/study_sessions. Notes/Radar now
--      scope by department_id. Crowdsource catalog (suggestions) is torn down.
--   C) No department versioning — canonical departments, in-place renames, PK stable.
--   Prep state + medium-of-instruction live on the NEW university_departments
--      availability row, NOT on the canonical departments table.
-- ---------------------------------------------------------------------------

-- A) ------------------------------------------------------------------------
-- year 0 = Hazırlık. Relax the CHECK (live DB still has the >= 1 version).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_year_of_study_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_year_of_study_check
  CHECK ((year_of_study IS NULL) OR ((year_of_study >= 0) AND (year_of_study <= 6)));

-- B-foundation) -------------------------------------------------------------
-- Per-university availability: which canonical faculties/departments a given
-- university actually offers, plus per-uni prep state and medium of instruction.
-- Canonical departments stay global (clean for cross-university GROUP BY).
CREATE TABLE IF NOT EXISTS public.university_departments (
    university_domain text NOT NULL,
    faculty_id        uuid NOT NULL,
    department_id     uuid NOT NULL,
    -- per-university prep policy for this department
    prep_mode         text NOT NULL DEFAULT 'none',
    -- medium of instruction: null = single track / unspecified
    medium            text,
    CONSTRAINT university_departments_pkey PRIMARY KEY (university_domain, department_id),
    CONSTRAINT university_departments_prep_mode_check
        CHECK (prep_mode = ANY (ARRAY['none'::text, 'zorunlu'::text, 'optional'::text, 'sartli'::text])),
    CONSTRAINT university_departments_medium_check
        CHECK ((medium IS NULL) OR (medium = ANY (ARRAY['tr'::text, 'en'::text, 'mixed'::text])))
);

COMMENT ON TABLE public.university_departments IS
  'Per-university availability of canonical faculties/departments (YÖK import). prep_mode + medium are per-university.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'university_departments_university_domain_fkey') THEN
    ALTER TABLE public.university_departments
      ADD CONSTRAINT university_departments_university_domain_fkey
      FOREIGN KEY (university_domain) REFERENCES public.universities(domain) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'university_departments_faculty_id_fkey') THEN
    ALTER TABLE public.university_departments
      ADD CONSTRAINT university_departments_faculty_id_fkey
      FOREIGN KEY (faculty_id) REFERENCES public.faculties(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'university_departments_department_id_fkey') THEN
    ALTER TABLE public.university_departments
      ADD CONSTRAINT university_departments_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;
  END IF;
END $$;

-- onboarding/filter hot path: faculties + departments available for a domain
CREATE INDEX IF NOT EXISTS idx_university_departments_domain_faculty
  ON public.university_departments USING btree (university_domain, faculty_id);

-- notes: course_id becomes a nullable tag; department_id is the new scope key.
ALTER TABLE public.notes ALTER COLUMN course_id DROP NOT NULL;
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_course_id_fkey;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS department_id uuid;
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_department_id_fkey;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notes_department
  ON public.notes USING btree (department_id) WHERE (department_id IS NOT NULL);

-- study_sessions: course_id already nullable; add department_id scope key.
ALTER TABLE public.study_sessions ADD COLUMN IF NOT EXISTS department_id uuid;
ALTER TABLE public.study_sessions DROP CONSTRAINT IF EXISTS study_sessions_department_id_fkey;
ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_study_sessions_department
  ON public.study_sessions USING btree (department_id) WHERE (department_id IS NOT NULL);

-- C) crowdsource teardown --------------------------------------------------
-- Drop the suggestion/endorsement machinery. KEEP the `courses` table (future
-- admin-curated catalog) so the course_id tag FK stays valid.
DROP TRIGGER IF EXISTS trg_auto_approve_suggestion ON public.course_suggestion_endorsements;
DROP FUNCTION IF EXISTS public.auto_approve_course_suggestion() CASCADE;
DROP FUNCTION IF EXISTS public.suggest_course(text, text, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_department_courses(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_approve_course_suggestion(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_pending_suggestions() CASCADE;
DROP TABLE IF EXISTS public.course_suggestion_endorsements CASCADE;
DROP TABLE IF EXISTS public.course_suggestions CASCADE;

-- NOTE: `courses` and `user_courses` tables are intentionally KEPT (empty, no
-- API surface in v1). They stay valid FK targets for the course_id tag and the
-- future admin-curated catalog. Only the crowdsource layer above is removed.
