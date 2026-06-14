-- 07 — Kürsü moderation word rules (data only; table + normalize fn in 02-schema).
-- Source: RN migration 20260326000000. Without these the moderation engine has no
-- rules and nothing gets blocked/reviewed. Idempotent (on conflict rule_key).

insert into public.moderation_word_rules (
  rule_key,
  scope,
  category,
  match_type,
  pattern,
  normalized_pattern,
  action,
  severity,
  notes
)
values
  ('shared.profanity.amk', 'shared', 'profanity', 'exact_token', 'amk', public.normalize_moderation_text('amk'), 'block', 'P1', 'Yaygin küfür'),
  ('shared.profanity.aq', 'shared', 'profanity', 'exact_token', 'aq', public.normalize_moderation_text('aq'), 'block', 'P1', 'Yaygin küfür kısaltması'),
  ('shared.profanity.orospu', 'shared', 'profanity', 'exact_token', 'orospu', public.normalize_moderation_text('orospu'), 'block', 'P1', 'Açık küfür'),
  ('shared.profanity.pic', 'shared', 'profanity', 'exact_token', 'piç', public.normalize_moderation_text('piç'), 'block', 'P1', 'Açık küfür'),
  ('shared.profanity.yarrak', 'shared', 'profanity', 'exact_token', 'yarrak', public.normalize_moderation_text('yarrak'), 'block', 'P1', 'Açık küfür'),
  ('shared.targeted_abuse.salak', 'shared', 'targeted_abuse', 'exact_token', 'salak', public.normalize_moderation_text('salak'), 'block', 'P2', 'Hedefli aşağılama'),
  ('shared.targeted_abuse.gerizekali', 'shared', 'targeted_abuse', 'contains', 'gerizekalı', public.normalize_moderation_text('gerizekalı'), 'block', 'P1', 'Hedefli aşağılama'),
  ('shared.sexual_harassment.taciz', 'shared', 'sexual_harassment', 'contains', 'taciz', public.normalize_moderation_text('taciz'), 'block', 'P1', 'Cinsel taciz ifadesi'),
  ('shared.hate_speech.nefret', 'shared', 'hate_speech', 'contains', 'nefret', public.normalize_moderation_text('nefret'), 'block', 'P1', 'Nefret söylemi sinyali'),
  ('shared.review.link', 'shared', 'spam_link', 'regex', '(https?://|www[[:space:]]|discord|telegram|whatsapp|instagram)', null, 'review', 'P2', 'Bağlantı veya dış kanal yönlendirmesi'),
  ('shared.review.phone', 'shared', 'phone', 'regex', '(^|[^0-9])[0-9]{10,}([^0-9]|$)', null, 'review', 'P2', 'Telefon numarası benzeri ifade'),
  ('shared.review.contact', 'shared', 'external_contact', 'contains', 'gmail', public.normalize_moderation_text('gmail'), 'review', 'P2', 'Harici iletişim bilgisi')
on conflict (rule_key) do nothing;
