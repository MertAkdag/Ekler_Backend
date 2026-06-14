-- ============================================================================
-- 04 — catalog crowdsourcing + UGC-safety blocks (P9 Wave E completion)
--
-- These objects existed in Supabase (created by RN migrations
-- 20260318000000_course_catalog_architecture.sql and
-- 20260418110000_ugc_safety_blocked_users_and_policies.sql) but were MISSING from
-- the 02-schema.sql dump, so the standalone DB lacked them. Reproduced verbatim
-- here (idempotent: IF NOT EXISTS / DO $$ guards) so the Node /courses/suggest and
-- /me/blocks endpoints work against our own Postgres after the DATABASE_URL flip.
--
-- Depends on 02-schema (public.courses/departments/faculties/profiles/notifications,
-- auth.users). Safe to re-run.
-- ============================================================================

-- ─── A. COURSE CATALOG ───────────────────────────────────────────────────────

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_dept_code_uni
  ON public.courses (department_id, code, university_domain)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_courses_department
  ON public.courses (department_id)
  WHERE department_id IS NOT NULL;

-- profiles faculty_id / department_id (already present in 02-schema; guarded no-op)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'faculty_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_department
  ON public.profiles (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_faculty
  ON public.profiles (faculty_id) WHERE faculty_id IS NOT NULL;

-- course_suggestions + endorsements
CREATE TABLE IF NOT EXISTS public.course_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (char_length(code) BETWEEN 2 AND 15),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  university_domain text NOT NULL,
  suggested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endorsement_count int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, department_id, university_domain)
);

CREATE TABLE IF NOT EXISTS public.course_suggestion_endorsements (
  suggestion_id uuid NOT NULL REFERENCES public.course_suggestions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (suggestion_id, user_id)
);

ALTER TABLE public.course_suggestions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cs_select_same_university" ON public.course_suggestions FOR SELECT
    USING (university_domain = (SELECT university_domain FROM public.profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cs_insert_own" ON public.course_suggestions FOR INSERT
    WITH CHECK (auth.uid() = suggested_by
      AND university_domain = (SELECT university_domain FROM public.profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cs_update_admin" ON public.course_suggestions FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cs_service_role" ON public.course_suggestions FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.course_suggestion_endorsements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cse_select_same_university" ON public.course_suggestion_endorsements FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.course_suggestions cs WHERE cs.id = suggestion_id
      AND cs.university_domain = (SELECT university_domain FROM public.profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cse_insert_own" ON public.course_suggestion_endorsements FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cse_service_role" ON public.course_suggestion_endorsements FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cs_university_status ON public.course_suggestions (university_domain, status);
CREATE INDEX IF NOT EXISTS idx_cs_department ON public.course_suggestions (department_id);

CREATE OR REPLACE FUNCTION public.auto_approve_course_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_suggestion course_suggestions%ROWTYPE;
  v_endorsement_count int;
BEGIN
  SELECT count(*) INTO v_endorsement_count
  FROM public.course_suggestion_endorsements WHERE suggestion_id = NEW.suggestion_id;

  UPDATE public.course_suggestions SET endorsement_count = v_endorsement_count
  WHERE id = NEW.suggestion_id;

  SELECT * INTO v_suggestion FROM public.course_suggestions WHERE id = NEW.suggestion_id;

  IF v_suggestion.status = 'pending' AND v_endorsement_count >= 3 THEN
    INSERT INTO public.courses (code, name, university_domain, department_id)
    VALUES (v_suggestion.code, v_suggestion.name, v_suggestion.university_domain, v_suggestion.department_id)
    ON CONFLICT (code, university_domain) DO UPDATE SET
      department_id = COALESCE(EXCLUDED.department_id, courses.department_id),
      name = EXCLUDED.name;
    UPDATE public.course_suggestions SET status = 'approved', reviewed_at = now()
    WHERE id = v_suggestion.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_approve_suggestion ON public.course_suggestion_endorsements;
CREATE TRIGGER trg_auto_approve_suggestion
  AFTER INSERT ON public.course_suggestion_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.auto_approve_course_suggestion();

CREATE OR REPLACE FUNCTION public.get_department_courses(
  p_department_id uuid, p_university_domain text, p_search text DEFAULT NULL)
RETURNS TABLE (id uuid, code text, name text, enrolled_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.code, c.name,
    (SELECT count(*) FROM public.user_courses uc WHERE uc.course_id = c.id) AS enrolled_count
  FROM public.courses c
  WHERE c.department_id = p_department_id
    AND c.university_domain = p_university_domain
    AND (p_search IS NULL OR p_search = ''
      OR c.code ILIKE '%' || p_search || '%' OR c.name ILIKE '%' || p_search || '%')
  ORDER BY c.code;
$$;

CREATE OR REPLACE FUNCTION public.suggest_course(
  p_code text, p_name text, p_department_id uuid, p_university_domain text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_course_id uuid;
  v_suggestion_id uuid;
  v_clean_code text := upper(trim(p_code));
  v_clean_name text := trim(p_name);
BEGIN
  IF (SELECT count(*) FROM public.course_suggestions
      WHERE suggested_by = v_user_id AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  SELECT id INTO v_existing_course_id FROM public.courses
  WHERE upper(trim(code)) = v_clean_code AND university_domain = p_university_domain;

  IF v_existing_course_id IS NOT NULL THEN
    UPDATE public.courses SET department_id = p_department_id
    WHERE id = v_existing_course_id AND department_id IS NULL;
    RETURN jsonb_build_object('status', 'already_exists', 'course_id', v_existing_course_id);
  END IF;

  INSERT INTO public.course_suggestions (code, name, department_id, university_domain, suggested_by)
  VALUES (v_clean_code, v_clean_name, p_department_id, p_university_domain, v_user_id)
  ON CONFLICT (code, department_id, university_domain) DO UPDATE SET
    endorsement_count = course_suggestions.endorsement_count
  RETURNING id INTO v_suggestion_id;

  INSERT INTO public.course_suggestion_endorsements (suggestion_id, user_id)
  VALUES (v_suggestion_id, v_user_id) ON CONFLICT (suggestion_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'suggested', 'suggestion_id', v_suggestion_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_course_suggestion(p_suggestion_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_suggestion course_suggestions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Yetkiniz yok' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_suggestion FROM public.course_suggestions WHERE id = p_suggestion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_suggestion.status != 'pending' THEN RETURN jsonb_build_object('status', 'already_reviewed'); END IF;

  IF p_action = 'approve' THEN
    INSERT INTO public.courses (code, name, university_domain, department_id)
    VALUES (v_suggestion.code, v_suggestion.name, v_suggestion.university_domain, v_suggestion.department_id)
    ON CONFLICT (code, university_domain) DO UPDATE SET
      department_id = COALESCE(EXCLUDED.department_id, courses.department_id), name = EXCLUDED.name;
    UPDATE public.course_suggestions SET status = 'approved', reviewed_by = v_admin_id, reviewed_at = now()
    WHERE id = p_suggestion_id;
    RETURN jsonb_build_object('status', 'approved');
  ELSIF p_action = 'reject' THEN
    UPDATE public.course_suggestions SET status = 'rejected', reviewed_by = v_admin_id, reviewed_at = now()
    WHERE id = p_suggestion_id;
    RETURN jsonb_build_object('status', 'rejected');
  ELSE
    RETURN jsonb_build_object('status', 'invalid_action');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_suggestions(p_university_domain text DEFAULT NULL)
RETURNS TABLE (id uuid, code text, name text, department_name text, faculty_name text,
  university_domain text, endorsement_count int, suggested_by_name text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cs.id, cs.code, cs.name, d.name, f.name, cs.university_domain, cs.endorsement_count,
    COALESCE(p.full_name, p.username, 'Anonim'), cs.created_at
  FROM public.course_suggestions cs
  JOIN public.departments d ON d.id = cs.department_id
  JOIN public.faculties f ON f.id = d.faculty_id
  LEFT JOIN public.profiles p ON p.id = cs.suggested_by
  WHERE cs.status = 'pending'
    AND (p_university_domain IS NULL OR cs.university_domain = p_university_domain)
  ORDER BY cs.endorsement_count DESC, cs.created_at ASC;
$$;

-- ─── B. UGC-SAFETY BLOCKS (Apple App Review 1.2) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocked_users_distinct CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocked_users_unique UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users(blocked_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blocked_users_select_own ON public.blocked_users;
CREATE POLICY blocked_users_select_own ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);
DROP POLICY IF EXISTS blocked_users_insert_own ON public.blocked_users;
CREATE POLICY blocked_users_insert_own ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id AND blocker_id <> blocked_id);
DROP POLICY IF EXISTS blocked_users_delete_own ON public.blocked_users;
CREATE POLICY blocked_users_delete_own ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);
DROP POLICY IF EXISTS blocked_users_service_role ON public.blocked_users;
CREATE POLICY blocked_users_service_role ON public.blocked_users FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.is_blocked_between(p_viewer uuid, p_other uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT exists(
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = p_viewer AND blocked_id = p_other)
       OR (blocker_id = p_other AND blocked_id = p_viewer)
  );
$$;

-- O-16: only service_role may write notifications (no self-authored fake system notices)
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_service_only ON public.notifications;
CREATE POLICY notifications_insert_service_only ON public.notifications FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
