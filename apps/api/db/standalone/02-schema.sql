--
-- PostgreSQL database dump
--

\restrict 4dPxp6zr6eewxCYBTQpkxqtBXlntB3bttMpzYcAimD9fOA58AVtwf2tKfGPVmdG

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: admin_effective_permissions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_effective_permissions(p_identity_id uuid) RETURNS TABLE(permission_key text, approval_mode text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with role_permissions as (
    select rp.permission_key
    from public.admin_role_bindings rb
    join public.admin_role_permissions rp on rp.role_id = rb.role_id
    where rb.identity_id = p_identity_id
  )
  select ap.permission_key, ap.approval_mode
  from public.admin_permissions ap
  where ap.permission_key in (select permission_key from role_permissions)
$$;


--
-- Name: admin_has_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_has_permission(p_identity_id uuid, p_permission_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.admin_effective_permissions(p_identity_id)
    where permission_key = p_permission_key
  );
$$;


--
-- Name: check_comment_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_comment_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT count(*) INTO recent_count
  FROM public.confession_comments
  WHERE author_id = NEW.author_id
    AND created_at > now() - interval '1 minute';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Çok hızlı yorum — lütfen biraz bekleyin'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: check_confession_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_confession_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT count(*) INTO recent_count
  FROM public.confessions
  WHERE author_id = NEW.author_id
    AND created_at > now() - interval '1 minute';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'Çok hızlı gönderim — lütfen biraz bekleyin'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: check_note_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_note_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    DECLARE
      recent_count INT;
      note_author UUID;
    BEGIN
      note_author := COALESCE(
        NULLIF((to_jsonb(NEW)->>'author_id'), '')::uuid,
        NULLIF((to_jsonb(NEW)->>'uploader_id'), '')::uuid
      );

      IF note_author IS NULL THEN
        RAISE EXCEPTION 'Not sahibi belirlenemedi.'
          USING ERRCODE = 'P0001';
      END IF;

      SELECT count(*) INTO recent_count
      FROM public.notes n
      WHERE COALESCE(
        NULLIF((to_jsonb(n)->>'author_id'), '')::uuid,
        NULLIF((to_jsonb(n)->>'uploader_id'), '')::uuid
      ) = note_author
        AND n.created_at > now() - interval '5 minutes';

      IF recent_count >= 5 THEN
        RAISE EXCEPTION 'Çok hızlı yükleme — lütfen biraz bekleyin'
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END;
    $$;


--
-- Name: create_confession_comment_v2(uuid, text, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_confession_comment_v2(p_confession_id uuid, p_body text, p_is_anonymous boolean, p_reply_to uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_confession record;
  v_eval record;
  v_comment_id uuid;
  v_trimmed_body text := btrim(coalesce(p_body, ''));
  v_comment_row record;
begin
  if v_user_id is null then
    raise exception 'Yetkisiz istek.'
      using errcode = 'P0001';
  end if;

  if v_trimmed_body = '' then
    raise exception 'Yorum boş olamaz.'
      using errcode = 'P0001';
  end if;

  if char_length(v_trimmed_body) > 300 then
    raise exception 'Yorum en fazla 300 karakter olabilir.'
      using errcode = 'P0001';
  end if;

  if public.is_user_banned(v_user_id) or public.is_user_restricted(v_user_id) then
    raise exception 'Hesabın şu an Kürsü yorumu yapamıyor.'
      using errcode = 'P0001';
  end if;

  select c.id, c.author_id, c.university_domain
  into v_confession
  from public.confessions c
  where c.id = p_confession_id
    and c.hidden_at is null
    and coalesce(c.moderation_status, 'published') = 'published'
    and c.university_domain = (
      select p.university_domain from public.profiles p where p.id = v_user_id
    )
  limit 1;

  if not found then
    raise exception 'Gönderi bulunamadı veya yorumlanamıyor.'
      using errcode = 'P0001';
  end if;

  if p_reply_to is not null and not exists (
    select 1
    from public.confession_comments cc
    where cc.id = p_reply_to
      and cc.confession_id = p_confession_id
  ) then
    raise exception 'Yanıtlanacak yorum bulunamadı.'
      using errcode = 'P0001';
  end if;

  if public.normalize_moderation_text(v_trimmed_body) <> '' and exists (
    select 1
    from public.confession_comments cc
    where cc.author_id = v_user_id
      and cc.normalized_body = public.normalize_moderation_text(v_trimmed_body)
      and cc.created_at > now() - interval '10 minutes'
  ) then
    perform public.record_moderation_scan_log(
      p_content_scope => 'kursu_comment',
      p_content_id => null,
      p_actor_user_id => v_user_id,
      p_decision => 'block',
      p_moderation_label => 'mass_repeat',
      p_matched_rule_ids => '{}'::uuid[],
      p_source => 'kursu_create',
      p_preview_text => v_trimmed_body
    );

    return jsonb_build_object(
      'status', 'blocked',
      'moderation_status', 'blocked',
      'moderation_label', 'mass_repeat',
      'message', 'Benzer içerik çok sık gönderiliyor.'
    );
  end if;

  select * into v_eval
  from public.evaluate_moderation_rules('kursu_comment', v_trimmed_body);

  if v_eval.decision = 'block' then
    perform public.record_moderation_scan_log(
      p_content_scope => 'kursu_comment',
      p_content_id => null,
      p_actor_user_id => v_user_id,
      p_decision => v_eval.decision,
      p_moderation_label => v_eval.moderation_label,
      p_matched_rule_ids => v_eval.matched_rule_ids,
      p_source => 'kursu_create',
      p_preview_text => v_trimmed_body
    );

    return jsonb_build_object(
      'status', 'blocked',
      'moderation_status', 'blocked',
      'moderation_label', v_eval.moderation_label,
      'message', 'Yorum topluluk kurallarına takıldı.'
    );
  end if;

  insert into public.confession_comments (
    confession_id,
    author_id,
    body,
    is_anonymous,
    reply_to,
    hidden_at,
    hidden_reason,
    moderation_status,
    moderation_source,
    moderation_label,
    last_moderated_at,
    normalized_body
  )
  values (
    p_confession_id,
    v_user_id,
    v_trimmed_body,
    p_is_anonymous,
    p_reply_to,
    case when v_eval.decision = 'review' then now() else null end,
    case when v_eval.decision = 'review' then 'Otomatik moderasyon incelemesi' else null end,
    case when v_eval.decision = 'review' then 'needs_review' else 'published' end,
    case when v_eval.decision = 'review' then 'auto_rule' else 'server_v2' end,
    nullif(v_eval.moderation_label, 'clean'),
    now(),
    nullif(public.normalize_moderation_text(v_trimmed_body), '')
  )
  returning id into v_comment_id;

  perform public.record_moderation_scan_log(
    p_content_scope => 'kursu_comment',
    p_content_id => v_comment_id,
    p_actor_user_id => v_user_id,
    p_decision => v_eval.decision,
    p_moderation_label => nullif(v_eval.moderation_label, 'clean'),
    p_matched_rule_ids => v_eval.matched_rule_ids,
    p_source => 'kursu_create',
    p_preview_text => v_trimmed_body
  );

  if v_eval.decision = 'review' then
    perform public.enqueue_kursu_auto_rule_queue(
      p_source_table => 'confession_comments',
      p_source_id => v_comment_id,
      p_target_type => 'comment',
      p_target_user_id => v_user_id,
      p_moderation_label => nullif(v_eval.moderation_label, 'clean'),
      p_matched_rule_ids => v_eval.matched_rule_ids,
      p_severity => v_eval.severity
    );

    return jsonb_build_object(
      'status', 'needs_review',
      'moderation_status', 'needs_review',
      'moderation_label', nullif(v_eval.moderation_label, 'clean'),
      'comment_id', v_comment_id,
      'message', 'Yorumun incelemeye alındı.'
    );
  end if;

  select
    cc.id,
    cc.body,
    cc.is_anonymous,
    cc.created_at,
    cc.reply_to,
    cc.author_id = v_user_id as is_mine,
    case
      when cc.is_anonymous then 'Anonim Öğrenci'
      when cc.author_id = v_user_id then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as author_name,
    case
      when cc.is_anonymous then null
      when cc.author_id = v_user_id then p.username
      when coalesce(us.profile_visibility_enabled, true) then p.username
      else null
    end as author_username,
    case
      when cc.is_anonymous then null
      when cc.author_id = v_user_id then p.avatar_url
      when coalesce(us.profile_visibility_enabled, true) then p.avatar_url
      else null
    end as author_avatar
  into v_comment_row
  from public.confession_comments cc
  left join public.profiles p on p.id = cc.author_id
  left join public.user_settings us on us.user_id = cc.author_id
  where cc.id = v_comment_id;

  return jsonb_build_object(
    'status', 'published',
    'moderation_status', 'published',
    'moderation_label', nullif(v_eval.moderation_label, 'clean'),
    'comment_id', v_comment_id,
    'message', 'Yorum yayınlandı.',
    'comment', jsonb_build_object(
      'id', v_comment_row.id,
      'body', v_comment_row.body,
      'is_anonymous', v_comment_row.is_anonymous,
      'created_at', v_comment_row.created_at,
      'reply_to', v_comment_row.reply_to,
      'is_mine', v_comment_row.is_mine,
      'author_name', v_comment_row.author_name,
      'author_username', v_comment_row.author_username,
      'author_avatar', v_comment_row.author_avatar
    )
  );
end;
$$;


--
-- Name: create_confession_v2(text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_confession_v2(p_body text, p_category text, p_is_anonymous boolean, p_image_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_eval record;
  v_confession_id uuid;
  v_trimmed_body text := btrim(coalesce(p_body, ''));
  v_stored_body text := nullif(v_trimmed_body, '');
  v_image_path text := nullif(ltrim(coalesce(p_image_path, ''), '/'), '');
begin
  if v_user_id is null then
    raise exception 'Yetkisiz istek.'
      using errcode = 'P0001';
  end if;

  if p_category not in ('confession', 'question', 'complaint', 'funny') then
    raise exception 'Geçersiz kategori.'
      using errcode = 'P0001';
  end if;

  if coalesce(char_length(v_trimmed_body), 0) > 500 then
    raise exception 'Gönderi en fazla 500 karakter olabilir.'
      using errcode = 'P0001';
  end if;

  if v_trimmed_body = '' and v_image_path is null then
    raise exception 'Bir şeyler yaz veya fotoğraf ekle.'
      using errcode = 'P0001';
  end if;

  select id, university_domain
  into v_profile
  from public.profiles
  where id = v_user_id
  limit 1;

  if not found then
    raise exception 'Profil bulunamadı.'
      using errcode = 'P0001';
  end if;

  if public.is_user_banned(v_user_id) or public.is_user_restricted(v_user_id) then
    raise exception 'Hesabın şu an Kürsü paylaşımı yapamıyor.'
      using errcode = 'P0001';
  end if;

  if public.normalize_moderation_text(v_trimmed_body) <> '' and exists (
    select 1
    from public.confessions c
    where c.author_id = v_user_id
      and c.normalized_body = public.normalize_moderation_text(v_trimmed_body)
      and c.created_at > now() - interval '10 minutes'
  ) then
    perform public.record_moderation_scan_log(
      p_content_scope => 'kursu_post',
      p_content_id => null,
      p_actor_user_id => v_user_id,
      p_decision => 'block',
      p_moderation_label => 'mass_repeat',
      p_matched_rule_ids => '{}'::uuid[],
      p_source => 'kursu_create',
      p_preview_text => v_trimmed_body
    );

    return jsonb_build_object(
      'status', 'blocked',
      'moderation_status', 'blocked',
      'moderation_label', 'mass_repeat',
      'message', 'Benzer içerik çok sık gönderiliyor.'
    );
  end if;

  select * into v_eval
  from public.evaluate_moderation_rules('kursu_post', v_trimmed_body);

  if v_eval.decision = 'block' then
    perform public.record_moderation_scan_log(
      p_content_scope => 'kursu_post',
      p_content_id => null,
      p_actor_user_id => v_user_id,
      p_decision => v_eval.decision,
      p_moderation_label => v_eval.moderation_label,
      p_matched_rule_ids => v_eval.matched_rule_ids,
      p_source => 'kursu_create',
      p_preview_text => v_trimmed_body
    );

    return jsonb_build_object(
      'status', 'blocked',
      'moderation_status', 'blocked',
      'moderation_label', v_eval.moderation_label,
      'message', 'İçerik topluluk kurallarına takıldı.'
    );
  end if;

  insert into public.confessions (
    author_id,
    body,
    category,
    image_url,
    is_anonymous,
    university_domain,
    moderation_status,
    moderation_source,
    moderation_label,
    last_moderated_at,
    hidden_at,
    hidden_reason,
    normalized_body
  )
  values (
    v_user_id,
    coalesce(v_stored_body, ' '),
    p_category,
    v_image_path,
    p_is_anonymous,
    v_profile.university_domain,
    case when v_eval.decision = 'review' then 'needs_review' else 'published' end,
    case when v_eval.decision = 'review' then 'auto_rule' else 'server_v2' end,
    nullif(v_eval.moderation_label, 'clean'),
    now(),
    case when v_eval.decision = 'review' then now() else null end,
    case when v_eval.decision = 'review' then 'Otomatik moderasyon incelemesi' else null end,
    nullif(public.normalize_moderation_text(v_trimmed_body), '')
  )
  returning id into v_confession_id;

  perform public.record_moderation_scan_log(
    p_content_scope => 'kursu_post',
    p_content_id => v_confession_id,
    p_actor_user_id => v_user_id,
    p_decision => v_eval.decision,
    p_moderation_label => nullif(v_eval.moderation_label, 'clean'),
    p_matched_rule_ids => v_eval.matched_rule_ids,
    p_source => 'kursu_create',
    p_preview_text => v_trimmed_body
  );

  if v_eval.decision = 'review' then
    perform public.enqueue_kursu_auto_rule_queue(
      p_source_table => 'confessions',
      p_source_id => v_confession_id,
      p_target_type => 'confession',
      p_target_user_id => v_user_id,
      p_moderation_label => nullif(v_eval.moderation_label, 'clean'),
      p_matched_rule_ids => v_eval.matched_rule_ids,
      p_severity => v_eval.severity
    );

    return jsonb_build_object(
      'status', 'needs_review',
      'moderation_status', 'needs_review',
      'moderation_label', nullif(v_eval.moderation_label, 'clean'),
      'confession_id', v_confession_id,
      'message', 'Gönderin incelemeye alındı.'
    );
  end if;

  return jsonb_build_object(
    'status', 'published',
    'moderation_status', 'published',
    'moderation_label', nullif(v_eval.moderation_label, 'clean'),
    'confession_id', v_confession_id,
    'message', 'Gönderi yayınlandı.'
  );
end;
$$;


--
-- Name: current_user_event_city_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_event_city_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.resolve_city_id_for_university_domain(
    (
      select university_domain
      from public.profiles
      where id = auth.uid()
      limit 1
    )
  );
$$;


--
-- Name: FUNCTION current_user_event_city_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_user_event_city_id() IS 'Giris yapan kullanicinin universite domaininden sehir id cozer';


--
-- Name: enqueue_kursu_auto_rule_queue(text, uuid, text, uuid, text, uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_kursu_auto_rule_queue(p_source_table text, p_source_id uuid, p_target_type text, p_target_user_id uuid, p_moderation_label text, p_matched_rule_ids uuid[] DEFAULT '{}'::uuid[], p_severity text DEFAULT 'P2'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_target_minutes int := 240;
begin
  select coalesce(target_minutes, 240)
  into v_target_minutes
  from public.ops_queue_sla
  where queue_domain = 'moderation'
    and severity = p_severity
  limit 1;

  insert into public.ops_queue_items (
    queue_domain,
    source_table,
    source_id,
    state,
    severity,
    title,
    due_at,
    payload,
    created_at,
    updated_at,
    resolved_at
  )
  values (
    'moderation',
    p_source_table,
    p_source_id,
    'open',
    p_severity,
    'Otomatik moderasyon incelemesi',
    now() + make_interval(mins => v_target_minutes),
    jsonb_build_object(
      'source', 'auto_rule',
      'target_type', p_target_type,
      'target_id', p_source_id,
      'target_user_id', p_target_user_id,
      'moderation_label', p_moderation_label,
      'matched_rule_ids', coalesce(p_matched_rule_ids, '{}'::uuid[])
    ),
    now(),
    now(),
    null
  )
  on conflict (source_table, source_id) do update
  set queue_domain = excluded.queue_domain,
      state = 'open',
      severity = excluded.severity,
      title = excluded.title,
      due_at = excluded.due_at,
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      resolved_at = null;
end;
$$;


--
-- Name: ensure_monthly_partition(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_monthly_partition(p_table text, p_anchor timestamp with time zone DEFAULT now()) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  start_ts timestamptz := date_trunc('month', p_anchor);
  end_ts timestamptz := start_ts + interval '1 month';
  part_name text := format('%s_%s', p_table, to_char(start_ts, 'YYYYMM'));
  sql text;
begin
  if p_table not in ('admin_audit_logs', 'event_campaign_logs', 'app_telemetry_events') then
    raise exception 'Unsupported partition table: %', p_table;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = part_name
  ) then
    sql := format(
      'create table public.%I partition of public.%I for values from (%L) to (%L);',
      part_name, p_table, start_ts, end_ts
    );
    execute sql;
  end if;
end;
$$;


--
-- Name: evaluate_moderation_rules(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluate_moderation_rules(p_scope text, p_text text) RETURNS TABLE(normalized_text text, decision text, moderation_label text, matched_rule_ids uuid[], matched_categories text[], severity text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_normalized text := public.normalize_moderation_text(p_text);
  v_tokens text[] := regexp_split_to_array(coalesce(public.normalize_moderation_text(p_text), ''), '\s+');
  v_rule record;
  v_matched boolean;
  v_decision text := 'allow';
  v_label text := 'clean';
  v_severity text := 'P3';
  v_rule_ids uuid[] := '{}'::uuid[];
  v_categories text[] := '{}'::text[];
begin
  if p_scope not in ('kursu_post', 'kursu_comment') then
    raise exception 'Geçersiz moderasyon kapsamı.'
      using errcode = 'P0001';
  end if;

  for v_rule in
    select id, category, match_type, pattern, normalized_pattern, action, moderation_word_rules.severity
    from public.moderation_word_rules
    where enabled = true
      and scope in ('shared', p_scope)
    order by
      case action when 'block' then 0 else 1 end,
      case moderation_word_rules.severity
        when 'P0' then 0
        when 'P1' then 1
        when 'P2' then 2
        else 3
      end,
      created_at asc
  loop
    v_matched := false;

    if v_rule.match_type = 'exact_token' then
      v_matched := coalesce(v_rule.normalized_pattern, '') <> ''
        and v_tokens @> array[v_rule.normalized_pattern];
    elsif v_rule.match_type = 'contains' then
      v_matched := coalesce(v_rule.normalized_pattern, '') <> ''
        and position(v_rule.normalized_pattern in v_normalized) > 0;
    elsif v_rule.match_type = 'regex' then
      begin
        v_matched := v_normalized ~ v_rule.pattern;
      exception when invalid_regular_expression then
        v_matched := false;
      end;
    end if;

    if v_matched then
      v_rule_ids := array_append(v_rule_ids, v_rule.id);
      v_categories := array_append(v_categories, v_rule.category);

      if v_label = 'clean' then
        v_label := v_rule.category;
        v_severity := v_rule.severity;
      end if;

      if v_rule.action = 'block' then
        v_decision := 'block';
      elsif v_decision <> 'block' then
        v_decision := 'review';
      end if;
    end if;
  end loop;

  return query
  select
    v_normalized,
    v_decision,
    v_label,
    v_rule_ids,
    v_categories,
    v_severity;
end;
$$;


--
-- Name: get_api_health_overview(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_api_health_overview(hours_back integer DEFAULT 24) RETURNS TABLE(window_label text, total_calls bigint, error_calls bigint, error_rate numeric, p95_response_ms numeric, top_error_endpoint text, top_error_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
with base as (
  select endpoint, event_type, response_ms, created_at
  from public.app_telemetry_events
  where event_type in ('api_success', 'api_error')
    and created_at >= now() - make_interval(hours => greatest(hours_back, 1))
),
stats as (
  select
    count(*) as total_calls,
    count(*) filter (where event_type = 'api_error') as error_calls,
    percentile_cont(0.95) within group (order by response_ms) as p95_response_ms
  from base
),
err as (
  select endpoint, count(*) as error_count
  from base
  where event_type = 'api_error'
  group by endpoint
  order by error_count desc, endpoint asc
  limit 1
)
select
  format('last_%sh', greatest(hours_back, 1)) as window_label,
  coalesce(s.total_calls, 0)::bigint as total_calls,
  coalesce(s.error_calls, 0)::bigint as error_calls,
  case when coalesce(s.total_calls, 0) = 0 then 0
       else round((s.error_calls::numeric / s.total_calls::numeric) * 100, 2)
  end as error_rate,
  coalesce(round(s.p95_response_ms::numeric, 2), 0) as p95_response_ms,
  coalesce(e.endpoint, '-') as top_error_endpoint,
  coalesce(e.error_count, 0)::bigint as top_error_count
from stats s
left join err e on true;
$$;


--
-- Name: get_confession_comments_v2(uuid, uuid, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_confession_comments_v2(p_confession_id uuid, p_user_id uuid, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, body text, is_anonymous boolean, created_at timestamp with time zone, is_mine boolean, reply_to uuid, author_name text, author_username text, author_avatar text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with viewer as (
    select p.university_domain
    from public.profiles p
    where p.id = auth.uid()
      and not public.is_user_restricted(auth.uid())
    limit 1
  )
  select
    cc.id,
    cc.body,
    cc.is_anonymous,
    cc.created_at,
    cc.author_id = auth.uid() as is_mine,
    cc.reply_to,
    case
      when cc.is_anonymous then 'Anonim Öğrenci'
      when cc.author_id = auth.uid() then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as author_name,
    case
      when cc.is_anonymous then null
      when cc.author_id = auth.uid() then p.username
      when coalesce(us.profile_visibility_enabled, true) then p.username
      else null
    end as author_username,
    case
      when cc.is_anonymous then null
      when cc.author_id = auth.uid() then p.avatar_url
      when coalesce(us.profile_visibility_enabled, true) then p.avatar_url
      else null
    end as author_avatar
  from public.confession_comments cc
  join public.confessions c on c.id = cc.confession_id
  join viewer v on v.university_domain = c.university_domain
  left join public.profiles p on p.id = cc.author_id
  left join public.user_settings us on us.user_id = cc.author_id
  where cc.confession_id = p_confession_id
    and c.hidden_at is null
    and coalesce(c.moderation_status, 'published') = 'published'
    and cc.hidden_at is null
    and coalesce(cc.moderation_status, 'published') = 'published'
    and coalesce(cc.is_flagged, false) = false
    and (
      p_cursor_created_at is null
      or (cc.created_at, cc.id) > (p_cursor_created_at, p_cursor_id)
    )
  order by cc.created_at asc, cc.id asc
  limit p_limit;
$$;


--
-- Name: get_confession_detail_v2(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_confession_detail_v2(p_confession_id uuid, p_user_id uuid) RETURNS TABLE(id uuid, body text, category text, image_url text, is_anonymous boolean, like_count integer, comment_count integer, created_at timestamp with time zone, is_mine boolean, has_liked boolean, has_bookmarked boolean, author_name text, author_username text, author_avatar text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with viewer as (
    select p.university_domain
    from public.profiles p
    where p.id = auth.uid()
      and not public.is_user_restricted(auth.uid())
    limit 1
  )
  select
    c.id,
    c.body,
    c.category,
    c.image_url,
    c.is_anonymous,
    c.like_count,
    c.comment_count,
    c.created_at,
    c.author_id = auth.uid() as is_mine,
    exists (
      select 1 from public.confession_likes cl
      where cl.confession_id = c.id and cl.user_id = auth.uid()
    ) as has_liked,
    exists (
      select 1 from public.confession_bookmarks cb
      where cb.confession_id = c.id and cb.user_id = auth.uid()
    ) as has_bookmarked,
    case
      when c.is_anonymous then 'Anonim Öğrenci'
      when c.author_id = auth.uid() then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as author_name,
    case
      when c.is_anonymous then null
      when c.author_id = auth.uid() then p.username
      when coalesce(us.profile_visibility_enabled, true) then p.username
      else null
    end as author_username,
    case
      when c.is_anonymous then null
      when c.author_id = auth.uid() then p.avatar_url
      when coalesce(us.profile_visibility_enabled, true) then p.avatar_url
      else null
    end as author_avatar
  from public.confessions c
  join viewer v on v.university_domain = c.university_domain
  left join public.profiles p on p.id = c.author_id
  left join public.user_settings us on us.user_id = c.author_id
  where c.id = p_confession_id
    and c.hidden_at is null
    and coalesce(c.moderation_status, 'published') = 'published'
    and coalesce(c.is_flagged, false) = false
  limit 1;
$$;


--
-- Name: get_confessions_feed(uuid, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_confessions_feed(p_user_id uuid, p_filter text DEFAULT 'all'::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, body text, category text, image_url text, is_anonymous boolean, like_count integer, comment_count integer, is_flagged boolean, created_at timestamp with time zone, is_mine boolean, has_liked boolean, has_bookmarked boolean, author_name text, author_username text, author_avatar text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    cf.id,
    cf.body,
    cf.category,
    cf.image_url,
    cf.is_anonymous,
    cf.like_count,
    cf.comment_count,
    cf.is_flagged,
    cf.created_at,
    cf.is_mine,
    exists(
      select 1 from confession_likes cl
      where cl.confession_id = cf.id and cl.user_id = p_user_id
    ) as has_liked,
    exists(
      select 1 from confession_bookmarks cb
      where cb.confession_id = cf.id and cb.user_id = p_user_id
    ) as has_bookmarked,
    cf.author_name,
    cf.author_username,
    cf.author_avatar
  from confessions_feed cf
  where cf.is_flagged = false
    and (
      p_filter = 'all'
      or p_filter = 'bookmarks'
      or cf.category = p_filter
    )
    and (
      p_filter != 'bookmarks'
      or cf.id in (
        select cb2.confession_id from confession_bookmarks cb2 where cb2.user_id = p_user_id
      )
    )
  order by
    case when p_sort = 'trending' then cf.like_count else 0 end desc,
    cf.created_at desc
  limit p_limit;
$$;


--
-- Name: FUNCTION get_confessions_feed(p_user_id uuid, p_filter text, p_sort text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_confessions_feed(p_user_id uuid, p_filter text, p_sort text, p_limit integer) IS 'Kürsü feed — tek sorguda likes/bookmarks durumunu döndürür';


--
-- Name: get_confessions_feed_v2(uuid, text, text, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_confessions_feed_v2(p_user_id uuid, p_filter text DEFAULT 'all'::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 20, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, body text, category text, image_url text, is_anonymous boolean, like_count integer, comment_count integer, is_flagged boolean, created_at timestamp with time zone, is_mine boolean, has_liked boolean, has_bookmarked boolean, author_name text, author_username text, author_avatar text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with viewer as (
    select p.university_domain
    from public.profiles p
    where p.id = auth.uid()
      and not public.is_user_restricted(auth.uid())
    limit 1
  ),
  filtered as (
    select
      c.id,
      c.body,
      c.category,
      c.image_url,
      c.is_anonymous,
      c.like_count,
      c.comment_count,
      c.is_flagged,
      c.created_at,
      c.author_id,
      c.author_id = auth.uid() as is_mine,
      exists (
        select 1 from public.confession_likes cl
        where cl.confession_id = c.id and cl.user_id = auth.uid()
      ) as has_liked,
      exists (
        select 1 from public.confession_bookmarks cb
        where cb.confession_id = c.id and cb.user_id = auth.uid()
      ) as has_bookmarked,
      case
        when c.created_at >= now() - interval '48 hours'
          then ((c.like_count * 4) + (c.comment_count * 2))::numeric
            / greatest((extract(epoch from (now() - c.created_at)) / 3600) + 2, 1)
        else -1::numeric
      end as hot_score
    from public.confessions c
    join viewer v on v.university_domain = c.university_domain
    where c.hidden_at is null
      and coalesce(c.moderation_status, 'published') = 'published'
      and coalesce(c.is_flagged, false) = false
      and (
        p_cursor_created_at is null
        or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
      )
      and (
        p_filter = 'all'
        or p_filter = 'bookmarks'
        or c.category = p_filter
      )
      and (
        p_filter <> 'bookmarks'
        or exists (
          select 1 from public.confession_bookmarks cb2
          where cb2.confession_id = c.id and cb2.user_id = p_user_id
        )
      )
  )
  select
    f.id,
    f.body,
    f.category,
    f.image_url,
    f.is_anonymous,
    f.like_count,
    f.comment_count,
    f.is_flagged,
    f.created_at,
    f.is_mine,
    f.has_liked,
    f.has_bookmarked,
    case
      when f.is_anonymous then 'Anonim Öğrenci'
      when f.author_id = auth.uid() then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as author_name,
    case
      when f.is_anonymous then null
      when f.author_id = auth.uid() then p.username
      when coalesce(us.profile_visibility_enabled, true) then p.username
      else null
    end as author_username,
    case
      when f.is_anonymous then null
      when f.author_id = auth.uid() then p.avatar_url
      when coalesce(us.profile_visibility_enabled, true) then p.avatar_url
      else null
    end as author_avatar
  from filtered f
  left join public.profiles p on p.id = f.author_id
  left join public.user_settings us on us.user_id = f.author_id
  order by
    case when p_sort = 'trending' then f.hot_score else 0 end desc,
    f.created_at desc,
    f.id desc
  limit p_limit;
$$;


--
-- Name: get_daily_content_activity(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_daily_content_activity(days_back integer DEFAULT 30) RETURNS TABLE(day date, sessions bigint, confessions bigint, notes bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    gs.day::date AS day,
    COALESCE(s.cnt, 0) AS sessions,
    COALESCE(c.cnt, 0) AS confessions,
    COALESCE(n.cnt, 0) AS notes
  FROM generate_series(
    (CURRENT_DATE - (days_back || ' days')::interval)::date,
    CURRENT_DATE,
    '1 day'::interval
  ) AS gs(day)

  LEFT JOIN (
    SELECT created_at::date AS activity_day, COUNT(*) AS cnt
    FROM public.study_sessions
    WHERE created_at >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  ) s ON s.activity_day = gs.day

  LEFT JOIN (
    SELECT created_at::date AS activity_day, COUNT(*) AS cnt
    FROM public.confessions
    WHERE created_at >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  ) c ON c.activity_day = gs.day

  LEFT JOIN (
    SELECT created_at::date AS activity_day, COUNT(*) AS cnt
    FROM public.notes
    WHERE created_at >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  ) n ON n.activity_day = gs.day

  ORDER BY gs.day;
$$;


--
-- Name: FUNCTION get_daily_content_activity(days_back integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_daily_content_activity(days_back integer) IS 'Admin dashboard: son N günün günlük içerik üretim istatistikleri';


--
-- Name: get_daily_user_signups(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_daily_user_signups(days_back integer DEFAULT 30) RETURNS TABLE(day date, count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    gs.day::date AS day,
    COALESCE(s.cnt, 0) AS count
  FROM generate_series(
    (CURRENT_DATE - (days_back || ' days')::interval)::date,
    CURRENT_DATE,
    '1 day'::interval
  ) AS gs(day)

  LEFT JOIN (
    SELECT created_at::date AS signup_day, COUNT(*) AS cnt
    FROM public.profiles
    WHERE created_at >= CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY created_at::date
  ) s ON s.signup_day = gs.day

  ORDER BY gs.day;
$$;


--
-- Name: FUNCTION get_daily_user_signups(days_back integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_daily_user_signups(days_back integer) IS 'Admin dashboard: son N günün günlük yeni kullanıcı kayıt sayıları';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    faculty_id uuid NOT NULL,
    duration_years integer DEFAULT 4 NOT NULL,
    CONSTRAINT departments_duration_years_check CHECK (((duration_years >= 2) AND (duration_years <= 7)))
);


--
-- Name: TABLE departments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.departments IS 'Fakülteye bağlı bölümler; duration_years = öğrenim süresi';


--
-- Name: get_departments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_departments(p_faculty_id uuid) RETURNS SETOF public.departments
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from public.departments where faculty_id = p_faculty_id order by name;
$$;


--
-- Name: get_event_campaign_overview(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_campaign_overview(days_back integer DEFAULT 30) RETURNS TABLE(event_id uuid, title text, city_name text, detail_opens bigint, cta_clicks bigint, map_opens bigint, story_impressions bigint, story_taps bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    e.id as event_id,
    e.title,
    c.name as city_name,
    count(l.id) filter (where l.event_type = 'detail_open') as detail_opens,
    count(l.id) filter (where l.event_type = 'cta_click') as cta_clicks,
    count(l.id) filter (where l.event_type = 'map_open') as map_opens,
    count(l.id) filter (where l.event_type = 'story_impression') as story_impressions,
    count(l.id) filter (where l.event_type = 'story_tap') as story_taps
  from public.city_events e
  join public.cities c on c.id = e.city_id
  left join public.event_campaign_logs l
    on l.event_id = e.id
    and l.created_at >= now() - make_interval(days => greatest(days_back, 1))
  group by e.id, e.title, c.name
  order by cta_clicks desc, detail_opens desc, story_impressions desc, e.starts_at asc;
$$;


--
-- Name: FUNCTION get_event_campaign_overview(days_back integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_event_campaign_overview(days_back integer) IS 'Admin panelde etkinlik kampanyasi bazli temel performans raporu';


--
-- Name: faculties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faculties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL
);


--
-- Name: TABLE faculties; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.faculties IS 'Türkiye üniversitelerindeki ortak fakülteler';


--
-- Name: get_faculties(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_faculties() RETURNS SETOF public.faculties
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from public.faculties order by name;
$$;


--
-- Name: get_notes_feed(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_notes_feed(p_user_id uuid, p_course_filter uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, author_id uuid, course_id uuid, title text, description text, file_url text, file_type text, file_size_bytes bigint, download_count integer, vote_score integer, comment_count integer, created_at timestamp with time zone, is_flagged boolean, course_code text, course_name text, author_name text, user_vote text, is_mine boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    n.id,
    n.author_id,
    n.course_id,
    n.title,
    n.description,
    n.file_url,
    n.file_type,
    n.file_size_bytes,
    n.download_count,
    n.vote_score,
    n.comment_count,
    n.created_at,
    n.is_flagged,
    coalesce(c.code, '—') as course_code,
    coalesce(c.name, 'Ders belirtilmemiş') as course_name,
    case
      when n.author_id = p_user_id then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as author_name,
    nv.direction as user_vote,
    (n.author_id = p_user_id) as is_mine
  from notes n
  left join courses c on c.id = n.course_id
  left join profiles p on p.id = n.author_id
  left join user_settings us on us.user_id = n.author_id
  left join note_votes nv on nv.note_id = n.id and nv.user_id = p_user_id
  where n.is_flagged = false
    and n.is_hidden = false
    and (p_course_filter is null or n.course_id = p_course_filter)
  order by
    case when p_sort = 'popular' then n.vote_score else 0 end desc,
    n.created_at desc
  limit p_limit;
$$;


--
-- Name: FUNCTION get_notes_feed(p_user_id uuid, p_course_filter uuid, p_sort text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_notes_feed(p_user_id uuid, p_course_filter uuid, p_sort text, p_limit integer) IS 'Not listesi — tek sorguda author profili + user vote döndürür';


--
-- Name: get_online_users_now(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_online_users_now(window_minutes integer DEFAULT 5) RETURNS TABLE(online_users bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(distinct user_id)::bigint as online_users
  from public.app_telemetry_events
  where event_type = 'heartbeat'
    and user_id is not null
    and created_at >= now() - make_interval(mins => greatest(window_minutes, 1));
$$;


--
-- Name: get_retention_cohorts(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_retention_cohorts(days_back integer DEFAULT 30) RETURNS TABLE(cohort_date date, cohort_size bigint, d1_retention numeric, d7_retention numeric, d30_retention numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
with cohorts as (
  select
    date_trunc('day', e.created_at)::date as cohort_date,
    e.user_id
  from public.app_telemetry_events e
  where e.event_type = 'app_open'
    and e.user_id is not null
    and e.created_at >= now() - make_interval(days => greatest(days_back, 1))
  group by 1, 2
),
cohort_sizes as (
  select cohort_date, count(*) as cohort_size
  from cohorts
  group by cohort_date
),
activity as (
  select
    c.cohort_date,
    c.user_id,
    exists (
      select 1 from public.app_telemetry_events e
      where e.user_id = c.user_id
        and e.event_type = 'app_open'
        and e.created_at >= (c.cohort_date::timestamptz + interval '1 day')
        and e.created_at < (c.cohort_date::timestamptz + interval '2 day')
    ) as has_d1,
    exists (
      select 1 from public.app_telemetry_events e
      where e.user_id = c.user_id
        and e.event_type = 'app_open'
        and e.created_at >= (c.cohort_date::timestamptz + interval '7 day')
        and e.created_at < (c.cohort_date::timestamptz + interval '8 day')
    ) as has_d7,
    exists (
      select 1 from public.app_telemetry_events e
      where e.user_id = c.user_id
        and e.event_type = 'app_open'
        and e.created_at >= (c.cohort_date::timestamptz + interval '30 day')
        and e.created_at < (c.cohort_date::timestamptz + interval '31 day')
    ) as has_d30
  from cohorts c
)
select
  s.cohort_date,
  s.cohort_size,
  round(100.0 * avg(case when a.has_d1 then 1 else 0 end)::numeric, 2) as d1_retention,
  round(100.0 * avg(case when a.has_d7 then 1 else 0 end)::numeric, 2) as d7_retention,
  round(100.0 * avg(case when a.has_d30 then 1 else 0 end)::numeric, 2) as d30_retention
from cohort_sizes s
join activity a on a.cohort_date = s.cohort_date
group by s.cohort_date, s.cohort_size
order by s.cohort_date desc;
$$;


--
-- Name: get_sessions_feed(uuid, text, uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sessions_feed(p_user_id uuid, p_filter text DEFAULT 'all'::text, p_course_ids uuid[] DEFAULT '{}'::uuid[], p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, creator_id uuid, title text, description text, location_name text, location_lat double precision, location_lng double precision, starts_at timestamp with time zone, ends_at timestamp with time zone, max_participants integer, participant_count integer, status text, created_at timestamp with time zone, course_code text, course_name text, creator_name text, has_joined boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    s.id,
    s.creator_id,
    s.title,
    s.description,
    s.location_name,
    s.location_lat,
    s.location_lng,
    s.starts_at,
    s.ends_at,
    s.max_participants,
    s.participant_count,
    s.status,
    s.created_at,
    coalesce(c.code, '—') as course_code,
    coalesce(c.name, 'Ders belirtilmemiş') as course_name,
    case
      when s.creator_id = p_user_id then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as creator_name,
    exists(
      select 1 from session_participants sp
      where sp.session_id = s.id and sp.user_id = p_user_id and sp.status = 'joined'
    ) as has_joined
  from study_sessions s
  left join courses c on c.id = s.course_id
  left join profiles p on p.id = s.creator_id
  left join user_settings us on us.user_id = s.creator_id
  where s.status in ('active', 'full')
    and s.starts_at >= (now() - interval '24 hours')
    and s.ends_at >= now()
    and (
      p_filter != 'my_courses'
      or s.course_id = any(p_course_ids)
    )
  order by s.starts_at asc
  limit p_limit;
$$;


--
-- Name: FUNCTION get_sessions_feed(p_user_id uuid, p_filter text, p_course_ids uuid[], p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_sessions_feed(p_user_id uuid, p_filter text, p_course_ids uuid[], p_limit integer) IS 'Radar feed — tek sorguda creator profili + has_joined döndürür';


--
-- Name: get_university_distribution(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_university_distribution() RETURNS TABLE(university_domain text, user_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    university_domain,
    COUNT(*) AS user_count
  FROM public.profiles
  WHERE university_domain IS NOT NULL
  GROUP BY university_domain
  ORDER BY user_count DESC
  LIMIT 20;
$$;


--
-- Name: FUNCTION get_university_distribution(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_university_distribution() IS 'Admin dashboard: üniversite bazında kullanıcı dağılımı (top 20)';


--
-- Name: get_university_with_sisters(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_university_with_sisters(p_domain text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_university_id uuid;
  v_result jsonb;
begin
  -- Domain'i çöz: önce ana domain, yoksa alias
  select id into v_university_id
  from public.universities
  where domain = lower(trim(p_domain))
  limit 1;

  if v_university_id is null then
    select university_id into v_university_id
    from public.university_domain_aliases
    where alias_domain = lower(trim(p_domain))
    limit 1;
  end if;

  if v_university_id is null then
    return null;
  end if;

  select json_build_object(
    'university', (select json_build_object('id', u.id, 'name', u.name, 'domain', u.domain, 'city_id', u.city_id) from public.universities u where u.id = v_university_id),
    'sister_universities', (
      select coalesce(json_agg(json_build_object('domain', su.domain, 'name', su.name) order by su.name), '[]'::json)
      from public.universities su
      where su.city_id = (select city_id from public.universities where id = v_university_id)
        and su.id != v_university_id
    )
  ) into v_result;

  return v_result;
end;
$$;


--
-- Name: FUNCTION get_university_with_sisters(p_domain text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_university_with_sisters(p_domain text) IS 'E-posta domainine göre üniversite bilgisi ve aynı ildeki kardeş üniversiteleri döner';


--
-- Name: get_user_id_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_id_by_email(lookup_email text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  found_id uuid;
BEGIN
  SELECT id INTO found_id FROM auth.users WHERE email = lookup_email LIMIT 1;
  RETURN found_id;
END;
$$;


--
-- Name: get_visible_users(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_visible_users(p_user_ids uuid[]) RETURNS TABLE(user_id uuid, display_name text, avatar_url text, is_hidden boolean, is_online boolean, last_seen_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with viewer as (
    select p.id, p.university_domain
    from public.profiles p
    where p.id = auth.uid()
  ),
  requested as (
    select distinct unnest(coalesce(p_user_ids, '{}'::uuid[])) as requested_user_id
  )
  select
    p.id as user_id,
    case
      when p.id = auth.uid() then coalesce(p.full_name, p.username, 'Öğrenci')
      when coalesce(us.profile_visibility_enabled, true) then coalesce(p.full_name, p.username, 'Öğrenci')
      else 'Anonim Öğrenci'
    end as display_name,
    case
      when p.id = auth.uid() then p.avatar_url
      when coalesce(us.profile_visibility_enabled, true) then p.avatar_url
      else null
    end as avatar_url,
    case
      when p.id = auth.uid() then false
      else not coalesce(us.profile_visibility_enabled, true)
    end as is_hidden,
    case
      when p.id = auth.uid() then coalesce(up.is_online, false)
      when not coalesce(us.profile_visibility_enabled, true) then false
      when not coalesce(us.show_online_status, false) then false
      else coalesce(up.is_online, false)
    end as is_online,
    case
      when p.id = auth.uid() then up.last_seen_at
      when not coalesce(us.profile_visibility_enabled, true) then null
      when not coalesce(us.show_online_status, false) then null
      else up.last_seen_at
    end as last_seen_at
  from requested r
  join public.profiles p on p.id = r.requested_user_id
  join viewer v on (p.id = v.id or p.university_domain = v.university_domain)
  left join public.user_settings us on us.user_id = p.id
  left join public.user_presence up on up.user_id = p.id;
$$;


--
-- Name: FUNCTION get_visible_users(p_user_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_visible_users(p_user_ids uuid[]) IS 'Same-university kullanicilar icin gizlilik ve online durumuna gore gorunur kullanici bilgilerini dondurur';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  base_username TEXT;
BEGIN
  base_username := 'user_' || replace(substring(NEW.id::text from 1 for 8), '-', '');
  INSERT INTO public.profiles (id, email, university_domain, full_name, username)
  VALUES (
    NEW.id,
    NEW.email,
    split_part(NEW.email, '@', 2),
    'Kullanıcı',
    base_username
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: increment_note_download(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_note_download(p_note_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.notes
  set download_count = download_count + 1,
      updated_at = now()
  where id = p_note_id;
$$;


--
-- Name: FUNCTION increment_note_download(p_note_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_note_download(p_note_id uuid) IS 'Not indirme sayısını atomik olarak +1 artırır — concurrent update kaybını önler';


--
-- Name: is_feature_enabled_for_user(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_feature_enabled_for_user(p_flag_key text, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with selected_flag as (
    select enabled, rollout_percent
    from public.admin_feature_flags
    where flag_key = p_flag_key
    limit 1
  )
  select case
    when not exists (select 1 from selected_flag) then false
    when not (select enabled from selected_flag) then false
    when (select rollout_percent from selected_flag) >= 100 then true
    when p_user_id is null then false
    else (
      abs((('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int)) % 100
    ) < (select rollout_percent from selected_flag)
  end
$$;


--
-- Name: is_kursu_server_moderation_enabled(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_kursu_server_moderation_enabled(p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_feature_enabled_for_user('kursu.server_moderation_v1', p_user_id)
$$;


--
-- Name: is_user_banned(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_user_banned(check_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.user_sanctions
    where user_id = check_user_id
      and is_active = true
      and sanction_type in ('temp_ban', 'permanent_ban')
      and (expires_at is null or expires_at > now())
  );
$$;


--
-- Name: is_user_restricted(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_user_restricted(check_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _restricted boolean;
  _ends_at    timestamptz;
begin
  select is_restricted, restriction_ends_at
    into _restricted, _ends_at
    from public.profiles
   where id = check_user_id;

  if _restricted is not true then
    return false;
  end if;

  if _ends_at is not null and _ends_at <= now() then
    update public.profiles
       set is_restricted = false,
           restriction_ends_at = null,
           is_banned = false
     where id = check_user_id;
    return false;
  end if;

  return true;
end;
$$;


--
-- Name: mask_moderation_preview(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mask_moderation_preview(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_preview text := left(btrim(coalesce(p_text, '')), 160);
begin
  if v_preview = '' then
    return '';
  end if;

  return regexp_replace(v_preview, '([[:alnum:]])[[:alnum:]]+', '\1***', 'g');
end;
$$;


--
-- Name: normalize_moderation_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_moderation_text(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
declare
  v_text text := coalesce(p_text, '');
begin
  v_text := replace(v_text, chr(8203), '');
  v_text := replace(v_text, chr(8204), '');
  v_text := replace(v_text, chr(8205), '');
  v_text := replace(v_text, chr(65279), '');
  v_text := lower(v_text);
  v_text := translate(v_text, 'çğıöşü', 'cgiosu');
  v_text := replace(v_text, '@', 'a');
  v_text := replace(v_text, '$', 's');
  v_text := translate(v_text, '01345', 'oieas');
  v_text := regexp_replace(v_text, '([a-z])\1{2,}', '\1', 'g');
  v_text := regexp_replace(v_text, '[^a-z0-9\s]+', ' ', 'g');
  v_text := regexp_replace(v_text, '\s+', ' ', 'g');
  return btrim(v_text);
end;
$_$;


--
-- Name: preview_kursu_submission(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preview_kursu_submission(p_scope text, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_eval record;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Yetkisiz istek.'
      using errcode = 'P0001';
  end if;

  select * into v_eval
  from public.evaluate_moderation_rules(p_scope, p_body);

  if v_eval.decision in ('block', 'review') then
    perform public.record_moderation_scan_log(
      p_content_scope => p_scope,
      p_content_id => null,
      p_actor_user_id => v_user_id,
      p_decision => v_eval.decision,
      p_moderation_label => v_eval.moderation_label,
      p_matched_rule_ids => v_eval.matched_rule_ids,
      p_source => 'kursu_preview',
      p_preview_text => p_body
    );
  end if;

  return jsonb_build_object(
    'decision', v_eval.decision,
    'moderation_label', nullif(v_eval.moderation_label, 'clean'),
    'matched_categories', coalesce(v_eval.matched_categories, '{}'::text[])
  );
end;
$$;


--
-- Name: record_moderation_scan_log(text, uuid, uuid, text, text, uuid[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_moderation_scan_log(p_content_scope text, p_content_id uuid, p_actor_user_id uuid, p_decision text, p_moderation_label text, p_matched_rule_ids uuid[] DEFAULT '{}'::uuid[], p_source text DEFAULT 'unknown'::text, p_preview_text text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_log_id uuid := gen_random_uuid();
  v_matched_terms text[] := '{}'::text[];
  v_block_count int := 0;
  v_target_minutes int := 60;
begin
  if array_length(p_matched_rule_ids, 1) is not null then
    select coalesce(array_agg(coalesce(normalized_pattern, pattern) order by created_at asc), '{}'::text[])
    into v_matched_terms
    from public.moderation_word_rules
    where id = any(p_matched_rule_ids);
  end if;

  insert into public.moderation_scan_logs (
    id,
    content_scope,
    content_id,
    actor_user_id,
    decision,
    moderation_label,
    matched_rule_ids,
    matched_terms,
    preview_masked,
    source
  )
  values (
    v_log_id,
    p_content_scope,
    p_content_id,
    p_actor_user_id,
    p_decision,
    p_moderation_label,
    coalesce(p_matched_rule_ids, '{}'::uuid[]),
    v_matched_terms,
    public.mask_moderation_preview(p_preview_text),
    p_source
  );

  if p_decision = 'block' and p_actor_user_id is not null then
    select count(*)
    into v_block_count
    from public.moderation_scan_logs
    where actor_user_id = p_actor_user_id
      and decision = 'block'
      and source like 'kursu_%'
      and created_at > now() - interval '15 minutes';

    if v_block_count >= 3 then
      select coalesce(target_minutes, 60)
      into v_target_minutes
      from public.ops_queue_sla
      where queue_domain = 'moderation'
        and severity = 'P1'
      limit 1;

      insert into public.ops_queue_items (
        queue_domain,
        source_table,
        source_id,
        state,
        severity,
        title,
        due_at,
        payload,
        created_at,
        updated_at,
        resolved_at
      )
      values (
        'moderation',
        'moderation_user_risk',
        p_actor_user_id,
        'open',
        'P1',
        'Kursu kullanici riski',
        now() + make_interval(mins => v_target_minutes),
        jsonb_build_object(
          'source', 'auto_rule',
          'target_type', 'user',
          'target_id', p_actor_user_id,
          'moderation_label', p_moderation_label,
          'blocked_count_15m', v_block_count
        ),
        now(),
        now(),
        null
      )
      on conflict (source_table, source_id) do update
      set queue_domain = excluded.queue_domain,
          state = 'open',
          severity = excluded.severity,
          title = excluded.title,
          due_at = excluded.due_at,
          payload = excluded.payload,
          updated_at = excluded.updated_at,
          resolved_at = null;
    end if;
  end if;

  return v_log_id;
end;
$$;


--
-- Name: refresh_admin_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_admin_stats() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  refresh materialized view concurrently public.admin_stats_snapshot;
$$;


--
-- Name: resolve_city_id_for_university_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_city_id_for_university_domain(p_domain text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with direct_match as (
    select city_id
    from public.universities
    where lower(domain) = lower(trim(p_domain))
    limit 1
  ),
  alias_match as (
    select u.city_id
    from public.university_domain_aliases uda
    join public.universities u on u.id = uda.university_id
    where lower(uda.alias_domain) = lower(trim(p_domain))
    limit 1
  )
  select city_id from direct_match
  union all
  select city_id from alias_match
  limit 1;
$$;


--
-- Name: FUNCTION resolve_city_id_for_university_domain(p_domain text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.resolve_city_id_for_university_domain(p_domain text) IS 'Universite domaininden sehir id cozer';


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: set_user_presence_timestamps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_presence_timestamps() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  new.last_seen_at = now();
  return new;
end;
$$;


--
-- Name: set_user_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: should_deliver_notification(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.should_deliver_notification(p_user_id uuid, p_type text, p_critical boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  settings_row public.user_settings%rowtype;
begin
  if p_critical or p_type in ('moderation_warning', 'moderation_restriction', 'security_system') then
    return true;
  end if;

  select *
    into settings_row
    from public.user_settings
   where user_id = p_user_id;

  if not found then
    return true;
  end if;

  case p_type
    when 'session_invite' then
      return coalesce(settings_row.notify_session_invites, true);
    when 'session_reminder' then
      return coalesce(settings_row.notify_session_reminders, true);
    when 'session_new' then
      return coalesce(settings_row.notify_new_sessions, true);
    else
      return true;
  end case;
end;
$$;


--
-- Name: FUNCTION should_deliver_notification(p_user_id uuid, p_type text, p_critical boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.should_deliver_notification(p_user_id uuid, p_type text, p_critical boolean) IS 'Critical bildirimleri bypass eder; diger tiplerde user_settings tablosundaki tercihleri dikkate alir';


--
-- Name: sync_community_member_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_community_member_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      update public.communities
      set member_count = coalesce(member_count, 0) + 1,
          updated_at = now()
      where id = new.community_id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> new.status then
      if old.status = 'active' then
        update public.communities
        set member_count = greatest(coalesce(member_count, 0) - 1, 0),
            updated_at = now()
        where id = old.community_id;
      end if;

      if new.status = 'active' then
        update public.communities
        set member_count = coalesce(member_count, 0) + 1,
            updated_at = now()
        where id = new.community_id;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'active' then
      update public.communities
      set member_count = greatest(coalesce(member_count, 0) - 1, 0),
          updated_at = now()
      where id = old.community_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;


--
-- Name: sync_confession_report_into_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_confession_report_into_reports() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.reports (
    target_type,
    target_id,
    reporter_id,
    reason,
    description,
    status,
    source,
    created_at,
    updated_at
  )
  values (
    'confession',
    new.confession_id,
    new.reporter_id,
    coalesce(new.reason, 'Diger'),
    null,
    'pending',
    'confession_reports',
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (target_type, target_id, reporter_id)
  do nothing;

  return new;
end;
$$;


--
-- Name: sync_event_story_slot_city(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_event_story_slot_city() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_city_id uuid;
  v_is_sponsored boolean;
begin
  select city_id, is_sponsored
  into v_city_id, v_is_sponsored
  from public.city_events
  where id = new.event_id;

  if v_city_id is null then
    raise exception 'Story slot icin etkinlik bulunamadi';
  end if;

  if v_is_sponsored is distinct from true then
    raise exception 'Sadece sponsorlu etkinlikler story slotuna alinabilir';
  end if;

  if new.ends_at <= new.starts_at then
    raise exception 'Story bitis zamani baslangictan sonra olmali';
  end if;

  new.city_id := v_city_id;
  return new;
end;
$$;


--
-- Name: sync_event_submission_queue_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_event_submission_queue_item() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_due timestamptz;
begin
  target_due := coalesce(new.created_at, now()) + interval '12 hours';

  if new.status = 'pending' then
    insert into public.ops_queue_items (
      queue_domain, source_table, source_id, state, severity, title, due_at, payload, created_at, updated_at
    )
    values (
      'event_submissions',
      'event_submissions',
      new.id,
      'open',
      'P1',
      new.title,
      target_due,
      jsonb_build_object('partner_name', new.partner_name, 'contact_email', new.contact_email),
      now(),
      now()
    )
    on conflict (source_table, source_id)
    do update set
      state = 'open',
      severity = 'P1',
      title = excluded.title,
      due_at = excluded.due_at,
      payload = excluded.payload,
      updated_at = now(),
      resolved_at = null;
  else
    update public.ops_queue_items
    set state = 'resolved',
        resolved_at = now(),
        updated_at = now()
    where source_table = 'event_submissions' and source_id = new.id;
  end if;

  return new;
end;
$$;


--
-- Name: sync_note_vote_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_note_vote_score() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_note_id uuid;
begin
  v_note_id := coalesce(new.note_id, old.note_id);
  update public.notes
  set vote_score = (
    select coalesce(sum(case direction when 'up' then 1 when 'down' then -1 end), 0)
    from public.note_votes
    where note_id = v_note_id
  ),
  updated_at = now()
  where id = v_note_id;
  return coalesce(new, old);
end;
$$;


--
-- Name: FUNCTION sync_note_vote_score(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_note_vote_score() IS 'note_votes değiştiğinde notes.vote_score otomatik günceller — client-side race condition önler';


--
-- Name: sync_report_queue_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_report_queue_item() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_due timestamptz;
  item_state text;
begin
  target_due := coalesce(new.created_at, now()) + interval '24 hours';

  if new.status = 'pending' then
    insert into public.ops_queue_items (
      queue_domain, source_table, source_id, state, severity, title, due_at, payload, created_at, updated_at
    )
    values (
      'moderation',
      'reports',
      new.id,
      'open',
      'P2',
      coalesce(new.reason, 'Moderation report'),
      target_due,
      jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
      now(),
      now()
    )
    on conflict (source_table, source_id)
    do update set
      state = 'open',
      severity = 'P2',
      title = excluded.title,
      due_at = excluded.due_at,
      payload = excluded.payload,
      updated_at = now(),
      resolved_at = null;
  else
    item_state := case
      when new.status = 'dismissed' then 'dismissed'
      else 'resolved'
    end;
    update public.ops_queue_items
    set state = item_state,
        resolved_at = now(),
        updated_at = now()
    where source_table = 'reports' and source_id = new.id;
  end if;

  return new;
end;
$$;


--
-- Name: sync_user_banned_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_banned_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _target_uid uuid := coalesce(NEW.user_id, OLD.user_id);
  _is_banned  boolean;
  _ends_at    timestamptz;
begin
  _is_banned := public.is_user_banned(_target_uid);

  if _is_banned then
    select s.expires_at into _ends_at
      from public.user_sanctions s
     where s.user_id = _target_uid
       and s.is_active = true
       and s.sanction_type in ('temp_ban', 'permanent_ban')
       and (s.expires_at is null or s.expires_at > now())
     order by s.created_at desc
     limit 1;
  end if;

  update public.profiles
     set is_banned = _is_banned,
         is_restricted = _is_banned,
         restriction_ends_at = case when _is_banned then _ends_at else null end
   where id = _target_uid;

  return coalesce(NEW, OLD);
end;
$$;


--
-- Name: update_confession_comment_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_confession_comment_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    update public.confessions
    set comment_count = comment_count + 1
    where id = new.confession_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.confessions
    set comment_count = greatest(comment_count - 1, 0)
    where id = old.confession_id;
    return old;
  end if;
  return null;
end;
$$;


--
-- Name: update_confession_like_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_confession_like_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    update public.confessions
    set like_count = like_count + 1
    where id = new.confession_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.confessions
    set like_count = greatest(like_count - 1, 0)
    where id = old.confession_id;
    return old;
  end if;
  return null;
end;
$$;


--
-- Name: update_session_participant_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_session_participant_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count int;
  v_max int;
begin
  -- Hangi session etkilendi?
  -- INSERT/UPDATE: NEW.session_id; DELETE: OLD.session_id
  declare
    v_session_id uuid := coalesce(new.session_id, old.session_id);
  begin
    -- 'joined' durumundaki katılımcı sayısını hesapla
    select count(*) into v_count
    from public.session_participants
    where session_id = v_session_id
      and status = 'joined';

    -- Max katılımcı sayısını al
    select max_participants into v_max
    from public.study_sessions
    where id = v_session_id;

    -- Sayacı ve durumu güncelle
    update public.study_sessions
    set
      participant_count = v_count,
      status = case
        when status in ('ended', 'cancelled') then status  -- bitmiş/iptal seansı değiştirme
        when v_count >= v_max then 'full'
        else 'active'
      end
    where id = v_session_id;
  end;

  return coalesce(new, old);
end;
$$;


--
-- Name: FUNCTION update_session_participant_count(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_session_participant_count() IS 'session_participants değiştiğinde study_sessions.participant_count ve status günceller';


--
-- Name: admin_action_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_action_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_key text NOT NULL,
    permission_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    requested_by uuid NOT NULL,
    approved_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT admin_action_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    permission_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    ip_hash text,
    user_agent_hash text,
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (created_at);


--
-- Name: admin_audit_logs_202603; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs_202603 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    permission_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    ip_hash text,
    user_agent_hash text,
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_logs_202604; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs_202604 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    permission_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    ip_hash text,
    user_agent_hash text,
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_logs_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs_default (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    permission_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    reason text,
    ip_hash text,
    user_agent_hash text,
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_feature_flags (
    flag_key text NOT NULL,
    description text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    rollout_percent integer DEFAULT 100 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_feature_flags_rollout_percent_check CHECK (((rollout_percent >= 0) AND (rollout_percent <= 100)))
);


--
-- Name: admin_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text,
    password_hash text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    is_super_admin boolean DEFAULT false NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_identities_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: admin_incident_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_incident_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    notes text,
    created_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_incident_events_severity_check CHECK ((severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text]))),
    CONSTRAINT admin_incident_events_status_check CHECK ((status = ANY (ARRAY['open'::text, 'monitoring'::text, 'resolved'::text])))
);


--
-- Name: admin_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_permissions (
    permission_key text NOT NULL,
    description text NOT NULL,
    approval_mode text DEFAULT 'SINGLE_APPROVAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_permissions_approval_mode_check CHECK ((approval_mode = 'SINGLE_APPROVAL'::text))
);


--
-- Name: admin_role_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_role_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identity_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_role_permissions (
    role_id uuid NOT NULL,
    permission_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_key text NOT NULL,
    role_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    university_domain text NOT NULL,
    name text NOT NULL,
    description text,
    avatar_url text,
    category text DEFAULT 'general'::text NOT NULL,
    join_type text DEFAULT 'open'::text NOT NULL,
    member_count integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    cover_url text,
    CONSTRAINT communities_category_check CHECK ((category = ANY (ARRAY['academic'::text, 'sports'::text, 'arts'::text, 'tech'::text, 'social'::text, 'general'::text]))),
    CONSTRAINT communities_join_type_check CHECK ((join_type = ANY (ARRAY['open'::text, 'approval'::text, 'invite'::text]))),
    CONSTRAINT communities_member_count_check CHECK ((member_count >= 0)),
    CONSTRAINT communities_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 80)))
);


--
-- Name: community_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))),
    CONSTRAINT community_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text])))
);


--
-- Name: confession_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confession_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    confession_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    is_flagged boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_anonymous boolean DEFAULT true NOT NULL,
    reply_to uuid,
    hidden_at timestamp with time zone,
    hidden_by_admin_id uuid,
    hidden_reason text,
    restored_at timestamp with time zone,
    moderation_status text DEFAULT 'published'::text NOT NULL,
    moderation_source text,
    moderation_label text,
    last_moderated_at timestamp with time zone,
    normalized_body text,
    CONSTRAINT confession_comments_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 300))),
    CONSTRAINT confession_comments_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['published'::text, 'needs_review'::text, 'hidden'::text])))
);


--
-- Name: TABLE confession_comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.confession_comments IS 'Gönderi yorumları — admin silebilir';


--
-- Name: confession_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confession_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    confession_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE confession_likes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.confession_likes IS 'Gönderi beğenileri — kullanıcı başına tek beğeni';


--
-- Name: confessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    category text DEFAULT 'confession'::text NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    is_flagged boolean DEFAULT false NOT NULL,
    university_domain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    is_anonymous boolean DEFAULT true NOT NULL,
    hidden_at timestamp with time zone,
    hidden_by_admin_id uuid,
    hidden_reason text,
    restored_at timestamp with time zone,
    moderation_status text DEFAULT 'published'::text NOT NULL,
    moderation_source text,
    moderation_label text,
    last_moderated_at timestamp with time zone,
    normalized_body text,
    CONSTRAINT confessions_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 500))),
    CONSTRAINT confessions_category_check CHECK ((category = ANY (ARRAY['confession'::text, 'question'::text, 'complaint'::text, 'funny'::text]))),
    CONSTRAINT confessions_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['published'::text, 'needs_review'::text, 'hidden'::text])))
);


--
-- Name: TABLE confessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.confessions IS 'Anonim Kürsü gönderileri — admin silebilir, author_id anonim gönderilerde client''a döndürülmez';


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    course_id uuid NOT NULL,
    university_domain text NOT NULL,
    title text NOT NULL,
    description text,
    file_url text NOT NULL,
    file_type text DEFAULT 'pdf'::text NOT NULL,
    file_size_bytes bigint,
    download_count integer DEFAULT 0,
    like_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    is_flagged boolean DEFAULT false,
    vote_score integer DEFAULT 0,
    comment_count integer DEFAULT 0,
    uploader_id uuid,
    report_count integer DEFAULT 0 NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notes_description_check CHECK ((char_length(description) <= 300)),
    CONSTRAINT notes_file_type_check CHECK ((file_type = ANY (ARRAY['pdf'::text, 'image'::text]))),
    CONSTRAINT notes_title_check CHECK (((char_length(title) >= 2) AND (char_length(title) <= 120)))
);


--
-- Name: TABLE notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notes IS 'Ders notu paylasim tablosu — ogrenciler PDF/gorsel yukler, oy verir, yorum yapar.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    university_domain text NOT NULL,
    university_name text,
    faculty text,
    department text,
    year_of_study integer,
    full_name text,
    username text,
    avatar_url text,
    bio text,
    study_style text,
    preferred_location text,
    active_hours jsonb,
    follower_count integer DEFAULT 0,
    xp_points integer DEFAULT 0,
    is_anonymous_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    last_active timestamp with time zone DEFAULT now(),
    is_admin boolean DEFAULT false NOT NULL,
    is_banned boolean DEFAULT false NOT NULL,
    kvkk_consent_at timestamp with time zone,
    privacy_consent_at timestamp with time zone,
    faculty_id uuid,
    department_id uuid,
    is_restricted boolean DEFAULT false NOT NULL,
    restriction_ends_at timestamp with time zone,
    CONSTRAINT profiles_study_style_check CHECK (((study_style IS NULL) OR (study_style = ANY (ARRAY['silent'::text, 'discussion'::text, 'music'::text])))),
    CONSTRAINT profiles_year_of_study_check CHECK (((year_of_study IS NULL) OR ((year_of_study >= 1) AND (year_of_study <= 6))))
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text DEFAULT 'Diger'::text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    source text DEFAULT 'app'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text]))),
    CONSTRAINT reports_target_type_allowed CHECK ((target_type = ANY (ARRAY['confession'::text, 'comment'::text, 'user'::text, 'note'::text])))
);


--
-- Name: study_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    course_id uuid,
    title text,
    description text,
    location_name text NOT NULL,
    location_lat double precision,
    location_lng double precision,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    max_participants integer DEFAULT 5 NOT NULL,
    participant_count integer DEFAULT 0 NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    is_flagged boolean DEFAULT false NOT NULL,
    university_domain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT study_sessions_max_participants_check CHECK (((max_participants >= 2) AND (max_participants <= 20))),
    CONSTRAINT study_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'full'::text, 'ended'::text, 'cancelled'::text])))
);


--
-- Name: TABLE study_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.study_sessions IS 'EKLER Radarı çalışma seansları';


--
-- Name: admin_stats_snapshot; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_stats_snapshot AS
 SELECT ( SELECT count(*) AS count
           FROM public.profiles) AS total_users,
    ( SELECT count(*) AS count
           FROM public.study_sessions) AS total_sessions,
    ( SELECT count(*) AS count
           FROM public.confessions) AS total_confessions,
    ( SELECT count(*) AS count
           FROM public.notes) AS total_notes,
    ( SELECT count(*) AS count
           FROM public.reports) AS total_reports,
    ( SELECT count(*) AS count
           FROM public.communities) AS total_communities,
    ( SELECT count(*) AS count
           FROM public.community_members) AS total_community_members,
    ( SELECT count(*) AS count
           FROM public.study_sessions
          WHERE (study_sessions.status = ANY (ARRAY['active'::text, 'planned'::text]))) AS active_sessions,
    ( SELECT count(*) AS count
           FROM public.reports
          WHERE (reports.status = 'pending'::text)) AS pending_reports,
    ( SELECT count(*) AS count
           FROM public.confession_likes) AS total_likes,
    ( SELECT count(*) AS count
           FROM public.confession_comments) AS total_comments,
    now() AS refreshed_at
  WITH NO DATA;


--
-- Name: app_telemetry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_telemetry_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    platform text,
    app_version text,
    route text,
    endpoint text,
    status_code integer,
    response_ms integer,
    error_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_telemetry_events_event_type_check CHECK ((event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])))
)
PARTITION BY RANGE (created_at);


--
-- Name: app_telemetry_events_202603; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_telemetry_events_202603 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    platform text,
    app_version text,
    route text,
    endpoint text,
    status_code integer,
    response_ms integer,
    error_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_telemetry_events_event_type_check CHECK ((event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])))
);


--
-- Name: app_telemetry_events_202604; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_telemetry_events_202604 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    platform text,
    app_version text,
    route text,
    endpoint text,
    status_code integer,
    response_ms integer,
    error_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_telemetry_events_event_type_check CHECK ((event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])))
);


--
-- Name: app_telemetry_events_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_telemetry_events_default (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    platform text,
    app_version text,
    route text,
    endpoint text,
    status_code integer,
    response_ms integer,
    error_code text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_telemetry_events_event_type_check CHECK ((event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])))
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL
);


--
-- Name: TABLE cities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cities IS 'İller; kardeş üniversite aynı ildeki diğer üniversitelerdir';


--
-- Name: city_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.city_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    source_submission_id uuid,
    city_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    cover_url text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    venue_name text NOT NULL,
    venue_address text,
    category text NOT NULL,
    ticket_url text,
    price_label text DEFAULT 'Detayda'::text NOT NULL,
    organizer_name text NOT NULL,
    organizer_instagram text,
    organizer_url text,
    is_sponsored boolean DEFAULT false NOT NULL,
    sponsorship_tier text DEFAULT 'organic'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT city_events_category_check CHECK ((category = ANY (ARRAY['concert'::text, 'festival'::text, 'standup'::text, 'theatre'::text, 'party'::text, 'workshop'::text, 'community'::text, 'other'::text]))),
    CONSTRAINT city_events_sponsorship_tier_check CHECK ((sponsorship_tier = ANY (ARRAY['organic'::text, 'featured'::text, 'story'::text, 'vitrin'::text]))),
    CONSTRAINT city_events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'scheduled'::text, 'live'::text, 'ended'::text, 'archived'::text, 'rejected'::text])))
);


--
-- Name: TABLE city_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.city_events IS 'Mobilde sehir bazli gosterilecek etkinlikler';


--
-- Name: community_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    location text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_events_check CHECK (((ends_at IS NULL) OR (ends_at >= starts_at))),
    CONSTRAINT community_events_title_check CHECK (((char_length(title) >= 2) AND (char_length(title) <= 120)))
);


--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    community_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    image_url text,
    is_pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_posts_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)))
);


--
-- Name: community_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    contact_phone text,
    university_domain text NOT NULL,
    community_name text NOT NULL,
    category text NOT NULL,
    description text,
    social_instagram text,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_requests_category_check CHECK ((category = ANY (ARRAY['academic'::text, 'sports'::text, 'arts'::text, 'tech'::text, 'social'::text, 'general'::text]))),
    CONSTRAINT community_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: TABLE community_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.community_requests IS 'Student community creation requests from web form';


--
-- Name: confession_bookmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confession_bookmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    confession_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE confession_bookmarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.confession_bookmarks IS 'Kullanıcının kaydettiği gönderiler';


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    user_id uuid NOT NULL,
    theme_preference text DEFAULT 'system'::text NOT NULL,
    notify_session_invites boolean DEFAULT true NOT NULL,
    notify_session_reminders boolean DEFAULT true NOT NULL,
    notify_new_sessions boolean DEFAULT true NOT NULL,
    profile_visibility_enabled boolean DEFAULT true NOT NULL,
    show_online_status boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_settings_theme_preference_check CHECK ((theme_preference = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])))
);


--
-- Name: TABLE user_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_settings IS 'Kullanici bazli hesap-geneli tema, bildirim ve gizlilik tercihleri';


--
-- Name: confession_comments_feed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.confession_comments_feed AS
 SELECT cc.id,
    cc.confession_id,
    cc.body,
    cc.is_anonymous,
    cc.reply_to,
    cc.report_count,
    cc.is_flagged,
    cc.created_at,
    (cc.author_id = auth.uid()) AS is_mine,
        CASE
            WHEN cc.is_anonymous THEN 'Anonim Öğrenci'::text
            WHEN (cc.author_id = auth.uid()) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text)
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text)
            ELSE 'Anonim Öğrenci'::text
        END AS author_name,
        CASE
            WHEN cc.is_anonymous THEN NULL::text
            WHEN (cc.author_id = auth.uid()) THEN p.username
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.username
            ELSE NULL::text
        END AS author_username,
        CASE
            WHEN cc.is_anonymous THEN NULL::text
            WHEN (cc.author_id = auth.uid()) THEN p.avatar_url
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.avatar_url
            ELSE NULL::text
        END AS author_avatar
   FROM (((public.confession_comments cc
     JOIN public.confessions c ON ((c.id = cc.confession_id)))
     LEFT JOIN public.profiles p ON ((p.id = cc.author_id)))
     LEFT JOIN public.user_settings us ON ((us.user_id = cc.author_id)))
  WHERE ((c.university_domain = ( SELECT p2.university_domain
           FROM public.profiles p2
          WHERE (p2.id = auth.uid()))) AND (c.hidden_at IS NULL) AND (COALESCE(c.moderation_status, 'published'::text) = 'published'::text) AND (cc.hidden_at IS NULL) AND (COALESCE(cc.moderation_status, 'published'::text) = 'published'::text));


--
-- Name: confession_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.confession_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    confession_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text DEFAULT 'Diğer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE confession_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.confession_reports IS 'Gönderi bildirimleri — kullanıcı başına tek bildirim';


--
-- Name: confessions_feed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.confessions_feed AS
 SELECT c.id,
    c.body,
    c.category,
    c.image_url,
    c.is_anonymous,
    c.like_count,
    c.comment_count,
    c.report_count,
    c.is_flagged,
    c.university_domain,
    c.created_at,
    (c.author_id = auth.uid()) AS is_mine,
        CASE
            WHEN c.is_anonymous THEN 'Anonim Öğrenci'::text
            WHEN (c.author_id = auth.uid()) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text)
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text)
            ELSE 'Anonim Öğrenci'::text
        END AS author_name,
        CASE
            WHEN c.is_anonymous THEN NULL::text
            WHEN (c.author_id = auth.uid()) THEN p.username
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.username
            ELSE NULL::text
        END AS author_username,
        CASE
            WHEN c.is_anonymous THEN NULL::text
            WHEN (c.author_id = auth.uid()) THEN p.avatar_url
            WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.avatar_url
            ELSE NULL::text
        END AS author_avatar
   FROM ((public.confessions c
     LEFT JOIN public.profiles p ON ((p.id = c.author_id)))
     LEFT JOIN public.user_settings us ON ((us.user_id = c.author_id)))
  WHERE ((c.university_domain = ( SELECT p2.university_domain
           FROM public.profiles p2
          WHERE (p2.id = auth.uid()))) AND (c.hidden_at IS NULL) AND (COALESCE(c.moderation_status, 'published'::text) = 'published'::text));


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    university_domain text NOT NULL,
    faculty text,
    credits integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE courses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.courses IS 'Üniversiteye özel ders kataloğu; code+domain bazlı unique';


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    expo_push_token text NOT NULL,
    platform text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE device_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_tokens IS 'Kullanıcıların Expo push bildirim token''ları';


--
-- Name: event_campaign_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_campaign_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid,
    story_slot_id uuid,
    viewer_id uuid,
    viewer_university_domain text,
    viewer_city_id uuid,
    event_type text NOT NULL,
    source text DEFAULT 'mobile'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_campaign_logs_event_type_check CHECK ((event_type = ANY (ARRAY['story_impression'::text, 'story_tap'::text, 'detail_open'::text, 'cta_click'::text, 'map_open'::text]))),
    CONSTRAINT event_campaign_logs_source_check CHECK ((source = ANY (ARRAY['mobile'::text, 'admin'::text, 'landing'::text])))
);


--
-- Name: TABLE event_campaign_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.event_campaign_logs IS 'Etkinlik ve story etkileşim loglari';


--
-- Name: event_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    partner_kind text DEFAULT 'organizer'::text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    website_url text,
    instagram_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_partners_partner_kind_check CHECK ((partner_kind = ANY (ARRAY['organizer'::text, 'brand'::text, 'venue'::text, 'community'::text, 'other'::text])))
);


--
-- Name: TABLE event_partners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.event_partners IS 'Etkinlik organizatoru veya sponsor musterisi kayitlari';


--
-- Name: event_story_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_story_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    city_id uuid NOT NULL,
    slot_index integer NOT NULL,
    title_override text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_story_slots_slot_index_check CHECK (((slot_index >= 1) AND (slot_index <= 8))),
    CONSTRAINT event_story_slots_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'archived'::text])))
);


--
-- Name: TABLE event_story_slots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.event_story_slots IS 'Etkinlikler ekranindaki ust sponsorlu story slotlari';


--
-- Name: event_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_name text NOT NULL,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    contact_phone text,
    city_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    venue_name text NOT NULL,
    venue_address text,
    ticket_url text,
    price_label text,
    cover_url text,
    organizer_instagram text,
    organizer_url text,
    package_requested text DEFAULT 'Temel Listeleme'::text NOT NULL,
    submission_notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_event_id uuid,
    CONSTRAINT event_submissions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: TABLE event_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.event_submissions IS 'Public organizator basvuru formu kayitlari';


--
-- Name: landing_page_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.landing_page_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    section_key text NOT NULL,
    title text,
    subtitle text,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: TABLE landing_page_sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.landing_page_sections IS 'Admin panelden yönetilen landing page bölümleri';


--
-- Name: moderation_appeals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_appeals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    appeal_type text NOT NULL,
    related_entity_type text,
    related_entity_id uuid,
    sanction_id uuid,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_response text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_appeals_appeal_type_check CHECK ((appeal_type = ANY (ARRAY['sanction'::text, 'content_removal'::text, 'account_ban'::text]))),
    CONSTRAINT moderation_appeals_reason_check CHECK (((char_length(reason) >= 10) AND (char_length(reason) <= 2000))),
    CONSTRAINT moderation_appeals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'accepted'::text, 'rejected'::text])))
);


--
-- Name: moderation_scan_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_scan_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_scope text NOT NULL,
    content_id uuid,
    actor_user_id uuid,
    decision text NOT NULL,
    moderation_label text,
    matched_rule_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    matched_terms text[] DEFAULT '{}'::text[] NOT NULL,
    preview_masked text,
    source text DEFAULT 'unknown'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_scan_logs_content_scope_check CHECK ((content_scope = ANY (ARRAY['kursu_post'::text, 'kursu_comment'::text]))),
    CONSTRAINT moderation_scan_logs_decision_check CHECK ((decision = ANY (ARRAY['allow'::text, 'review'::text, 'block'::text])))
);


--
-- Name: moderation_word_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_word_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_key text NOT NULL,
    scope text NOT NULL,
    category text NOT NULL,
    match_type text NOT NULL,
    pattern text NOT NULL,
    normalized_pattern text,
    action text NOT NULL,
    severity text DEFAULT 'P2'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT moderation_word_rules_action_check CHECK ((action = ANY (ARRAY['block'::text, 'review'::text]))),
    CONSTRAINT moderation_word_rules_category_check CHECK ((category = ANY (ARRAY['profanity'::text, 'hate_speech'::text, 'sexual_harassment'::text, 'targeted_abuse'::text, 'spam_link'::text, 'phone'::text, 'external_contact'::text, 'mass_repeat'::text]))),
    CONSTRAINT moderation_word_rules_match_type_check CHECK ((match_type = ANY (ARRAY['exact_token'::text, 'contains'::text, 'regex'::text]))),
    CONSTRAINT moderation_word_rules_scope_check CHECK ((scope = ANY (ARRAY['shared'::text, 'kursu_post'::text, 'kursu_comment'::text]))),
    CONSTRAINT moderation_word_rules_severity_check CHECK ((severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text])))
);


--
-- Name: note_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT note_comments_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 500)))
);


--
-- Name: note_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    direction text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT note_votes_direction_check CHECK ((direction = ANY (ARRAY['up'::text, 'down'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'Kullanıcı bildirimleri (in-app + admin sistem mesajları)';


--
-- Name: ops_queue_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_queue_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    queue_item_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    unassigned_at timestamp with time zone,
    note text
);


--
-- Name: ops_queue_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_queue_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    queue_domain text NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    severity text DEFAULT 'P2'::text NOT NULL,
    title text NOT NULL,
    owner_id uuid,
    due_at timestamp with time zone,
    resolved_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_queue_items_queue_domain_check CHECK ((queue_domain = ANY (ARRAY['moderation'::text, 'event_submissions'::text, 'story_placements'::text, 'support_tickets'::text, 'fraud_review'::text]))),
    CONSTRAINT ops_queue_items_severity_check CHECK ((severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text]))),
    CONSTRAINT ops_queue_items_state_check CHECK ((state = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: ops_queue_sla; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_queue_sla (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    queue_domain text NOT NULL,
    severity text NOT NULL,
    target_minutes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_queue_sla_queue_domain_check CHECK ((queue_domain = ANY (ARRAY['moderation'::text, 'event_submissions'::text, 'story_placements'::text, 'support_tickets'::text, 'fraud_review'::text]))),
    CONSTRAINT ops_queue_sla_severity_check CHECK ((severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text]))),
    CONSTRAINT ops_queue_sla_target_minutes_check CHECK ((target_minutes > 0))
);


--
-- Name: push_campaign_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_campaign_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    batch_index integer NOT NULL,
    target_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    response_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    target_university_domains text[] DEFAULT '{}'::text[] NOT NULL,
    target_platform text DEFAULT 'all'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    dry_run_total bigint DEFAULT 0 NOT NULL,
    dry_run_ios bigint DEFAULT 0 NOT NULL,
    dry_run_android bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    approved_by uuid,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'dry_run'::text, 'pending_approval'::text, 'sending'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT push_campaigns_target_platform_check CHECK ((target_platform = ANY (ARRAY['all'::text, 'ios'::text, 'android'::text])))
);


--
-- Name: revenue_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    city_id uuid,
    deal_name text NOT NULL,
    package_tier text DEFAULT 'organic'::text NOT NULL,
    stage text DEFAULT 'lead'::text NOT NULL,
    budget_amount numeric(12,2),
    expected_start_at timestamp with time zone,
    expected_end_at timestamp with time zone,
    owner_identity_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_deals_package_tier_check CHECK ((package_tier = ANY (ARRAY['organic'::text, 'featured'::text, 'story'::text, 'vitrin'::text, 'custom'::text]))),
    CONSTRAINT revenue_deals_stage_check CHECK ((stage = ANY (ARRAY['lead'::text, 'qualified'::text, 'proposal_sent'::text, 'negotiation'::text, 'won'::text, 'lost'::text])))
);


--
-- Name: session_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'joined'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_participants_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'joined'::text, 'left'::text])))
);


--
-- Name: TABLE session_participants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.session_participants IS 'Çalışma seansı katılımcıları';


--
-- Name: universities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.universities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    domain text NOT NULL,
    city_id uuid NOT NULL
);


--
-- Name: TABLE universities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.universities IS 'Üniversiteler; domain ana e-posta domaini (örn. atu.edu.tr)';


--
-- Name: university_domain_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.university_domain_aliases (
    alias_domain text NOT NULL,
    university_id uuid NOT NULL
);


--
-- Name: TABLE university_domain_aliases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.university_domain_aliases IS 'Alt domain eşlemesi (örn. ogr.atu.edu.tr -> atu.edu.tr)';


--
-- Name: user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    consent_type text NOT NULL,
    version text DEFAULT '1.0'::text NOT NULL,
    granted boolean DEFAULT true NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    ip_address text,
    user_agent text,
    CONSTRAINT user_consents_consent_type_check CHECK ((consent_type = ANY (ARRAY['kvkk'::text, 'privacy_policy'::text, 'terms_of_service'::text, 'notifications'::text, 'telemetry'::text])))
);


--
-- Name: user_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    semester text NOT NULL,
    instructor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_courses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_courses IS 'Öğrencinin dönem bazlı ders kayıtları';


--
-- Name: user_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_presence (
    user_id uuid NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_presence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_presence IS 'Kullanici bazli hesap-geneli online durumu ve son gorulme bilgisi';


--
-- Name: user_sanctions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sanctions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sanction_type text NOT NULL,
    reason text DEFAULT 'Topluluk kurallarina aykiri davranis'::text NOT NULL,
    violation_count integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_sanctions_sanction_type_check CHECK ((sanction_type = ANY (ARRAY['warning'::text, 'temp_ban'::text, 'permanent_ban'::text])))
);


--
-- Name: user_sister_universities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sister_universities (
    user_id uuid NOT NULL,
    university_domain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_sister_universities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_sister_universities IS 'Kullanıcının aynı ildeki diğer üniversiteleri kardeş üniversite olarak eklemesi';


--
-- Name: admin_audit_logs_202603; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs ATTACH PARTITION public.admin_audit_logs_202603 FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');


--
-- Name: admin_audit_logs_202604; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs ATTACH PARTITION public.admin_audit_logs_202604 FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');


--
-- Name: admin_audit_logs_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs ATTACH PARTITION public.admin_audit_logs_default DEFAULT;


--
-- Name: app_telemetry_events_202603; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events ATTACH PARTITION public.app_telemetry_events_202603 FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');


--
-- Name: app_telemetry_events_202604; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events ATTACH PARTITION public.app_telemetry_events_202604 FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');


--
-- Name: app_telemetry_events_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events ATTACH PARTITION public.app_telemetry_events_default DEFAULT;


--
-- Name: admin_action_approvals admin_action_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_approvals
    ADD CONSTRAINT admin_action_approvals_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id, created_at);


--
-- Name: admin_audit_logs_202603 admin_audit_logs_202603_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs_202603
    ADD CONSTRAINT admin_audit_logs_202603_pkey PRIMARY KEY (id, created_at);


--
-- Name: admin_audit_logs_202604 admin_audit_logs_202604_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs_202604
    ADD CONSTRAINT admin_audit_logs_202604_pkey PRIMARY KEY (id, created_at);


--
-- Name: admin_audit_logs_default admin_audit_logs_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs_default
    ADD CONSTRAINT admin_audit_logs_default_pkey PRIMARY KEY (id, created_at);


--
-- Name: admin_feature_flags admin_feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_feature_flags
    ADD CONSTRAINT admin_feature_flags_pkey PRIMARY KEY (flag_key);


--
-- Name: admin_identities admin_identities_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_identities
    ADD CONSTRAINT admin_identities_email_key UNIQUE (email);


--
-- Name: admin_identities admin_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_identities
    ADD CONSTRAINT admin_identities_pkey PRIMARY KEY (id);


--
-- Name: admin_incident_events admin_incident_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_incident_events
    ADD CONSTRAINT admin_incident_events_pkey PRIMARY KEY (id);


--
-- Name: admin_permissions admin_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permissions
    ADD CONSTRAINT admin_permissions_pkey PRIMARY KEY (permission_key);


--
-- Name: admin_role_bindings admin_role_bindings_identity_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_bindings
    ADD CONSTRAINT admin_role_bindings_identity_id_role_id_key UNIQUE (identity_id, role_id);


--
-- Name: admin_role_bindings admin_role_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_bindings
    ADD CONSTRAINT admin_role_bindings_pkey PRIMARY KEY (id);


--
-- Name: admin_role_permissions admin_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_permissions
    ADD CONSTRAINT admin_role_permissions_pkey PRIMARY KEY (role_id, permission_key);


--
-- Name: admin_roles admin_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_pkey PRIMARY KEY (id);


--
-- Name: admin_roles admin_roles_role_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_role_key_key UNIQUE (role_key);


--
-- Name: app_telemetry_events app_telemetry_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events
    ADD CONSTRAINT app_telemetry_events_pkey PRIMARY KEY (id, created_at);


--
-- Name: app_telemetry_events_202603 app_telemetry_events_202603_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events_202603
    ADD CONSTRAINT app_telemetry_events_202603_pkey PRIMARY KEY (id, created_at);


--
-- Name: app_telemetry_events_202604 app_telemetry_events_202604_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events_202604
    ADD CONSTRAINT app_telemetry_events_202604_pkey PRIMARY KEY (id, created_at);


--
-- Name: app_telemetry_events_default app_telemetry_events_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_telemetry_events_default
    ADD CONSTRAINT app_telemetry_events_default_pkey PRIMARY KEY (id, created_at);


--
-- Name: cities cities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_name_key UNIQUE (name);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: city_events city_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_events
    ADD CONSTRAINT city_events_pkey PRIMARY KEY (id);


--
-- Name: communities communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_pkey PRIMARY KEY (id);


--
-- Name: community_events community_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_events
    ADD CONSTRAINT community_events_pkey PRIMARY KEY (id);


--
-- Name: community_members community_members_community_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_community_id_user_id_key UNIQUE (community_id, user_id);


--
-- Name: community_members community_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_pkey PRIMARY KEY (id);


--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);


--
-- Name: community_requests community_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_requests
    ADD CONSTRAINT community_requests_pkey PRIMARY KEY (id);


--
-- Name: confession_bookmarks confession_bookmarks_confession_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_bookmarks
    ADD CONSTRAINT confession_bookmarks_confession_id_user_id_key UNIQUE (confession_id, user_id);


--
-- Name: confession_bookmarks confession_bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_bookmarks
    ADD CONSTRAINT confession_bookmarks_pkey PRIMARY KEY (id);


--
-- Name: confession_comments confession_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_comments
    ADD CONSTRAINT confession_comments_pkey PRIMARY KEY (id);


--
-- Name: confession_likes confession_likes_confession_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_likes
    ADD CONSTRAINT confession_likes_confession_id_user_id_key UNIQUE (confession_id, user_id);


--
-- Name: confession_likes confession_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_likes
    ADD CONSTRAINT confession_likes_pkey PRIMARY KEY (id);


--
-- Name: confession_reports confession_reports_confession_id_reporter_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_reports
    ADD CONSTRAINT confession_reports_confession_id_reporter_id_key UNIQUE (confession_id, reporter_id);


--
-- Name: confession_reports confession_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_reports
    ADD CONSTRAINT confession_reports_pkey PRIMARY KEY (id);


--
-- Name: confessions confessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confessions
    ADD CONSTRAINT confessions_pkey PRIMARY KEY (id);


--
-- Name: courses courses_code_university_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_code_university_domain_key UNIQUE (code, university_domain);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: departments departments_faculty_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_faculty_id_name_key UNIQUE (faculty_id, name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_user_id_expo_push_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_expo_push_token_key UNIQUE (user_id, expo_push_token);


--
-- Name: event_campaign_logs event_campaign_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_campaign_logs
    ADD CONSTRAINT event_campaign_logs_pkey PRIMARY KEY (id);


--
-- Name: event_partners event_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_partners
    ADD CONSTRAINT event_partners_pkey PRIMARY KEY (id);


--
-- Name: event_story_slots event_story_slots_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_story_slots
    ADD CONSTRAINT event_story_slots_no_overlap EXCLUDE USING gist (city_id WITH =, slot_index WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status = ANY (ARRAY['scheduled'::text, 'live'::text])));


--
-- Name: event_story_slots event_story_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_story_slots
    ADD CONSTRAINT event_story_slots_pkey PRIMARY KEY (id);


--
-- Name: event_submissions event_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_submissions
    ADD CONSTRAINT event_submissions_pkey PRIMARY KEY (id);


--
-- Name: faculties faculties_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties
    ADD CONSTRAINT faculties_name_key UNIQUE (name);


--
-- Name: faculties faculties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faculties
    ADD CONSTRAINT faculties_pkey PRIMARY KEY (id);


--
-- Name: landing_page_sections landing_page_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_sections
    ADD CONSTRAINT landing_page_sections_pkey PRIMARY KEY (id);


--
-- Name: landing_page_sections landing_page_sections_section_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_sections
    ADD CONSTRAINT landing_page_sections_section_key_key UNIQUE (section_key);


--
-- Name: moderation_appeals moderation_appeals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_pkey PRIMARY KEY (id);


--
-- Name: moderation_scan_logs moderation_scan_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_scan_logs
    ADD CONSTRAINT moderation_scan_logs_pkey PRIMARY KEY (id);


--
-- Name: moderation_word_rules moderation_word_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_word_rules
    ADD CONSTRAINT moderation_word_rules_pkey PRIMARY KEY (id);


--
-- Name: moderation_word_rules moderation_word_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_word_rules
    ADD CONSTRAINT moderation_word_rules_rule_key_key UNIQUE (rule_key);


--
-- Name: note_comments note_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_comments
    ADD CONSTRAINT note_comments_pkey PRIMARY KEY (id);


--
-- Name: note_votes note_votes_note_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_votes
    ADD CONSTRAINT note_votes_note_id_user_id_key UNIQUE (note_id, user_id);


--
-- Name: note_votes note_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_votes
    ADD CONSTRAINT note_votes_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ops_queue_assignments ops_queue_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_assignments
    ADD CONSTRAINT ops_queue_assignments_pkey PRIMARY KEY (id);


--
-- Name: ops_queue_items ops_queue_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_items
    ADD CONSTRAINT ops_queue_items_pkey PRIMARY KEY (id);


--
-- Name: ops_queue_items ops_queue_items_source_table_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_items
    ADD CONSTRAINT ops_queue_items_source_table_source_id_key UNIQUE (source_table, source_id);


--
-- Name: ops_queue_sla ops_queue_sla_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_sla
    ADD CONSTRAINT ops_queue_sla_pkey PRIMARY KEY (id);


--
-- Name: ops_queue_sla ops_queue_sla_queue_domain_severity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_sla
    ADD CONSTRAINT ops_queue_sla_queue_domain_severity_key UNIQUE (queue_domain, severity);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: push_campaign_deliveries push_campaign_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_campaign_deliveries
    ADD CONSTRAINT push_campaign_deliveries_pkey PRIMARY KEY (id);


--
-- Name: push_campaigns push_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_campaigns
    ADD CONSTRAINT push_campaigns_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_target_type_target_id_reporter_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_type_target_id_reporter_id_key UNIQUE (target_type, target_id, reporter_id);


--
-- Name: revenue_deals revenue_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_deals
    ADD CONSTRAINT revenue_deals_pkey PRIMARY KEY (id);


--
-- Name: session_participants session_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_pkey PRIMARY KEY (id);


--
-- Name: session_participants session_participants_session_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_session_id_user_id_key UNIQUE (session_id, user_id);


--
-- Name: study_sessions study_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_pkey PRIMARY KEY (id);


--
-- Name: universities universities_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_domain_key UNIQUE (domain);


--
-- Name: universities universities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_pkey PRIMARY KEY (id);


--
-- Name: university_domain_aliases university_domain_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.university_domain_aliases
    ADD CONSTRAINT university_domain_aliases_pkey PRIMARY KEY (alias_domain);


--
-- Name: user_consents user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_pkey PRIMARY KEY (id);


--
-- Name: user_courses user_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_pkey PRIMARY KEY (id);


--
-- Name: user_courses user_courses_user_id_course_id_semester_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_user_id_course_id_semester_key UNIQUE (user_id, course_id, semester);


--
-- Name: user_presence user_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_presence
    ADD CONSTRAINT user_presence_pkey PRIMARY KEY (user_id);


--
-- Name: user_sanctions user_sanctions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sanctions
    ADD CONSTRAINT user_sanctions_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_sister_universities user_sister_universities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sister_universities
    ADD CONSTRAINT user_sister_universities_pkey PRIMARY KEY (user_id, university_domain);


--
-- Name: idx_admin_audit_logs_actor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_actor_created ON ONLY public.admin_audit_logs USING btree (actor_id, created_at DESC);


--
-- Name: admin_audit_logs_202603_actor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202603_actor_id_created_at_idx ON public.admin_audit_logs_202603 USING btree (actor_id, created_at DESC);


--
-- Name: idx_admin_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_entity ON ONLY public.admin_audit_logs USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: admin_audit_logs_202603_entity_type_entity_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202603_entity_type_entity_id_created_at_idx ON public.admin_audit_logs_202603 USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_admin_audit_logs_permission_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_permission_created ON ONLY public.admin_audit_logs USING btree (permission_key, created_at DESC);


--
-- Name: admin_audit_logs_202603_permission_key_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202603_permission_key_created_at_idx ON public.admin_audit_logs_202603 USING btree (permission_key, created_at DESC);


--
-- Name: idx_admin_audit_logs_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_request ON ONLY public.admin_audit_logs USING btree (request_id);


--
-- Name: admin_audit_logs_202603_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202603_request_id_idx ON public.admin_audit_logs_202603 USING btree (request_id);


--
-- Name: admin_audit_logs_202604_actor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202604_actor_id_created_at_idx ON public.admin_audit_logs_202604 USING btree (actor_id, created_at DESC);


--
-- Name: admin_audit_logs_202604_entity_type_entity_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202604_entity_type_entity_id_created_at_idx ON public.admin_audit_logs_202604 USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: admin_audit_logs_202604_permission_key_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202604_permission_key_created_at_idx ON public.admin_audit_logs_202604 USING btree (permission_key, created_at DESC);


--
-- Name: admin_audit_logs_202604_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_202604_request_id_idx ON public.admin_audit_logs_202604 USING btree (request_id);


--
-- Name: admin_audit_logs_default_actor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_default_actor_id_created_at_idx ON public.admin_audit_logs_default USING btree (actor_id, created_at DESC);


--
-- Name: admin_audit_logs_default_entity_type_entity_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_default_entity_type_entity_id_created_at_idx ON public.admin_audit_logs_default USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: admin_audit_logs_default_permission_key_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_default_permission_key_created_at_idx ON public.admin_audit_logs_default USING btree (permission_key, created_at DESC);


--
-- Name: admin_audit_logs_default_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_logs_default_request_id_idx ON public.admin_audit_logs_default USING btree (request_id);


--
-- Name: idx_telemetry_endpoint_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_endpoint_created ON ONLY public.app_telemetry_events USING btree (endpoint, created_at DESC);


--
-- Name: app_telemetry_events_202603_endpoint_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202603_endpoint_created_at_idx ON public.app_telemetry_events_202603 USING btree (endpoint, created_at DESC);


--
-- Name: idx_telemetry_event_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_event_type_created ON ONLY public.app_telemetry_events USING btree (event_type, created_at DESC);


--
-- Name: app_telemetry_events_202603_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202603_event_type_created_at_idx ON public.app_telemetry_events_202603 USING btree (event_type, created_at DESC);


--
-- Name: idx_telemetry_user_event_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_user_event_created ON ONLY public.app_telemetry_events USING btree (user_id, event_type, created_at DESC);


--
-- Name: app_telemetry_events_202603_user_id_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202603_user_id_event_type_created_at_idx ON public.app_telemetry_events_202603 USING btree (user_id, event_type, created_at DESC);


--
-- Name: app_telemetry_events_202604_endpoint_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202604_endpoint_created_at_idx ON public.app_telemetry_events_202604 USING btree (endpoint, created_at DESC);


--
-- Name: app_telemetry_events_202604_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202604_event_type_created_at_idx ON public.app_telemetry_events_202604 USING btree (event_type, created_at DESC);


--
-- Name: app_telemetry_events_202604_user_id_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_202604_user_id_event_type_created_at_idx ON public.app_telemetry_events_202604 USING btree (user_id, event_type, created_at DESC);


--
-- Name: app_telemetry_events_default_endpoint_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_default_endpoint_created_at_idx ON public.app_telemetry_events_default USING btree (endpoint, created_at DESC);


--
-- Name: app_telemetry_events_default_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_default_event_type_created_at_idx ON public.app_telemetry_events_default USING btree (event_type, created_at DESC);


--
-- Name: app_telemetry_events_default_user_id_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_telemetry_events_default_user_id_event_type_created_at_idx ON public.app_telemetry_events_default USING btree (user_id, event_type, created_at DESC);


--
-- Name: city_events_source_submission_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX city_events_source_submission_id_uniq ON public.city_events USING btree (source_submission_id) WHERE (source_submission_id IS NOT NULL);


--
-- Name: communities_university_domain_lower_name_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX communities_university_domain_lower_name_uniq ON public.communities USING btree (university_domain, lower(name));


--
-- Name: idx_admin_action_approvals_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_action_approvals_status_created ON public.admin_action_approvals USING btree (status, created_at DESC);


--
-- Name: idx_admin_incidents_status_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_incidents_status_started ON public.admin_incident_events USING btree (status, started_at DESC);


--
-- Name: idx_admin_stats_snapshot_single; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_admin_stats_snapshot_single ON public.admin_stats_snapshot USING btree ((1));


--
-- Name: idx_appeals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appeals_status ON public.moderation_appeals USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_appeals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appeals_user ON public.moderation_appeals USING btree (user_id);


--
-- Name: idx_city_events_city_status_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_city_events_city_status_starts ON public.city_events USING btree (city_id, status, starts_at);


--
-- Name: idx_city_events_sponsored; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_city_events_sponsored ON public.city_events USING btree (city_id, is_sponsored, starts_at);


--
-- Name: idx_communities_domain_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communities_domain_active ON public.communities USING btree (university_domain, is_active, created_at DESC);


--
-- Name: idx_communities_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communities_name_trgm ON public.communities USING gin (name extensions.gin_trgm_ops);


--
-- Name: idx_community_events_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_events_feed ON public.community_events USING btree (community_id, starts_at);


--
-- Name: idx_community_members_community_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_members_community_status ON public.community_members USING btree (community_id, status);


--
-- Name: idx_community_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_members_user ON public.community_members USING btree (user_id);


--
-- Name: idx_community_posts_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_posts_feed ON public.community_posts USING btree (community_id, is_pinned DESC, created_at DESC);


--
-- Name: idx_confession_bookmarks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_bookmarks_user ON public.confession_bookmarks USING btree (user_id, confession_id);


--
-- Name: idx_confession_comments_author_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_author_created ON public.confession_comments USING btree (author_id, created_at DESC);


--
-- Name: idx_confession_comments_author_normalized_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_author_normalized_created ON public.confession_comments USING btree (author_id, normalized_body, created_at DESC) WHERE (normalized_body IS NOT NULL);


--
-- Name: idx_confession_comments_confession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_confession ON public.confession_comments USING btree (confession_id, created_at);


--
-- Name: idx_confession_comments_hidden_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_hidden_at ON public.confession_comments USING btree (hidden_at);


--
-- Name: idx_confession_comments_published_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_published_v2 ON public.confession_comments USING btree (confession_id, created_at, id) WHERE ((hidden_at IS NULL) AND (moderation_status = 'published'::text));


--
-- Name: idx_confession_comments_reply; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_comments_reply ON public.confession_comments USING btree (reply_to);


--
-- Name: idx_confession_likes_confession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_likes_confession ON public.confession_likes USING btree (confession_id);


--
-- Name: idx_confession_likes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_likes_user ON public.confession_likes USING btree (user_id, confession_id);


--
-- Name: idx_confession_reports_confession; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confession_reports_confession ON public.confession_reports USING btree (confession_id);


--
-- Name: idx_confessions_author_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_author_created ON public.confessions USING btree (author_id, created_at DESC);


--
-- Name: idx_confessions_author_normalized_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_author_normalized_created ON public.confessions USING btree (author_id, normalized_body, created_at DESC) WHERE (normalized_body IS NOT NULL);


--
-- Name: idx_confessions_body_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_body_trgm ON public.confessions USING gin (body extensions.gin_trgm_ops);


--
-- Name: idx_confessions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_category ON public.confessions USING btree (university_domain, category, created_at DESC);


--
-- Name: idx_confessions_hidden_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_hidden_at ON public.confessions USING btree (hidden_at);


--
-- Name: idx_confessions_published_feed_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_published_feed_v2 ON public.confessions USING btree (university_domain, category, created_at DESC, id DESC) WHERE ((hidden_at IS NULL) AND (moderation_status = 'published'::text));


--
-- Name: idx_confessions_trending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_trending ON public.confessions USING btree (university_domain, like_count DESC, created_at DESC);


--
-- Name: idx_confessions_trending_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_trending_v2 ON public.confessions USING btree (university_domain, like_count DESC, comment_count DESC, created_at DESC) WHERE ((hidden_at IS NULL) AND (moderation_status = 'published'::text));


--
-- Name: idx_confessions_university_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_confessions_university_created ON public.confessions USING btree (university_domain, created_at DESC);


--
-- Name: idx_courses_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_code_trgm ON public.courses USING gin (code extensions.gin_trgm_ops);


--
-- Name: idx_courses_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_name_trgm ON public.courses USING gin (name extensions.gin_trgm_ops);


--
-- Name: idx_device_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_tokens_user ON public.device_tokens USING btree (user_id);


--
-- Name: idx_event_campaign_logs_event_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_campaign_logs_event_type_created ON public.event_campaign_logs USING btree (event_id, event_type, created_at DESC);


--
-- Name: idx_event_campaign_logs_story_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_campaign_logs_story_created ON public.event_campaign_logs USING btree (story_slot_id, created_at DESC);


--
-- Name: idx_event_story_slots_city_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_story_slots_city_time ON public.event_story_slots USING btree (city_id, starts_at, ends_at);


--
-- Name: idx_moderation_scan_actor_decision_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_scan_actor_decision_created ON public.moderation_scan_logs USING btree (actor_user_id, decision, created_at DESC);


--
-- Name: idx_moderation_scan_content_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_scan_content_created ON public.moderation_scan_logs USING btree (content_scope, content_id, created_at DESC);


--
-- Name: idx_moderation_word_rules_scope_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moderation_word_rules_scope_enabled ON public.moderation_word_rules USING btree (scope, enabled, action, severity);


--
-- Name: idx_note_comments_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_note_comments_note ON public.note_comments USING btree (note_id);


--
-- Name: idx_note_votes_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_note_votes_note ON public.note_votes USING btree (note_id);


--
-- Name: idx_note_votes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_note_votes_user ON public.note_votes USING btree (user_id);


--
-- Name: idx_notes_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_author ON public.notes USING btree (author_id);


--
-- Name: idx_notes_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_author_id ON public.notes USING btree (author_id);


--
-- Name: idx_notes_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_course ON public.notes USING btree (course_id);


--
-- Name: idx_notes_course_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_course_id ON public.notes USING btree (course_id);


--
-- Name: idx_notes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_created_at ON public.notes USING btree (created_at DESC);


--
-- Name: idx_notes_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_domain ON public.notes USING btree (university_domain);


--
-- Name: idx_notes_flagged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_flagged ON public.notes USING btree (is_flagged) WHERE (is_flagged = true);


--
-- Name: idx_notes_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_title_trgm ON public.notes USING gin (title extensions.gin_trgm_ops);


--
-- Name: idx_notes_university; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_university ON public.notes USING btree (university_domain);


--
-- Name: idx_notes_uploader_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_uploader_id ON public.notes USING btree (uploader_id) WHERE (uploader_id IS NOT NULL);


--
-- Name: idx_notifications_recipient_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_created_at ON public.notifications USING btree (recipient_id, created_at DESC);


--
-- Name: idx_notifications_recipient_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_unread ON public.notifications USING btree (recipient_id, is_read) WHERE (is_read = false);


--
-- Name: idx_ops_queue_assignments_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_queue_assignments_admin ON public.ops_queue_assignments USING btree (admin_id, assigned_at DESC);


--
-- Name: idx_ops_queue_assignments_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_queue_assignments_queue ON public.ops_queue_assignments USING btree (queue_item_id, assigned_at DESC);


--
-- Name: idx_ops_queue_items_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_queue_items_created ON public.ops_queue_items USING btree (created_at DESC);


--
-- Name: idx_ops_queue_items_domain_state_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_queue_items_domain_state_due ON public.ops_queue_items USING btree (queue_domain, state, due_at);


--
-- Name: idx_ops_queue_items_owner_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_queue_items_owner_state ON public.ops_queue_items USING btree (owner_id, state, updated_at DESC);


--
-- Name: idx_participants_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_session ON public.session_participants USING btree (session_id, status);


--
-- Name: idx_profiles_banned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_banned ON public.profiles USING btree (is_banned) WHERE (is_banned = true);


--
-- Name: idx_profiles_department_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_department_id ON public.profiles USING btree (department_id) WHERE (department_id IS NOT NULL);


--
-- Name: idx_profiles_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email_trgm ON public.profiles USING gin (email extensions.gin_trgm_ops);


--
-- Name: idx_profiles_faculty_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_faculty_id ON public.profiles USING btree (faculty_id) WHERE (faculty_id IS NOT NULL);


--
-- Name: idx_profiles_full_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_full_name_trgm ON public.profiles USING gin (full_name extensions.gin_trgm_ops);


--
-- Name: idx_profiles_restricted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_restricted ON public.profiles USING btree (is_restricted) WHERE (is_restricted = true);


--
-- Name: idx_profiles_username_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_username_trgm ON public.profiles USING gin (username extensions.gin_trgm_ops);


--
-- Name: idx_push_campaign_deliveries_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_campaign_deliveries_campaign ON public.push_campaign_deliveries USING btree (campaign_id, batch_index);


--
-- Name: idx_push_campaigns_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_campaigns_status_created ON public.push_campaigns USING btree (status, created_at DESC);


--
-- Name: idx_reports_reporter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_reporter ON public.reports USING btree (reporter_id, created_at DESC);


--
-- Name: idx_reports_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status_created ON public.reports USING btree (status, created_at DESC);


--
-- Name: idx_reports_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_target ON public.reports USING btree (target_type, target_id, created_at DESC);


--
-- Name: idx_revenue_deals_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_deals_partner ON public.revenue_deals USING btree (partner_id, created_at DESC);


--
-- Name: idx_revenue_deals_stage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_deals_stage_created ON public.revenue_deals USING btree (stage, created_at DESC);


--
-- Name: idx_sessions_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_course ON public.study_sessions USING btree (course_id) WHERE (status = 'active'::text);


--
-- Name: idx_sessions_university_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_university_status ON public.study_sessions USING btree (university_domain, status, starts_at DESC);


--
-- Name: idx_study_sessions_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_sessions_title_trgm ON public.study_sessions USING gin (title extensions.gin_trgm_ops);


--
-- Name: idx_user_consents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_consents_user ON public.user_consents USING btree (user_id, consent_type);


--
-- Name: idx_user_courses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_courses_user ON public.user_courses USING btree (user_id);


--
-- Name: idx_user_sanctions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sanctions_active ON public.user_sanctions USING btree (user_id, is_active) WHERE (is_active = true);


--
-- Name: idx_user_sanctions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sanctions_user_id ON public.user_sanctions USING btree (user_id);


--
-- Name: admin_audit_logs_202603_actor_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_actor_created ATTACH PARTITION public.admin_audit_logs_202603_actor_id_created_at_idx;


--
-- Name: admin_audit_logs_202603_entity_type_entity_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_entity ATTACH PARTITION public.admin_audit_logs_202603_entity_type_entity_id_created_at_idx;


--
-- Name: admin_audit_logs_202603_permission_key_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_permission_created ATTACH PARTITION public.admin_audit_logs_202603_permission_key_created_at_idx;


--
-- Name: admin_audit_logs_202603_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.admin_audit_logs_pkey ATTACH PARTITION public.admin_audit_logs_202603_pkey;


--
-- Name: admin_audit_logs_202603_request_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_request ATTACH PARTITION public.admin_audit_logs_202603_request_id_idx;


--
-- Name: admin_audit_logs_202604_actor_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_actor_created ATTACH PARTITION public.admin_audit_logs_202604_actor_id_created_at_idx;


--
-- Name: admin_audit_logs_202604_entity_type_entity_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_entity ATTACH PARTITION public.admin_audit_logs_202604_entity_type_entity_id_created_at_idx;


--
-- Name: admin_audit_logs_202604_permission_key_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_permission_created ATTACH PARTITION public.admin_audit_logs_202604_permission_key_created_at_idx;


--
-- Name: admin_audit_logs_202604_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.admin_audit_logs_pkey ATTACH PARTITION public.admin_audit_logs_202604_pkey;


--
-- Name: admin_audit_logs_202604_request_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_request ATTACH PARTITION public.admin_audit_logs_202604_request_id_idx;


--
-- Name: admin_audit_logs_default_actor_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_actor_created ATTACH PARTITION public.admin_audit_logs_default_actor_id_created_at_idx;


--
-- Name: admin_audit_logs_default_entity_type_entity_id_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_entity ATTACH PARTITION public.admin_audit_logs_default_entity_type_entity_id_created_at_idx;


--
-- Name: admin_audit_logs_default_permission_key_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_permission_created ATTACH PARTITION public.admin_audit_logs_default_permission_key_created_at_idx;


--
-- Name: admin_audit_logs_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.admin_audit_logs_pkey ATTACH PARTITION public.admin_audit_logs_default_pkey;


--
-- Name: admin_audit_logs_default_request_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_admin_audit_logs_request ATTACH PARTITION public.admin_audit_logs_default_request_id_idx;


--
-- Name: app_telemetry_events_202603_endpoint_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_endpoint_created ATTACH PARTITION public.app_telemetry_events_202603_endpoint_created_at_idx;


--
-- Name: app_telemetry_events_202603_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_event_type_created ATTACH PARTITION public.app_telemetry_events_202603_event_type_created_at_idx;


--
-- Name: app_telemetry_events_202603_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.app_telemetry_events_pkey ATTACH PARTITION public.app_telemetry_events_202603_pkey;


--
-- Name: app_telemetry_events_202603_user_id_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_user_event_created ATTACH PARTITION public.app_telemetry_events_202603_user_id_event_type_created_at_idx;


--
-- Name: app_telemetry_events_202604_endpoint_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_endpoint_created ATTACH PARTITION public.app_telemetry_events_202604_endpoint_created_at_idx;


--
-- Name: app_telemetry_events_202604_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_event_type_created ATTACH PARTITION public.app_telemetry_events_202604_event_type_created_at_idx;


--
-- Name: app_telemetry_events_202604_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.app_telemetry_events_pkey ATTACH PARTITION public.app_telemetry_events_202604_pkey;


--
-- Name: app_telemetry_events_202604_user_id_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_user_event_created ATTACH PARTITION public.app_telemetry_events_202604_user_id_event_type_created_at_idx;


--
-- Name: app_telemetry_events_default_endpoint_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_endpoint_created ATTACH PARTITION public.app_telemetry_events_default_endpoint_created_at_idx;


--
-- Name: app_telemetry_events_default_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_event_type_created ATTACH PARTITION public.app_telemetry_events_default_event_type_created_at_idx;


--
-- Name: app_telemetry_events_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.app_telemetry_events_pkey ATTACH PARTITION public.app_telemetry_events_default_pkey;


--
-- Name: app_telemetry_events_default_user_id_event_type_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_user_event_created ATTACH PARTITION public.app_telemetry_events_default_user_id_event_type_created_at_idx;


--
-- Name: confession_comments trg_comment_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comment_rate_limit BEFORE INSERT ON public.confession_comments FOR EACH ROW EXECUTE FUNCTION public.check_comment_rate_limit();


--
-- Name: confession_comments trg_confession_comment_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_confession_comment_count AFTER INSERT OR DELETE ON public.confession_comments FOR EACH ROW EXECUTE FUNCTION public.update_confession_comment_count();


--
-- Name: confession_likes trg_confession_like_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_confession_like_count AFTER INSERT OR DELETE ON public.confession_likes FOR EACH ROW EXECUTE FUNCTION public.update_confession_like_count();


--
-- Name: confessions trg_confession_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_confession_rate_limit BEFORE INSERT ON public.confessions FOR EACH ROW EXECUTE FUNCTION public.check_confession_rate_limit();


--
-- Name: notes trg_note_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_note_rate_limit BEFORE INSERT ON public.notes FOR EACH ROW EXECUTE FUNCTION public.check_note_rate_limit();


--
-- Name: session_participants trg_session_participant_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_session_participant_count AFTER INSERT OR DELETE OR UPDATE ON public.session_participants FOR EACH ROW EXECUTE FUNCTION public.update_session_participant_count();


--
-- Name: user_sanctions trg_sync_banned_on_sanction; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_banned_on_sanction AFTER INSERT OR DELETE OR UPDATE ON public.user_sanctions FOR EACH ROW EXECUTE FUNCTION public.sync_user_banned_status();


--
-- Name: community_members trg_sync_community_member_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_community_member_count AFTER INSERT OR DELETE OR UPDATE ON public.community_members FOR EACH ROW EXECUTE FUNCTION public.sync_community_member_count();


--
-- Name: confession_reports trg_sync_confession_report_into_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_confession_report_into_reports AFTER INSERT ON public.confession_reports FOR EACH ROW EXECUTE FUNCTION public.sync_confession_report_into_reports();


--
-- Name: event_story_slots trg_sync_event_story_slot_city; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_event_story_slot_city BEFORE INSERT OR UPDATE ON public.event_story_slots FOR EACH ROW EXECUTE FUNCTION public.sync_event_story_slot_city();


--
-- Name: event_submissions trg_sync_event_submission_queue_item; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_event_submission_queue_item AFTER INSERT OR UPDATE OF status ON public.event_submissions FOR EACH ROW EXECUTE FUNCTION public.sync_event_submission_queue_item();


--
-- Name: note_votes trg_sync_note_vote_score; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_note_vote_score AFTER INSERT OR DELETE OR UPDATE ON public.note_votes FOR EACH ROW EXECUTE FUNCTION public.sync_note_vote_score();


--
-- Name: reports trg_sync_report_queue_item; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_report_queue_item AFTER INSERT OR UPDATE OF status ON public.reports FOR EACH ROW EXECUTE FUNCTION public.sync_report_queue_item();


--
-- Name: user_presence trg_user_presence_timestamps; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_presence_timestamps BEFORE INSERT OR UPDATE ON public.user_presence FOR EACH ROW EXECUTE FUNCTION public.set_user_presence_timestamps();


--
-- Name: user_settings trg_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_user_settings_updated_at();


--
-- Name: admin_action_approvals admin_action_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_approvals
    ADD CONSTRAINT admin_action_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: admin_action_approvals admin_action_approvals_permission_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_approvals
    ADD CONSTRAINT admin_action_approvals_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES public.admin_permissions(permission_key) ON DELETE RESTRICT;


--
-- Name: admin_action_approvals admin_action_approvals_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_action_approvals
    ADD CONSTRAINT admin_action_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.admin_identities(id) ON DELETE RESTRICT;


--
-- Name: admin_audit_logs admin_audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: admin_feature_flags admin_feature_flags_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_feature_flags
    ADD CONSTRAINT admin_feature_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: admin_incident_events admin_incident_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_incident_events
    ADD CONSTRAINT admin_incident_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: admin_role_bindings admin_role_bindings_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_bindings
    ADD CONSTRAINT admin_role_bindings_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.admin_identities(id) ON DELETE CASCADE;


--
-- Name: admin_role_bindings admin_role_bindings_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_bindings
    ADD CONSTRAINT admin_role_bindings_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.admin_roles(id) ON DELETE CASCADE;


--
-- Name: admin_role_permissions admin_role_permissions_permission_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_permissions
    ADD CONSTRAINT admin_role_permissions_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES public.admin_permissions(permission_key) ON DELETE CASCADE;


--
-- Name: admin_role_permissions admin_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_role_permissions
    ADD CONSTRAINT admin_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.admin_roles(id) ON DELETE CASCADE;


--
-- Name: app_telemetry_events app_telemetry_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.app_telemetry_events
    ADD CONSTRAINT app_telemetry_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: city_events city_events_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_events
    ADD CONSTRAINT city_events_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: city_events city_events_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_events
    ADD CONSTRAINT city_events_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.event_partners(id) ON DELETE RESTRICT;


--
-- Name: city_events city_events_source_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.city_events
    ADD CONSTRAINT city_events_source_submission_id_fkey FOREIGN KEY (source_submission_id) REFERENCES public.event_submissions(id) ON DELETE SET NULL;


--
-- Name: communities communities_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_events community_events_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_events
    ADD CONSTRAINT community_events_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_events community_events_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_events
    ADD CONSTRAINT community_events_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: community_members community_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_members
    ADD CONSTRAINT community_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_posts community_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_posts community_posts_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: community_requests community_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_requests
    ADD CONSTRAINT community_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: confession_bookmarks confession_bookmarks_confession_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_bookmarks
    ADD CONSTRAINT confession_bookmarks_confession_id_fkey FOREIGN KEY (confession_id) REFERENCES public.confessions(id) ON DELETE CASCADE;


--
-- Name: confession_bookmarks confession_bookmarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_bookmarks
    ADD CONSTRAINT confession_bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: confession_comments confession_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_comments
    ADD CONSTRAINT confession_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: confession_comments confession_comments_confession_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_comments
    ADD CONSTRAINT confession_comments_confession_id_fkey FOREIGN KEY (confession_id) REFERENCES public.confessions(id) ON DELETE CASCADE;


--
-- Name: confession_comments confession_comments_hidden_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_comments
    ADD CONSTRAINT confession_comments_hidden_by_admin_id_fkey FOREIGN KEY (hidden_by_admin_id) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: confession_comments confession_comments_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_comments
    ADD CONSTRAINT confession_comments_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.confession_comments(id) ON DELETE SET NULL;


--
-- Name: confession_likes confession_likes_confession_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_likes
    ADD CONSTRAINT confession_likes_confession_id_fkey FOREIGN KEY (confession_id) REFERENCES public.confessions(id) ON DELETE CASCADE;


--
-- Name: confession_likes confession_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_likes
    ADD CONSTRAINT confession_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: confession_reports confession_reports_confession_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_reports
    ADD CONSTRAINT confession_reports_confession_id_fkey FOREIGN KEY (confession_id) REFERENCES public.confessions(id) ON DELETE CASCADE;


--
-- Name: confession_reports confession_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confession_reports
    ADD CONSTRAINT confession_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: confessions confessions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confessions
    ADD CONSTRAINT confessions_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: confessions confessions_hidden_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.confessions
    ADD CONSTRAINT confessions_hidden_by_admin_id_fkey FOREIGN KEY (hidden_by_admin_id) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: departments departments_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(id) ON DELETE CASCADE;


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_campaign_logs event_campaign_logs_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_campaign_logs
    ADD CONSTRAINT event_campaign_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.city_events(id) ON DELETE SET NULL;


--
-- Name: event_campaign_logs event_campaign_logs_story_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_campaign_logs
    ADD CONSTRAINT event_campaign_logs_story_slot_id_fkey FOREIGN KEY (story_slot_id) REFERENCES public.event_story_slots(id) ON DELETE SET NULL;


--
-- Name: event_campaign_logs event_campaign_logs_viewer_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_campaign_logs
    ADD CONSTRAINT event_campaign_logs_viewer_city_id_fkey FOREIGN KEY (viewer_city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: event_campaign_logs event_campaign_logs_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_campaign_logs
    ADD CONSTRAINT event_campaign_logs_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: event_story_slots event_story_slots_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_story_slots
    ADD CONSTRAINT event_story_slots_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: event_story_slots event_story_slots_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_story_slots
    ADD CONSTRAINT event_story_slots_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.city_events(id) ON DELETE CASCADE;


--
-- Name: event_submissions event_submissions_approved_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_submissions
    ADD CONSTRAINT event_submissions_approved_event_id_fkey FOREIGN KEY (approved_event_id) REFERENCES public.city_events(id) ON DELETE SET NULL;


--
-- Name: event_submissions event_submissions_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_submissions
    ADD CONSTRAINT event_submissions_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: landing_page_sections landing_page_sections_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_sections
    ADD CONSTRAINT landing_page_sections_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: moderation_appeals moderation_appeals_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: moderation_appeals moderation_appeals_sanction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_sanction_id_fkey FOREIGN KEY (sanction_id) REFERENCES public.user_sanctions(id) ON DELETE SET NULL;


--
-- Name: moderation_appeals moderation_appeals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: moderation_scan_logs moderation_scan_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_scan_logs
    ADD CONSTRAINT moderation_scan_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: moderation_word_rules moderation_word_rules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_word_rules
    ADD CONSTRAINT moderation_word_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: note_comments note_comments_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_comments
    ADD CONSTRAINT note_comments_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: note_comments note_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_comments
    ADD CONSTRAINT note_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: note_votes note_votes_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_votes
    ADD CONSTRAINT note_votes_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;


--
-- Name: note_votes note_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_votes
    ADD CONSTRAINT note_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notes notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notes notes_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: notes notes_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ops_queue_assignments ops_queue_assignments_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_assignments
    ADD CONSTRAINT ops_queue_assignments_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_identities(id) ON DELETE RESTRICT;


--
-- Name: ops_queue_assignments ops_queue_assignments_queue_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_assignments
    ADD CONSTRAINT ops_queue_assignments_queue_item_id_fkey FOREIGN KEY (queue_item_id) REFERENCES public.ops_queue_items(id) ON DELETE CASCADE;


--
-- Name: ops_queue_items ops_queue_items_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_queue_items
    ADD CONSTRAINT ops_queue_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_campaign_deliveries push_campaign_deliveries_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_campaign_deliveries
    ADD CONSTRAINT push_campaign_deliveries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.push_campaigns(id) ON DELETE CASCADE;


--
-- Name: push_campaigns push_campaigns_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_campaigns
    ADD CONSTRAINT push_campaigns_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: push_campaigns push_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_campaigns
    ADD CONSTRAINT push_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: revenue_deals revenue_deals_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_deals
    ADD CONSTRAINT revenue_deals_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: revenue_deals revenue_deals_owner_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_deals
    ADD CONSTRAINT revenue_deals_owner_identity_id_fkey FOREIGN KEY (owner_identity_id) REFERENCES public.admin_identities(id) ON DELETE SET NULL;


--
-- Name: revenue_deals revenue_deals_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_deals
    ADD CONSTRAINT revenue_deals_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.event_partners(id) ON DELETE RESTRICT;


--
-- Name: session_participants session_participants_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


--
-- Name: session_participants session_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: study_sessions study_sessions_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: study_sessions study_sessions_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: universities universities_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universities
    ADD CONSTRAINT universities_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: university_domain_aliases university_domain_aliases_university_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.university_domain_aliases
    ADD CONSTRAINT university_domain_aliases_university_id_fkey FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE;


--
-- Name: user_consents user_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_courses user_courses_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: user_courses user_courses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_courses
    ADD CONSTRAINT user_courses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_presence user_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_presence
    ADD CONSTRAINT user_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_sanctions user_sanctions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sanctions
    ADD CONSTRAINT user_sanctions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_sister_universities user_sister_universities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sister_universities
    ADD CONSTRAINT user_sister_universities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notes Aynı üniversite notları görebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Aynı üniversite notları görebilir" ON public.notes FOR SELECT USING ((university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: cities Cities are readable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Cities are readable by everyone" ON public.cities FOR SELECT USING (true);


--
-- Name: departments Departments are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Departments are public" ON public.departments FOR SELECT USING (true);


--
-- Name: faculties Faculties are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Faculties are public" ON public.faculties FOR SELECT USING (true);


--
-- Name: note_votes Herkes oy verebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Herkes oy verebilir" ON public.note_votes USING ((user_id = auth.uid()));


--
-- Name: notes Kendi notunu ekleyebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kendi notunu ekleyebilir" ON public.notes FOR INSERT WITH CHECK ((author_id = auth.uid()));


--
-- Name: notes Kendi notunu silebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kendi notunu silebilir" ON public.notes FOR DELETE USING ((author_id = auth.uid()));


--
-- Name: note_comments Kendi yorumunu silebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kendi yorumunu silebilir" ON public.note_comments FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: universities Universities are readable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Universities are readable by everyone" ON public.universities FOR SELECT USING (true);


--
-- Name: university_domain_aliases University domain aliases are readable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "University domain aliases are readable by everyone" ON public.university_domain_aliases FOR SELECT USING (true);


--
-- Name: user_sister_universities Users can manage own sister universities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own sister universities" ON public.user_sister_universities USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_sister_universities Users can read other users sister universities for matching; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read other users sister universities for matching" ON public.user_sister_universities FOR SELECT USING (true);


--
-- Name: note_comments Yorum ekleyebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Yorum ekleyebilir" ON public.note_comments FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: note_comments Yorumları okuyabilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Yorumları okuyabilir" ON public.note_comments FOR SELECT USING (true);


--
-- Name: admin_action_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_action_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_logs_202603; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs_202603 ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_logs_202604; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs_202604 ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_logs_default; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs_default ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_incident_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_incident_events ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_role_bindings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_role_bindings ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: app_telemetry_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_telemetry_events ENABLE ROW LEVEL SECURITY;

--
-- Name: app_telemetry_events_202603; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_telemetry_events_202603 ENABLE ROW LEVEL SECURITY;

--
-- Name: app_telemetry_events_202604; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_telemetry_events_202604 ENABLE ROW LEVEL SECURITY;

--
-- Name: app_telemetry_events_default; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_telemetry_events_default ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_likes banned_users_cannot_insert_likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY banned_users_cannot_insert_likes ON public.confession_likes FOR INSERT WITH CHECK ((NOT public.is_user_banned(auth.uid())));


--
-- Name: cities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

--
-- Name: city_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.city_events ENABLE ROW LEVEL SECURITY;

--
-- Name: city_events city_events_select_same_city; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY city_events_select_same_city ON public.city_events FOR SELECT USING (((auth.uid() IS NOT NULL) AND (city_id = public.current_user_event_city_id()) AND (status = ANY (ARRAY['approved'::text, 'scheduled'::text, 'live'::text])) AND (COALESCE(ends_at, starts_at) >= now())));


--
-- Name: communities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;

--
-- Name: communities communities_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communities_delete_owner ON public.communities FOR DELETE USING ((owner_id = auth.uid()));


--
-- Name: communities communities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communities_insert ON public.communities FOR INSERT WITH CHECK (((auth.role() = 'authenticated'::text) AND (owner_id = auth.uid()) AND (university_domain = ( SELECT p.university_domain
   FROM public.profiles p
  WHERE (p.id = auth.uid())))));


--
-- Name: communities communities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communities_select ON public.communities FOR SELECT USING (((auth.role() = 'authenticated'::text) AND (is_active = true) AND (university_domain = ( SELECT p.university_domain
   FROM public.profiles p
  WHERE (p.id = auth.uid())))));


--
-- Name: communities communities_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communities_update_owner ON public.communities FOR UPDATE USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: community_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;

--
-- Name: community_events community_events_delete_author_or_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_events_delete_author_or_staff ON public.community_events FOR DELETE USING (((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_events.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));


--
-- Name: community_events community_events_insert_active_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_events_insert_active_member ON public.community_events FOR INSERT WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_events.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text))))));


--
-- Name: community_events community_events_select_active_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_events_select_active_member ON public.community_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_events.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text)))));


--
-- Name: community_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

--
-- Name: community_members community_members_delete_self_or_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_members_delete_self_or_staff ON public.community_members FOR DELETE USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_members.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));


--
-- Name: community_members community_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_members_insert ON public.community_members FOR INSERT WITH CHECK (((auth.role() = 'authenticated'::text) AND (user_id = auth.uid()) AND (((role = 'member'::text) AND (status = ANY (ARRAY['active'::text, 'pending'::text]))) OR ((role = 'owner'::text) AND (status = 'active'::text) AND (EXISTS ( SELECT 1
   FROM public.communities c
  WHERE ((c.id = community_members.community_id) AND (c.owner_id = auth.uid()))))))));


--
-- Name: community_members community_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_members_select ON public.community_members FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_members.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));


--
-- Name: community_members community_members_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_members_update_staff ON public.community_members FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_members.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_members.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: community_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: community_posts community_posts_delete_author_or_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_posts_delete_author_or_staff ON public.community_posts FOR DELETE USING (((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_posts.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));


--
-- Name: community_posts community_posts_insert_active_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_posts_insert_active_member ON public.community_posts FOR INSERT WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_posts.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text))))));


--
-- Name: community_posts community_posts_select_active_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_posts_select_active_member ON public.community_posts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.community_members me
  WHERE ((me.community_id = community_posts.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text)))));


--
-- Name: community_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_bookmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confession_bookmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_bookmarks confession_bookmarks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_bookmarks_delete ON public.confession_bookmarks FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: confession_bookmarks confession_bookmarks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_bookmarks_insert ON public.confession_bookmarks FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: confession_bookmarks confession_bookmarks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_bookmarks_select ON public.confession_bookmarks FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: confession_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confession_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_comments confession_comments_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_comments_delete_admin ON public.confession_comments FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));


--
-- Name: confession_comments confession_comments_insert_legacy_rollout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_comments_insert_legacy_rollout ON public.confession_comments FOR INSERT WITH CHECK (((auth.uid() = author_id) AND (NOT public.is_user_banned(auth.uid())) AND (NOT public.is_user_restricted(auth.uid())) AND (NOT public.is_kursu_server_moderation_enabled(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.confessions c
  WHERE ((c.id = confession_comments.confession_id) AND (c.university_domain = ( SELECT p.university_domain
           FROM public.profiles p
          WHERE (p.id = auth.uid()))) AND (c.hidden_at IS NULL) AND (COALESCE(c.moderation_status, 'published'::text) = 'published'::text))))));


--
-- Name: confession_comments confession_comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_comments_select ON public.confession_comments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.confessions c
  WHERE ((c.id = confession_comments.confession_id) AND (c.university_domain = ( SELECT profiles.university_domain
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: confession_likes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confession_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_likes confession_likes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_likes_delete ON public.confession_likes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: confession_likes confession_likes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_likes_insert ON public.confession_likes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: confession_likes confession_likes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_likes_select ON public.confession_likes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.confessions c
  WHERE ((c.id = confession_likes.confession_id) AND (c.university_domain = ( SELECT profiles.university_domain
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: confession_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confession_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: confession_reports confession_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_reports_insert ON public.confession_reports FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: confession_reports confession_reports_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confession_reports_select_admin ON public.confession_reports FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));


--
-- Name: confessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;

--
-- Name: confessions confessions_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confessions_delete_admin ON public.confessions FOR DELETE USING (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) OR (auth.uid() = author_id)));


--
-- Name: confessions confessions_insert_legacy_rollout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confessions_insert_legacy_rollout ON public.confessions FOR INSERT WITH CHECK (((auth.uid() = author_id) AND (university_domain = ( SELECT p.university_domain
   FROM public.profiles p
  WHERE (p.id = auth.uid()))) AND (NOT public.is_user_banned(auth.uid())) AND (NOT public.is_user_restricted(auth.uid())) AND (NOT public.is_kursu_server_moderation_enabled(auth.uid()))));


--
-- Name: confessions confessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY confessions_select ON public.confessions FOR SELECT USING (((university_domain = ( SELECT p.university_domain
   FROM public.profiles p
  WHERE (p.id = auth.uid()))) AND (NOT public.is_user_restricted(auth.uid()))));


--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: courses courses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_insert ON public.courses FOR INSERT WITH CHECK (((auth.role() = 'authenticated'::text) AND (university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: courses courses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_select ON public.courses FOR SELECT USING ((university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: courses courses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_update ON public.courses FOR UPDATE USING (((auth.role() = 'authenticated'::text) AND (university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: device_tokens device_tokens_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_delete_own ON public.device_tokens FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_select_own ON public.device_tokens FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_update_own ON public.device_tokens FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_upsert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_upsert_own ON public.device_tokens FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: event_campaign_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_campaign_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: event_campaign_logs event_campaign_logs_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_campaign_logs_insert_authenticated ON public.event_campaign_logs FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND ((viewer_id IS NULL) OR (viewer_id = auth.uid())) AND ((event_id IS NOT NULL) OR (story_slot_id IS NOT NULL))));


--
-- Name: event_partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_partners ENABLE ROW LEVEL SECURITY;

--
-- Name: event_story_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_story_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: event_story_slots event_story_slots_select_same_city; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_story_slots_select_same_city ON public.event_story_slots FOR SELECT USING (((auth.uid() IS NOT NULL) AND (city_id = public.current_user_event_city_id()) AND (status = ANY (ARRAY['scheduled'::text, 'live'::text])) AND (starts_at <= now()) AND (ends_at >= now())));


--
-- Name: event_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: faculties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faculties ENABLE ROW LEVEL SECURITY;

--
-- Name: landing_page_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.landing_page_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: landing_page_sections landing_sections_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY landing_sections_insert_admin ON public.landing_page_sections FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));


--
-- Name: landing_page_sections landing_sections_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY landing_sections_select ON public.landing_page_sections FOR SELECT USING (true);


--
-- Name: landing_page_sections landing_sections_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY landing_sections_update_admin ON public.landing_page_sections FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));


--
-- Name: moderation_appeals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_scan_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_scan_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_word_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_word_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: note_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.note_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: note_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.note_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE USING ((auth.uid() = recipient_id));


--
-- Name: notifications notifications_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_insert_own ON public.notifications FOR INSERT WITH CHECK ((auth.uid() = recipient_id));


--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT USING ((auth.uid() = recipient_id));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE USING ((auth.uid() = recipient_id)) WITH CHECK ((auth.uid() = recipient_id));


--
-- Name: ops_queue_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_queue_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_queue_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_queue_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_queue_sla; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_queue_sla ENABLE ROW LEVEL SECURITY;

--
-- Name: session_participants participants_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_delete ON public.session_participants FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: session_participants participants_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_insert ON public.session_participants FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: session_participants participants_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_select ON public.session_participants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.study_sessions s
  WHERE ((s.id = session_participants.session_id) AND (s.university_domain = ( SELECT profiles.university_domain
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: session_participants participants_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_update ON public.session_participants FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: push_campaign_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_campaign_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: push_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: reports reports_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_insert_authenticated ON public.reports FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND (reporter_id = auth.uid()) AND (status = 'pending'::text)));


--
-- Name: reports reports_service_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_service_delete ON public.reports FOR DELETE USING ((auth.role() = 'service_role'::text));


--
-- Name: reports reports_service_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_service_select ON public.reports FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: reports reports_service_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_service_update ON public.reports FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: confession_likes restricted_users_cannot_insert_likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY restricted_users_cannot_insert_likes ON public.confession_likes FOR INSERT WITH CHECK ((NOT public.is_user_restricted(auth.uid())));


--
-- Name: study_sessions restricted_users_cannot_insert_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY restricted_users_cannot_insert_sessions ON public.study_sessions FOR INSERT WITH CHECK ((NOT public.is_user_restricted(auth.uid())));


--
-- Name: revenue_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_action_approvals service_role_admin_action_approvals_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_action_approvals_all ON public.admin_action_approvals USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_audit_logs service_role_admin_audit_logs_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_audit_logs_all ON public.admin_audit_logs USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_feature_flags service_role_admin_feature_flags_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_feature_flags_all ON public.admin_feature_flags USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_identities service_role_admin_identities_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_identities_all ON public.admin_identities USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_incident_events service_role_admin_incident_events_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_incident_events_all ON public.admin_incident_events USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_permissions service_role_admin_permissions_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_permissions_all ON public.admin_permissions USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_role_bindings service_role_admin_role_bindings_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_role_bindings_all ON public.admin_role_bindings USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_role_permissions service_role_admin_role_permissions_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_role_permissions_all ON public.admin_role_permissions USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: admin_roles service_role_admin_roles_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_admin_roles_all ON public.admin_roles USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: moderation_appeals service_role_full_access_appeals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_appeals ON public.moderation_appeals USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: user_consents service_role_full_access_consents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_consents ON public.user_consents USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: note_comments service_role_full_access_note_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_note_comments ON public.note_comments USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: note_votes service_role_full_access_note_votes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_note_votes ON public.note_votes USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: notes service_role_full_access_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_notes ON public.notes USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: user_sanctions service_role_full_access_user_sanctions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access_user_sanctions ON public.user_sanctions USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: moderation_scan_logs service_role_moderation_scan_logs_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_moderation_scan_logs_all ON public.moderation_scan_logs USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: moderation_word_rules service_role_moderation_word_rules_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_moderation_word_rules_all ON public.moderation_word_rules USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: ops_queue_assignments service_role_ops_queue_assignments_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ops_queue_assignments_all ON public.ops_queue_assignments USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: ops_queue_items service_role_ops_queue_items_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ops_queue_items_all ON public.ops_queue_items USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: ops_queue_sla service_role_ops_queue_sla_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ops_queue_sla_all ON public.ops_queue_sla USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: push_campaign_deliveries service_role_push_campaign_deliveries_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_push_campaign_deliveries_all ON public.push_campaign_deliveries USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: push_campaigns service_role_push_campaigns_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_push_campaigns_all ON public.push_campaigns USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: revenue_deals service_role_revenue_deals_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_revenue_deals_all ON public.revenue_deals USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: session_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: study_sessions sessions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_delete ON public.study_sessions FOR DELETE USING ((auth.uid() = creator_id));


--
-- Name: study_sessions sessions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_insert ON public.study_sessions FOR INSERT WITH CHECK (((auth.uid() = creator_id) AND (university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: study_sessions sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_select ON public.study_sessions FOR SELECT USING ((university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: study_sessions sessions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_update ON public.study_sessions FOR UPDATE USING ((auth.uid() = creator_id));


--
-- Name: study_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: app_telemetry_events telemetry_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telemetry_insert_authenticated ON public.app_telemetry_events FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND ((user_id IS NULL) OR (user_id = auth.uid()))));


--
-- Name: app_telemetry_events telemetry_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telemetry_service_all ON public.app_telemetry_events USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: universities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY;

--
-- Name: university_domain_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.university_domain_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: user_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: user_courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_courses ENABLE ROW LEVEL SECURITY;

--
-- Name: user_courses user_courses_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_courses_delete ON public.user_courses FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_courses user_courses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_courses_insert ON public.user_courses FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_courses user_courses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_courses_select ON public.user_courses FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.courses c
  WHERE ((c.id = user_courses.course_id) AND (c.university_domain = ( SELECT profiles.university_domain
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: user_courses user_courses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_courses_update ON public.user_courses FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: user_presence user_presence_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_presence_insert_own ON public.user_presence FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_presence user_presence_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_presence_select_own ON public.user_presence FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_presence user_presence_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_presence_update_own ON public.user_presence FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_sanctions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sanctions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings user_settings_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_settings_insert_own ON public.user_settings FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_settings user_settings_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_settings_select_own ON public.user_settings FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_settings user_settings_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_settings_update_own ON public.user_settings FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_sister_universities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sister_universities ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_appeals users_create_own_appeals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_create_own_appeals ON public.moderation_appeals FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: note_comments users_delete_own_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete_own_comments ON public.note_comments FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: notes users_delete_own_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete_own_notes ON public.notes FOR DELETE USING ((auth.uid() = author_id));


--
-- Name: note_comments users_insert_own_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_comments ON public.note_comments FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_consents users_insert_own_consents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_consents ON public.user_consents FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: notes users_insert_own_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_notes ON public.notes FOR INSERT WITH CHECK ((auth.uid() = author_id));


--
-- Name: note_votes users_manage_own_votes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_manage_own_votes ON public.note_votes USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: note_comments users_read_note_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_note_comments ON public.note_comments FOR SELECT USING (true);


--
-- Name: notes users_read_notes_same_university; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_notes_same_university ON public.notes FOR SELECT USING (((university_domain = ( SELECT profiles.university_domain
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) AND (is_hidden = false)));


--
-- Name: moderation_appeals users_read_own_appeals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_appeals ON public.moderation_appeals FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_consents users_read_own_consents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_consents ON public.user_consents FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_sanctions users_read_own_sanctions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_sanctions ON public.user_sanctions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notes İndirme sayısı güncellenebilir; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "İndirme sayısı güncellenebilir" ON public.notes FOR UPDATE USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict 4dPxp6zr6eewxCYBTQpkxqtBXlntB3bttMpzYcAimD9fOA58AVtwf2tKfGPVmdG

