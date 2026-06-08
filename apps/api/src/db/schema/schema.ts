// @ts-nocheck
import { pgTable, pgSchema, index, foreignKey, check, uuid, text, timestamp, jsonb, pgPolicy, boolean, varchar, bigserial, inet, bigint, uniqueIndex, smallint, json, unique, integer, doublePrecision, type AnyPgColumn, numeric, primaryKey, pgView, pgMaterializedView } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const auth = pgSchema("auth");
export const aalLevelInAuth = auth.enum("aal_level", ['aal1', 'aal2', 'aal3'])
export const codeChallengeMethodInAuth = auth.enum("code_challenge_method", ['s256', 'plain'])
export const factorStatusInAuth = auth.enum("factor_status", ['unverified', 'verified'])
export const factorTypeInAuth = auth.enum("factor_type", ['totp', 'webauthn', 'phone'])
export const oauthAuthorizationStatusInAuth = auth.enum("oauth_authorization_status", ['pending', 'approved', 'denied', 'expired'])
export const oauthClientTypeInAuth = auth.enum("oauth_client_type", ['public', 'confidential'])
export const oauthRegistrationTypeInAuth = auth.enum("oauth_registration_type", ['dynamic', 'manual'])
export const oauthResponseTypeInAuth = auth.enum("oauth_response_type", ['code'])
export const oneTimeTokenTypeInAuth = auth.enum("one_time_token_type", ['confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token'])


export const samlRelayStatesInAuth = auth.table("saml_relay_states", {
	id: uuid().notNull(),
	ssoProviderId: uuid("sso_provider_id").notNull(),
	requestId: text("request_id").notNull(),
	forEmail: text("for_email"),
	redirectTo: text("redirect_to"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	flowStateId: uuid("flow_state_id"),
}, (table) => [
	index("saml_relay_states_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("saml_relay_states_for_email_idx").using("btree", table.forEmail.asc().nullsLast().op("text_ops")),
	index("saml_relay_states_sso_provider_id_idx").using("btree", table.ssoProviderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.flowStateId],
			foreignColumns: [flowStateInAuth.id],
			name: "saml_relay_states_flow_state_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ssoProviderId],
			foreignColumns: [ssoProvidersInAuth.id],
			name: "saml_relay_states_sso_provider_id_fkey"
		}).onDelete("cascade"),
	check("request_id not empty", sql`char_length(request_id) > 0`),
]);

export const samlProvidersInAuth = auth.table("saml_providers", {
	id: uuid().notNull(),
	ssoProviderId: uuid("sso_provider_id").notNull(),
	entityId: text("entity_id").notNull(),
	metadataXml: text("metadata_xml").notNull(),
	metadataUrl: text("metadata_url"),
	attributeMapping: jsonb("attribute_mapping"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	nameIdFormat: text("name_id_format"),
}, (table) => [
	index("saml_providers_sso_provider_id_idx").using("btree", table.ssoProviderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ssoProviderId],
			foreignColumns: [ssoProvidersInAuth.id],
			name: "saml_providers_sso_provider_id_fkey"
		}).onDelete("cascade"),
	check("entity_id not empty", sql`char_length(entity_id) > 0`),
	check("metadata_url not empty", sql`(metadata_url = NULL::text) OR (char_length(metadata_url) > 0)`),
	check("metadata_xml not empty", sql`char_length(metadata_xml) > 0`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	recipientId: uuid("recipient_id").notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	data: jsonb(),
	isRead: boolean("is_read").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_recipient_created_at").using("btree", table.recipientId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_recipient_unread").using("btree", table.recipientId.asc().nullsLast().op("uuid_ops"), table.isRead.asc().nullsLast().op("uuid_ops")).where(sql`(is_read = false)`),
	foreignKey({
			columns: [table.recipientId],
			foreignColumns: [usersInAuth.id],
			name: "notifications_recipient_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("notifications_delete_own", { as: "permissive", for: "delete", to: ["public"], using: sql`(auth.uid() = recipient_id)` }),
	pgPolicy("notifications_insert_own", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("notifications_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("notifications_update_own", { as: "permissive", for: "update", to: ["public"] }),
]);

export const instancesInAuth = auth.table("instances", {
	id: uuid().notNull(),
	uuid: uuid(),
	rawBaseConfig: text("raw_base_config"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
});

export const schemaMigrationsInAuth = auth.table("schema_migrations", {
	version: varchar({ length: 255 }).notNull(),
});

export const refreshTokensInAuth = auth.table("refresh_tokens", {
	instanceId: uuid("instance_id"),
	id: bigserial({ mode: "bigint" }).notNull(),
	token: varchar({ length: 255 }),
	userId: varchar("user_id", { length: 255 }),
	revoked: boolean(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	parent: varchar({ length: 255 }),
	sessionId: uuid("session_id"),
}, (table) => [
	index("refresh_tokens_instance_id_idx").using("btree", table.instanceId.asc().nullsLast().op("uuid_ops")),
	index("refresh_tokens_instance_id_user_id_idx").using("btree", table.instanceId.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops")),
	index("refresh_tokens_parent_idx").using("btree", table.parent.asc().nullsLast().op("text_ops")),
	index("refresh_tokens_session_id_revoked_idx").using("btree", table.sessionId.asc().nullsLast().op("bool_ops"), table.revoked.asc().nullsLast().op("bool_ops")),
	index("refresh_tokens_updated_at_idx").using("btree", table.updatedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessionsInAuth.id],
			name: "refresh_tokens_session_id_fkey"
		}).onDelete("cascade"),
]);

export const sessionsInAuth = auth.table("sessions", {
	id: uuid().notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	factorId: uuid("factor_id"),
	aal: aalLevelInAuth(),
	notAfter: timestamp("not_after", { withTimezone: true, mode: 'string' }),
	refreshedAt: timestamp("refreshed_at", { mode: 'string' }),
	userAgent: text("user_agent"),
	ip: inet(),
	tag: text(),
	oauthClientId: uuid("oauth_client_id"),
	refreshTokenHmacKey: text("refresh_token_hmac_key"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	refreshTokenCounter: bigint("refresh_token_counter", { mode: "number" }),
	scopes: text(),
}, (table) => [
	index("sessions_not_after_idx").using("btree", table.notAfter.desc().nullsFirst().op("timestamptz_ops")),
	index("sessions_oauth_client_id_idx").using("btree", table.oauthClientId.asc().nullsLast().op("uuid_ops")),
	index("sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("user_id_created_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.oauthClientId],
			foreignColumns: [oauthClientsInAuth.id],
			name: "sessions_oauth_client_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "sessions_user_id_fkey"
		}).onDelete("cascade"),
	check("sessions_scopes_length", sql`char_length(scopes) <= 4096`),
]);

export const usersInAuth = auth.table("users", {
	instanceId: uuid("instance_id"),
	id: uuid().notNull(),
	aud: varchar({ length: 255 }),
	role: varchar({ length: 255 }),
	email: varchar({ length: 255 }),
	encryptedPassword: varchar("encrypted_password", { length: 255 }),
	emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true, mode: 'string' }),
	invitedAt: timestamp("invited_at", { withTimezone: true, mode: 'string' }),
	confirmationToken: varchar("confirmation_token", { length: 255 }),
	confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true, mode: 'string' }),
	recoveryToken: varchar("recovery_token", { length: 255 }),
	recoverySentAt: timestamp("recovery_sent_at", { withTimezone: true, mode: 'string' }),
	emailChangeTokenNew: varchar("email_change_token_new", { length: 255 }),
	emailChange: varchar("email_change", { length: 255 }),
	emailChangeSentAt: timestamp("email_change_sent_at", { withTimezone: true, mode: 'string' }),
	lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true, mode: 'string' }),
	rawAppMetaData: jsonb("raw_app_meta_data"),
	rawUserMetaData: jsonb("raw_user_meta_data"),
	isSuperAdmin: boolean("is_super_admin"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	phone: text().default(sql`NULL`),
	phoneConfirmedAt: timestamp("phone_confirmed_at", { withTimezone: true, mode: 'string' }),
	phoneChange: text("phone_change").default(''),
	phoneChangeToken: varchar("phone_change_token", { length: 255 }).default(''),
	phoneChangeSentAt: timestamp("phone_change_sent_at", { withTimezone: true, mode: 'string' }),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }).generatedAlwaysAs(sql`LEAST(email_confirmed_at, phone_confirmed_at)`),
	emailChangeTokenCurrent: varchar("email_change_token_current", { length: 255 }).default(''),
	emailChangeConfirmStatus: smallint("email_change_confirm_status").default(0),
	bannedUntil: timestamp("banned_until", { withTimezone: true, mode: 'string' }),
	reauthenticationToken: varchar("reauthentication_token", { length: 255 }).default(''),
	reauthenticationSentAt: timestamp("reauthentication_sent_at", { withTimezone: true, mode: 'string' }),
	isSsoUser: boolean("is_sso_user").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	isAnonymous: boolean("is_anonymous").default(false).notNull(),
}, (table) => [
	uniqueIndex("confirmation_token_idx").using("btree", table.confirmationToken.asc().nullsLast().op("text_ops")).where(sql`((confirmation_token)::text !~ '^[0-9 ]*$'::text)`),
	uniqueIndex("email_change_token_current_idx").using("btree", table.emailChangeTokenCurrent.asc().nullsLast().op("text_ops")).where(sql`((email_change_token_current)::text !~ '^[0-9 ]*$'::text)`),
	uniqueIndex("email_change_token_new_idx").using("btree", table.emailChangeTokenNew.asc().nullsLast().op("text_ops")).where(sql`((email_change_token_new)::text !~ '^[0-9 ]*$'::text)`),
	uniqueIndex("reauthentication_token_idx").using("btree", table.reauthenticationToken.asc().nullsLast().op("text_ops")).where(sql`((reauthentication_token)::text !~ '^[0-9 ]*$'::text)`),
	uniqueIndex("recovery_token_idx").using("btree", table.recoveryToken.asc().nullsLast().op("text_ops")).where(sql`((recovery_token)::text !~ '^[0-9 ]*$'::text)`),
	uniqueIndex("users_email_partial_key").using("btree", table.email.asc().nullsLast().op("text_ops")).where(sql`(is_sso_user = false)`),
	index("users_instance_id_email_idx").using("btree", sql`instance_id`, sql`lower((email)::text)`),
	index("users_instance_id_idx").using("btree", table.instanceId.asc().nullsLast().op("uuid_ops")),
	index("users_is_anonymous_idx").using("btree", table.isAnonymous.asc().nullsLast().op("bool_ops")),
	check("users_email_change_confirm_status_check", sql`(email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)`),
]);

export const auditLogEntriesInAuth = auth.table("audit_log_entries", {
	instanceId: uuid("instance_id"),
	id: uuid().notNull(),
	payload: json(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	ipAddress: varchar("ip_address", { length: 64 }).default('').notNull(),
}, (table) => [
	index("audit_logs_instance_id_idx").using("btree", table.instanceId.asc().nullsLast().op("uuid_ops")),
]);

export const ssoDomainsInAuth = auth.table("sso_domains", {
	id: uuid().notNull(),
	ssoProviderId: uuid("sso_provider_id").notNull(),
	domain: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("sso_domains_domain_idx").using("btree", sql`lower(domain)`),
	index("sso_domains_sso_provider_id_idx").using("btree", table.ssoProviderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ssoProviderId],
			foreignColumns: [ssoProvidersInAuth.id],
			name: "sso_domains_sso_provider_id_fkey"
		}).onDelete("cascade"),
	check("domain not empty", sql`char_length(domain) > 0`),
]);

export const mfaAmrClaimsInAuth = auth.table("mfa_amr_claims", {
	sessionId: uuid("session_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	authenticationMethod: text("authentication_method").notNull(),
	id: uuid().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [sessionsInAuth.id],
			name: "mfa_amr_claims_session_id_fkey"
		}).onDelete("cascade"),
]);

export const identitiesInAuth = auth.table("identities", {
	providerId: text("provider_id").notNull(),
	userId: uuid("user_id").notNull(),
	identityData: jsonb("identity_data").notNull(),
	provider: text().notNull(),
	lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	email: text().generatedAlwaysAs(sql`lower((identity_data ->> 'email'::text))`),
	id: uuid().defaultRandom().notNull(),
}, (table) => [
	index("identities_email_idx").using("btree", table.email.asc().nullsLast().op("text_pattern_ops")),
	index("identities_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "identities_user_id_fkey"
		}).onDelete("cascade"),
]);

export const oneTimeTokensInAuth = auth.table("one_time_tokens", {
	id: uuid().notNull(),
	userId: uuid("user_id").notNull(),
	tokenType: oneTimeTokenTypeInAuth("token_type").notNull(),
	tokenHash: text("token_hash").notNull(),
	relatesTo: text("relates_to").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("one_time_tokens_relates_to_hash_idx").using("hash", table.relatesTo.asc().nullsLast().op("text_ops")),
	index("one_time_tokens_token_hash_hash_idx").using("hash", table.tokenHash.asc().nullsLast().op("text_ops")),
	uniqueIndex("one_time_tokens_user_id_token_type_key").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.tokenType.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "one_time_tokens_user_id_fkey"
		}).onDelete("cascade"),
	check("one_time_tokens_token_hash_check", sql`char_length(token_hash) > 0`),
]);

export const ssoProvidersInAuth = auth.table("sso_providers", {
	id: uuid().notNull(),
	resourceId: text("resource_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	disabled: boolean(),
}, (table) => [
	uniqueIndex("sso_providers_resource_id_idx").using("btree", sql`lower(resource_id)`),
	index("sso_providers_resource_id_pattern_idx").using("btree", table.resourceId.asc().nullsLast().op("text_pattern_ops")),
	check("resource_id not empty", sql`(resource_id = NULL::text) OR (char_length(resource_id) > 0)`),
]);

export const mfaChallengesInAuth = auth.table("mfa_challenges", {
	id: uuid().notNull(),
	factorId: uuid("factor_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	ipAddress: inet("ip_address").notNull(),
	otpCode: text("otp_code"),
	webAuthnSessionData: jsonb("web_authn_session_data"),
}, (table) => [
	index("mfa_challenge_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.factorId],
			foreignColumns: [mfaFactorsInAuth.id],
			name: "mfa_challenges_auth_factor_id_fkey"
		}).onDelete("cascade"),
]);

export const mfaFactorsInAuth = auth.table("mfa_factors", {
	id: uuid().notNull(),
	userId: uuid("user_id").notNull(),
	friendlyName: text("friendly_name"),
	factorType: factorTypeInAuth("factor_type").notNull(),
	status: factorStatusInAuth().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	secret: text(),
	phone: text(),
	lastChallengedAt: timestamp("last_challenged_at", { withTimezone: true, mode: 'string' }),
	webAuthnCredential: jsonb("web_authn_credential"),
	webAuthnAaguid: uuid("web_authn_aaguid"),
	lastWebauthnChallengeData: jsonb("last_webauthn_challenge_data"),
}, (table) => [
	index("factor_id_created_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("mfa_factors_user_friendly_name_unique").using("btree", table.friendlyName.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(TRIM(BOTH FROM friendly_name) <> ''::text)`),
	index("mfa_factors_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("unique_phone_factor_per_user").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "mfa_factors_user_id_fkey"
		}).onDelete("cascade"),
]);

export const flowStateInAuth = auth.table("flow_state", {
	id: uuid().notNull(),
	userId: uuid("user_id"),
	authCode: text("auth_code"),
	codeChallengeMethod: codeChallengeMethodInAuth("code_challenge_method"),
	codeChallenge: text("code_challenge"),
	providerType: text("provider_type").notNull(),
	providerAccessToken: text("provider_access_token"),
	providerRefreshToken: text("provider_refresh_token"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
	authenticationMethod: text("authentication_method").notNull(),
	authCodeIssuedAt: timestamp("auth_code_issued_at", { withTimezone: true, mode: 'string' }),
	inviteToken: text("invite_token"),
	referrer: text(),
	oauthClientStateId: uuid("oauth_client_state_id"),
	linkingTargetId: uuid("linking_target_id"),
	emailOptional: boolean("email_optional").default(false).notNull(),
}, (table) => [
	index("flow_state_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_auth_code").using("btree", table.authCode.asc().nullsLast().op("text_ops")),
	index("idx_user_id_auth_method").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.authenticationMethod.asc().nullsLast().op("uuid_ops")),
]);

export const oauthConsentsInAuth = auth.table("oauth_consents", {
	id: uuid().notNull(),
	userId: uuid("user_id").notNull(),
	clientId: uuid("client_id").notNull(),
	scopes: text().notNull(),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("oauth_consents_active_client_idx").using("btree", table.clientId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	index("oauth_consents_active_user_client_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.clientId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	index("oauth_consents_user_order_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.grantedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [oauthClientsInAuth.id],
			name: "oauth_consents_client_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "oauth_consents_user_id_fkey"
		}).onDelete("cascade"),
	check("oauth_consents_revoked_after_granted", sql`(revoked_at IS NULL) OR (revoked_at >= granted_at)`),
	check("oauth_consents_scopes_length", sql`char_length(scopes) <= 2048`),
	check("oauth_consents_scopes_not_empty", sql`char_length(TRIM(BOTH FROM scopes)) > 0`),
]);

export const oauthAuthorizationsInAuth = auth.table("oauth_authorizations", {
	id: uuid().notNull(),
	authorizationId: text("authorization_id").notNull(),
	clientId: uuid("client_id").notNull(),
	userId: uuid("user_id"),
	redirectUri: text("redirect_uri").notNull(),
	scope: text().notNull(),
	state: text(),
	resource: text(),
	codeChallenge: text("code_challenge"),
	codeChallengeMethod: codeChallengeMethodInAuth("code_challenge_method"),
	responseType: oauthResponseTypeInAuth("response_type").default('code').notNull(),
	status: oauthAuthorizationStatusInAuth().default('pending').notNull(),
	authorizationCode: text("authorization_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '00:03:00'::interval)`).notNull(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	nonce: text(),
}, (table) => [
	index("oauth_auth_pending_exp_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'pending'::auth.oauth_authorization_status)`),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [oauthClientsInAuth.id],
			name: "oauth_authorizations_client_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "oauth_authorizations_user_id_fkey"
		}).onDelete("cascade"),
	check("oauth_authorizations_authorization_code_length", sql`char_length(authorization_code) <= 255`),
	check("oauth_authorizations_code_challenge_length", sql`char_length(code_challenge) <= 128`),
	check("oauth_authorizations_expires_at_future", sql`expires_at > created_at`),
	check("oauth_authorizations_nonce_length", sql`char_length(nonce) <= 255`),
	check("oauth_authorizations_redirect_uri_length", sql`char_length(redirect_uri) <= 2048`),
	check("oauth_authorizations_resource_length", sql`char_length(resource) <= 2048`),
	check("oauth_authorizations_scope_length", sql`char_length(scope) <= 4096`),
	check("oauth_authorizations_state_length", sql`char_length(state) <= 4096`),
]);

export const oauthClientStatesInAuth = auth.table("oauth_client_states", {
	id: uuid().notNull(),
	providerType: text("provider_type").notNull(),
	codeVerifier: text("code_verifier"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_oauth_client_states_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const oauthClientsInAuth = auth.table("oauth_clients", {
	id: uuid().notNull(),
	clientSecretHash: text("client_secret_hash"),
	registrationType: oauthRegistrationTypeInAuth("registration_type").notNull(),
	redirectUris: text("redirect_uris").notNull(),
	grantTypes: text("grant_types").notNull(),
	clientName: text("client_name"),
	clientUri: text("client_uri"),
	logoUri: text("logo_uri"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	clientType: oauthClientTypeInAuth("client_type").default('confidential').notNull(),
	tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
}, (table) => [
	index("oauth_clients_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	check("oauth_clients_client_name_length", sql`char_length(client_name) <= 1024`),
	check("oauth_clients_client_uri_length", sql`char_length(client_uri) <= 2048`),
	check("oauth_clients_logo_uri_length", sql`char_length(logo_uri) <= 2048`),
	check("oauth_clients_token_endpoint_auth_method_check", sql`token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])`),
]);

export const cities = pgTable("cities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("cities_name_key").on(table.name),
	pgPolicy("Cities are readable by everyone", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const universities = pgTable("universities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	domain: text().notNull(),
	cityId: uuid("city_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "universities_city_id_fkey"
		}).onDelete("restrict"),
	unique("universities_domain_key").on(table.domain),
	pgPolicy("Universities are readable by everyone", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const universityDomainAliases = pgTable("university_domain_aliases", {
	aliasDomain: text("alias_domain").primaryKey().notNull(),
	universityId: uuid("university_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.universityId],
			foreignColumns: [universities.id],
			name: "university_domain_aliases_university_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("University domain aliases are readable by everyone", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const confessionReports = pgTable("confession_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	confessionId: uuid("confession_id").notNull(),
	reporterId: uuid("reporter_id").notNull(),
	reason: text().default('Diğer').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_confession_reports_confession").using("btree", table.confessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.confessionId],
			foreignColumns: [confessions.id],
			name: "confession_reports_confession_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [usersInAuth.id],
			name: "confession_reports_reporter_id_fkey"
		}).onDelete("cascade"),
	unique("confession_reports_confession_id_reporter_id_key").on(table.confessionId, table.reporterId),
	pgPolicy("confession_reports_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(auth.uid() = reporter_id)`  }),
	pgPolicy("confession_reports_select_admin", { as: "permissive", for: "select", to: ["public"] }),
]);

export const faculties = pgTable("faculties", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("faculties_name_key").on(table.name),
	pgPolicy("Faculties are public", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const departments = pgTable("departments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	facultyId: uuid("faculty_id").notNull(),
	durationYears: integer("duration_years").default(4).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.facultyId],
			foreignColumns: [faculties.id],
			name: "departments_faculty_id_fkey"
		}).onDelete("cascade"),
	unique("departments_faculty_id_name_key").on(table.name, table.facultyId),
	pgPolicy("Departments are public", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	check("departments_duration_years_check", sql`(duration_years >= 2) AND (duration_years <= 7)`),
]);

export const notes = pgTable("notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	authorId: uuid("author_id").notNull(),
	courseId: uuid("course_id").notNull(),
	universityDomain: text("university_domain").notNull(),
	title: text().notNull(),
	description: text(),
	fileUrl: text("file_url").notNull(),
	fileType: text("file_type").default('pdf').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
	downloadCount: integer("download_count").default(0),
	likeCount: integer("like_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isFlagged: boolean("is_flagged").default(false),
	voteScore: integer("vote_score").default(0),
	commentCount: integer("comment_count").default(0),
	uploaderId: uuid("uploader_id"),
	reportCount: integer("report_count").default(0).notNull(),
	isHidden: boolean("is_hidden").default(false).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notes_author").using("btree", table.authorId.asc().nullsLast().op("uuid_ops")),
	index("idx_notes_author_id").using("btree", table.authorId.asc().nullsLast().op("uuid_ops")),
	index("idx_notes_course").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")),
	index("idx_notes_course_id").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")),
	index("idx_notes_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notes_domain").using("btree", table.universityDomain.asc().nullsLast().op("text_ops")),
	index("idx_notes_flagged").using("btree", table.isFlagged.asc().nullsLast().op("bool_ops")).where(sql`(is_flagged = true)`),
	index("idx_notes_title_trgm").using("gin", table.title.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_notes_university").using("btree", table.universityDomain.asc().nullsLast().op("text_ops")),
	index("idx_notes_uploader_id").using("btree", table.uploaderId.asc().nullsLast().op("uuid_ops")).where(sql`(uploader_id IS NOT NULL)`),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [usersInAuth.id],
			name: "notes_author_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [courses.id],
			name: "notes_course_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaderId],
			foreignColumns: [usersInAuth.id],
			name: "notes_uploader_id_fkey"
		}).onDelete("set null"),
	pgPolicy("Aynı üniversite notları görebilir", { as: "permissive", for: "select", to: ["public"], using: sql`(university_domain = ( SELECT profiles.university_domain
   FROM profiles
  WHERE (profiles.id = auth.uid())))` }),
	pgPolicy("Kendi notunu ekleyebilir", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Kendi notunu silebilir", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("service_role_full_access_notes", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("users_delete_own_notes", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("users_insert_own_notes", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("users_read_notes_same_university", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("İndirme sayısı güncellenebilir", { as: "permissive", for: "update", to: ["public"] }),
	check("notes_description_check", sql`char_length(description) <= 300`),
	check("notes_file_type_check", sql`file_type = ANY (ARRAY['pdf'::text, 'image'::text])`),
	check("notes_title_check", sql`(char_length(title) >= 2) AND (char_length(title) <= 120)`),
]);

export const courses = pgTable("courses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	universityDomain: text("university_domain").notNull(),
	faculty: text(),
	credits: integer(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_courses_code_trgm").using("gin", table.code.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_courses_name_trgm").using("gin", table.name.asc().nullsLast().op("gin_trgm_ops")),
	unique("courses_code_university_domain_key").on(table.code, table.universityDomain),
	pgPolicy("courses_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`((auth.role() = 'authenticated'::text) AND (university_domain = ( SELECT profiles.university_domain
   FROM profiles
  WHERE (profiles.id = auth.uid()))))`  }),
	pgPolicy("courses_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("courses_update", { as: "permissive", for: "update", to: ["public"] }),
]);

export const userCourses = pgTable("user_courses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	courseId: uuid("course_id").notNull(),
	semester: text().notNull(),
	instructor: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_courses_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [courses.id],
			name: "user_courses_course_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_courses_user_id_fkey"
		}).onDelete("cascade"),
	unique("user_courses_user_id_course_id_semester_key").on(table.userId, table.courseId, table.semester),
	pgPolicy("user_courses_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("user_courses_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("user_courses_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("user_courses_update", { as: "permissive", for: "update", to: ["public"] }),
]);

export const studySessions = pgTable("study_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	creatorId: uuid("creator_id").notNull(),
	courseId: uuid("course_id"),
	title: text(),
	description: text(),
	locationName: text("location_name").notNull(),
	locationLat: doublePrecision("location_lat"),
	locationLng: doublePrecision("location_lng"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	maxParticipants: integer("max_participants").default(5).notNull(),
	participantCount: integer("participant_count").default(0).notNull(),
	isPublic: boolean("is_public").default(true).notNull(),
	status: text().default('active').notNull(),
	reportCount: integer("report_count").default(0).notNull(),
	isFlagged: boolean("is_flagged").default(false).notNull(),
	universityDomain: text("university_domain").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sessions_course").using("btree", table.courseId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	index("idx_sessions_university_status").using("btree", table.universityDomain.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops"), table.startsAt.desc().nullsFirst().op("text_ops")),
	index("idx_study_sessions_title_trgm").using("gin", table.title.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.courseId],
			foreignColumns: [courses.id],
			name: "study_sessions_course_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.creatorId],
			foreignColumns: [usersInAuth.id],
			name: "study_sessions_creator_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("restricted_users_cannot_insert_sessions", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(NOT is_user_restricted(auth.uid()))`  }),
	pgPolicy("sessions_delete", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("sessions_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("sessions_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("sessions_update", { as: "permissive", for: "update", to: ["public"] }),
	check("study_sessions_max_participants_check", sql`(max_participants >= 2) AND (max_participants <= 20)`),
	check("study_sessions_status_check", sql`status = ANY (ARRAY['active'::text, 'full'::text, 'ended'::text, 'cancelled'::text])`),
]);

export const sessionParticipants = pgTable("session_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	userId: uuid("user_id").notNull(),
	status: text().default('joined').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_participants_session").using("btree", table.sessionId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [studySessions.id],
			name: "session_participants_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "session_participants_user_id_fkey"
		}).onDelete("cascade"),
	unique("session_participants_session_id_user_id_key").on(table.sessionId, table.userId),
	pgPolicy("participants_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("participants_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("participants_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("participants_update", { as: "permissive", for: "update", to: ["public"] }),
	check("session_participants_status_check", sql`status = ANY (ARRAY['pending'::text, 'joined'::text, 'left'::text])`),
]);

export const eventPartners = pgTable("event_partners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	partnerKind: text("partner_kind").default('organizer').notNull(),
	contactName: text("contact_name"),
	contactEmail: text("contact_email"),
	contactPhone: text("contact_phone"),
	websiteUrl: text("website_url"),
	instagramUrl: text("instagram_url"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("event_partners_partner_kind_check", sql`partner_kind = ANY (ARRAY['organizer'::text, 'brand'::text, 'venue'::text, 'community'::text, 'other'::text])`),
]);

export const eventSubmissions = pgTable("event_submissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerName: text("partner_name").notNull(),
	contactName: text("contact_name").notNull(),
	contactEmail: text("contact_email").notNull(),
	contactPhone: text("contact_phone"),
	cityId: uuid("city_id").notNull(),
	title: text().notNull(),
	description: text(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	venueName: text("venue_name").notNull(),
	venueAddress: text("venue_address"),
	ticketUrl: text("ticket_url"),
	priceLabel: text("price_label"),
	coverUrl: text("cover_url"),
	organizerInstagram: text("organizer_instagram"),
	organizerUrl: text("organizer_url"),
	packageRequested: text("package_requested").default('Temel Listeleme').notNull(),
	submissionNotes: text("submission_notes"),
	status: text().default('pending').notNull(),
	reviewNotes: text("review_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	approvedEventId: uuid("approved_event_id"),
}, (table) => [
	foreignKey({
			columns: [table.approvedEventId],
			foreignColumns: [cityEvents.id],
			name: "event_submissions_approved_event_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "event_submissions_city_id_fkey"
		}).onDelete("restrict"),
	check("event_submissions_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
]);

export const cityEvents = pgTable("city_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	sourceSubmissionId: uuid("source_submission_id"),
	cityId: uuid("city_id").notNull(),
	title: text().notNull(),
	description: text(),
	coverUrl: text("cover_url"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	venueName: text("venue_name").notNull(),
	venueAddress: text("venue_address"),
	category: text().notNull(),
	ticketUrl: text("ticket_url"),
	priceLabel: text("price_label").default('Detayda').notNull(),
	organizerName: text("organizer_name").notNull(),
	organizerInstagram: text("organizer_instagram"),
	organizerUrl: text("organizer_url"),
	isSponsored: boolean("is_sponsored").default(false).notNull(),
	sponsorshipTier: text("sponsorship_tier").default('organic').notNull(),
	status: text().default('draft').notNull(),
	adminNotes: text("admin_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("city_events_source_submission_id_uniq").using("btree", table.sourceSubmissionId.asc().nullsLast().op("uuid_ops")).where(sql`(source_submission_id IS NOT NULL)`),
	index("idx_city_events_city_status_starts").using("btree", table.cityId.asc().nullsLast().op("timestamptz_ops"), table.status.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_city_events_sponsored").using("btree", table.cityId.asc().nullsLast().op("bool_ops"), table.isSponsored.asc().nullsLast().op("bool_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "city_events_city_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [eventPartners.id],
			name: "city_events_partner_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sourceSubmissionId],
			foreignColumns: [eventSubmissions.id],
			name: "city_events_source_submission_id_fkey"
		}).onDelete("set null"),
	pgPolicy("city_events_select_same_city", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.uid() IS NOT NULL) AND (city_id = current_user_event_city_id()) AND (status = ANY (ARRAY['approved'::text, 'scheduled'::text, 'live'::text])) AND (COALESCE(ends_at, starts_at) >= now()))` }),
	check("city_events_category_check", sql`category = ANY (ARRAY['concert'::text, 'festival'::text, 'standup'::text, 'theatre'::text, 'party'::text, 'workshop'::text, 'community'::text, 'other'::text])`),
	check("city_events_sponsorship_tier_check", sql`sponsorship_tier = ANY (ARRAY['organic'::text, 'featured'::text, 'story'::text, 'vitrin'::text])`),
	check("city_events_status_check", sql`status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'scheduled'::text, 'live'::text, 'ended'::text, 'archived'::text, 'rejected'::text])`),
]);

export const eventStorySlots = pgTable("event_story_slots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	cityId: uuid("city_id").notNull(),
	slotIndex: integer("slot_index").notNull(),
	titleOverride: text("title_override"),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	status: text().default('scheduled').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_story_slots_city_time").using("btree", table.cityId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops"), table.endsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "event_story_slots_city_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [cityEvents.id],
			name: "event_story_slots_event_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("event_story_slots_select_same_city", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.uid() IS NOT NULL) AND (city_id = current_user_event_city_id()) AND (status = ANY (ARRAY['scheduled'::text, 'live'::text])) AND (starts_at <= now()) AND (ends_at >= now()))` }),
	check("event_story_slots_slot_index_check", sql`(slot_index >= 1) AND (slot_index <= 8)`),
	check("event_story_slots_status_check", sql`status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'archived'::text])`),
]);

export const eventCampaignLogs = pgTable("event_campaign_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id"),
	storySlotId: uuid("story_slot_id"),
	viewerId: uuid("viewer_id"),
	viewerUniversityDomain: text("viewer_university_domain"),
	viewerCityId: uuid("viewer_city_id"),
	eventType: text("event_type").notNull(),
	source: text().default('mobile').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_event_campaign_logs_event_type_created").using("btree", table.eventId.asc().nullsLast().op("text_ops"), table.eventType.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("idx_event_campaign_logs_story_created").using("btree", table.storySlotId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [cityEvents.id],
			name: "event_campaign_logs_event_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.storySlotId],
			foreignColumns: [eventStorySlots.id],
			name: "event_campaign_logs_story_slot_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.viewerCityId],
			foreignColumns: [cities.id],
			name: "event_campaign_logs_viewer_city_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.viewerId],
			foreignColumns: [usersInAuth.id],
			name: "event_campaign_logs_viewer_id_fkey"
		}).onDelete("set null"),
	pgPolicy("event_campaign_logs_insert_authenticated", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`((auth.uid() IS NOT NULL) AND ((viewer_id IS NULL) OR (viewer_id = auth.uid())) AND ((event_id IS NOT NULL) OR (story_slot_id IS NOT NULL)))`  }),
	check("event_campaign_logs_event_type_check", sql`event_type = ANY (ARRAY['story_impression'::text, 'story_tap'::text, 'detail_open'::text, 'cta_click'::text, 'map_open'::text])`),
	check("event_campaign_logs_source_check", sql`source = ANY (ARRAY['mobile'::text, 'admin'::text, 'landing'::text])`),
]);

export const confessions = pgTable("confessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	authorId: uuid("author_id").notNull(),
	body: text().notNull(),
	category: text().default('confession').notNull(),
	likeCount: integer("like_count").default(0).notNull(),
	commentCount: integer("comment_count").default(0).notNull(),
	reportCount: integer("report_count").default(0).notNull(),
	isFlagged: boolean("is_flagged").default(false).notNull(),
	universityDomain: text("university_domain").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	imageUrl: text("image_url"),
	isAnonymous: boolean("is_anonymous").default(true).notNull(),
	hiddenAt: timestamp("hidden_at", { withTimezone: true, mode: 'string' }),
	hiddenByAdminId: uuid("hidden_by_admin_id"),
	hiddenReason: text("hidden_reason"),
	restoredAt: timestamp("restored_at", { withTimezone: true, mode: 'string' }),
	moderationStatus: text("moderation_status").default('published').notNull(),
	moderationSource: text("moderation_source"),
	moderationLabel: text("moderation_label"),
	lastModeratedAt: timestamp("last_moderated_at", { withTimezone: true, mode: 'string' }),
	normalizedBody: text("normalized_body"),
}, (table) => [
	index("idx_confessions_author_created").using("btree", table.authorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_confessions_author_normalized_created").using("btree", table.authorId.asc().nullsLast().op("text_ops"), table.normalizedBody.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(normalized_body IS NOT NULL)`),
	index("idx_confessions_body_trgm").using("gin", table.body.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_confessions_category").using("btree", table.universityDomain.asc().nullsLast().op("timestamptz_ops"), table.category.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_confessions_hidden_at").using("btree", table.hiddenAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_confessions_published_feed_v2").using("btree", table.universityDomain.asc().nullsLast().op("uuid_ops"), table.category.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")).where(sql`((hidden_at IS NULL) AND (moderation_status = 'published'::text))`),
	index("idx_confessions_trending").using("btree", table.universityDomain.asc().nullsLast().op("text_ops"), table.likeCount.desc().nullsFirst().op("int4_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_confessions_trending_v2").using("btree", table.universityDomain.asc().nullsLast().op("int4_ops"), table.likeCount.desc().nullsFirst().op("text_ops"), table.commentCount.desc().nullsFirst().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`((hidden_at IS NULL) AND (moderation_status = 'published'::text))`),
	index("idx_confessions_university_created").using("btree", table.universityDomain.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [usersInAuth.id],
			name: "confessions_author_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.hiddenByAdminId],
			foreignColumns: [adminIdentities.id],
			name: "confessions_hidden_by_admin_id_fkey"
		}).onDelete("set null"),
	pgPolicy("confessions_delete_admin", { as: "permissive", for: "delete", to: ["public"], using: sql`((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) OR (auth.uid() = author_id))` }),
	pgPolicy("confessions_insert_legacy_rollout", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("confessions_select", { as: "permissive", for: "select", to: ["public"] }),
	check("confessions_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 500)`),
	check("confessions_category_check", sql`category = ANY (ARRAY['confession'::text, 'question'::text, 'complaint'::text, 'funny'::text])`),
	check("confessions_moderation_status_check", sql`moderation_status = ANY (ARRAY['published'::text, 'needs_review'::text, 'hidden'::text])`),
]);

export const confessionLikes = pgTable("confession_likes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	confessionId: uuid("confession_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_confession_likes_confession").using("btree", table.confessionId.asc().nullsLast().op("uuid_ops")),
	index("idx_confession_likes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.confessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.confessionId],
			foreignColumns: [confessions.id],
			name: "confession_likes_confession_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "confession_likes_user_id_fkey"
		}).onDelete("cascade"),
	unique("confession_likes_confession_id_user_id_key").on(table.confessionId, table.userId),
	pgPolicy("banned_users_cannot_insert_likes", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(NOT is_user_banned(auth.uid()))`  }),
	pgPolicy("confession_likes_delete", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("confession_likes_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("confession_likes_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("restricted_users_cannot_insert_likes", { as: "permissive", for: "insert", to: ["public"] }),
]);

export const confessionBookmarks = pgTable("confession_bookmarks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	confessionId: uuid("confession_id").notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_confession_bookmarks_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.confessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.confessionId],
			foreignColumns: [confessions.id],
			name: "confession_bookmarks_confession_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "confession_bookmarks_user_id_fkey"
		}).onDelete("cascade"),
	unique("confession_bookmarks_confession_id_user_id_key").on(table.confessionId, table.userId),
	pgPolicy("confession_bookmarks_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("confession_bookmarks_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("confession_bookmarks_select", { as: "permissive", for: "select", to: ["public"] }),
]);

export const noteVotes = pgTable("note_votes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	noteId: uuid("note_id").notNull(),
	userId: uuid("user_id").notNull(),
	direction: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_note_votes_note").using("btree", table.noteId.asc().nullsLast().op("uuid_ops")),
	index("idx_note_votes_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.noteId],
			foreignColumns: [notes.id],
			name: "note_votes_note_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "note_votes_user_id_fkey"
		}).onDelete("cascade"),
	unique("note_votes_note_id_user_id_key").on(table.noteId, table.userId),
	pgPolicy("Herkes oy verebilir", { as: "permissive", for: "all", to: ["public"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("service_role_full_access_note_votes", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("users_manage_own_votes", { as: "permissive", for: "all", to: ["public"] }),
	check("note_votes_direction_check", sql`direction = ANY (ARRAY['up'::text, 'down'::text])`),
]);

export const noteComments = pgTable("note_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	noteId: uuid("note_id").notNull(),
	userId: uuid("user_id").notNull(),
	body: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_note_comments_note").using("btree", table.noteId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.noteId],
			foreignColumns: [notes.id],
			name: "note_comments_note_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "note_comments_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Kendi yorumunu silebilir", { as: "permissive", for: "delete", to: ["public"], using: sql`(user_id = auth.uid())` }),
	pgPolicy("Yorum ekleyebilir", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Yorumları okuyabilir", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("service_role_full_access_note_comments", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("users_delete_own_comments", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("users_insert_own_comments", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("users_read_note_comments", { as: "permissive", for: "select", to: ["public"] }),
	check("note_comments_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 500)`),
]);

export const customOauthProvidersInAuth = auth.table("custom_oauth_providers", {
	id: uuid().defaultRandom().notNull(),
	providerType: text("provider_type").notNull(),
	identifier: text().notNull(),
	name: text().notNull(),
	clientId: text("client_id").notNull(),
	clientSecret: text("client_secret").notNull(),
	acceptableClientIds: text("acceptable_client_ids").array().default([""]).notNull(),
	scopes: text().array().default([""]).notNull(),
	pkceEnabled: boolean("pkce_enabled").default(true).notNull(),
	attributeMapping: jsonb("attribute_mapping").default({}).notNull(),
	authorizationParams: jsonb("authorization_params").default({}).notNull(),
	enabled: boolean().default(true).notNull(),
	emailOptional: boolean("email_optional").default(false).notNull(),
	issuer: text(),
	discoveryUrl: text("discovery_url"),
	skipNonceCheck: boolean("skip_nonce_check").default(false).notNull(),
	cachedDiscovery: jsonb("cached_discovery"),
	discoveryCachedAt: timestamp("discovery_cached_at", { withTimezone: true, mode: 'string' }),
	authorizationUrl: text("authorization_url"),
	tokenUrl: text("token_url"),
	userinfoUrl: text("userinfo_url"),
	jwksUri: text("jwks_uri"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("custom_oauth_providers_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("custom_oauth_providers_enabled_idx").using("btree", table.enabled.asc().nullsLast().op("bool_ops")),
	index("custom_oauth_providers_identifier_idx").using("btree", table.identifier.asc().nullsLast().op("text_ops")),
	index("custom_oauth_providers_provider_type_idx").using("btree", table.providerType.asc().nullsLast().op("text_ops")),
	check("custom_oauth_providers_authorization_url_https", sql`(authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text)`),
	check("custom_oauth_providers_authorization_url_length", sql`(authorization_url IS NULL) OR (char_length(authorization_url) <= 2048)`),
	check("custom_oauth_providers_client_id_length", sql`(char_length(client_id) >= 1) AND (char_length(client_id) <= 512)`),
	check("custom_oauth_providers_discovery_url_length", sql`(discovery_url IS NULL) OR (char_length(discovery_url) <= 2048)`),
	check("custom_oauth_providers_identifier_format", sql`identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text`),
	check("custom_oauth_providers_issuer_length", sql`(issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048))`),
	check("custom_oauth_providers_jwks_uri_https", sql`(jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text)`),
	check("custom_oauth_providers_jwks_uri_length", sql`(jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048)`),
	check("custom_oauth_providers_name_length", sql`(char_length(name) >= 1) AND (char_length(name) <= 100)`),
	check("custom_oauth_providers_oauth2_requires_endpoints", sql`(provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL))`),
	check("custom_oauth_providers_oidc_discovery_url_https", sql`(provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text)`),
	check("custom_oauth_providers_oidc_issuer_https", sql`(provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text)`),
	check("custom_oauth_providers_oidc_requires_issuer", sql`(provider_type <> 'oidc'::text) OR (issuer IS NOT NULL)`),
	check("custom_oauth_providers_provider_type_check", sql`provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text])`),
	check("custom_oauth_providers_token_url_https", sql`(token_url IS NULL) OR (token_url ~~ 'https://%'::text)`),
	check("custom_oauth_providers_token_url_length", sql`(token_url IS NULL) OR (char_length(token_url) <= 2048)`),
	check("custom_oauth_providers_userinfo_url_https", sql`(userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text)`),
	check("custom_oauth_providers_userinfo_url_length", sql`(userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)`),
]);

export const deviceTokens = pgTable("device_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	expoPushToken: text("expo_push_token").notNull(),
	platform: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_device_tokens_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "device_tokens_user_id_fkey"
		}).onDelete("cascade"),
	unique("device_tokens_user_id_expo_push_token_key").on(table.userId, table.expoPushToken),
	pgPolicy("device_tokens_delete_own", { as: "permissive", for: "delete", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("device_tokens_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("device_tokens_update_own", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("device_tokens_upsert_own", { as: "permissive", for: "insert", to: ["public"] }),
]);

export const landingPageSections = pgTable("landing_page_sections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sectionKey: text("section_key").notNull(),
	title: text(),
	subtitle: text(),
	body: jsonb().default({}).notNull(),
	displayOrder: integer("display_order").default(0).notNull(),
	isVisible: boolean("is_visible").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [usersInAuth.id],
			name: "landing_page_sections_updated_by_fkey"
		}).onDelete("set null"),
	unique("landing_page_sections_section_key_key").on(table.sectionKey),
	pgPolicy("landing_sections_insert_admin", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))))`  }),
	pgPolicy("landing_sections_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("landing_sections_update_admin", { as: "permissive", for: "update", to: ["public"] }),
]);

export const userSettings = pgTable("user_settings", {
	userId: uuid("user_id").primaryKey().notNull(),
	themePreference: text("theme_preference").default('system').notNull(),
	notifySessionInvites: boolean("notify_session_invites").default(true).notNull(),
	notifySessionReminders: boolean("notify_session_reminders").default(true).notNull(),
	notifyNewSessions: boolean("notify_new_sessions").default(true).notNull(),
	profileVisibilityEnabled: boolean("profile_visibility_enabled").default(true).notNull(),
	showOnlineStatus: boolean("show_online_status").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_settings_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("user_settings_insert_own", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(auth.uid() = user_id)`  }),
	pgPolicy("user_settings_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("user_settings_update_own", { as: "permissive", for: "update", to: ["public"] }),
	check("user_settings_theme_preference_check", sql`theme_preference = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])`),
]);

export const userPresence = pgTable("user_presence", {
	userId: uuid("user_id").primaryKey().notNull(),
	isOnline: boolean("is_online").default(false).notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_presence_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("user_presence_insert_own", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(auth.uid() = user_id)`  }),
	pgPolicy("user_presence_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("user_presence_update_own", { as: "permissive", for: "update", to: ["public"] }),
]);

export const webauthnCredentialsInAuth = auth.table("webauthn_credentials", {
	id: uuid().defaultRandom().notNull(),
	userId: uuid("user_id").notNull(),
	// TODO: failed to parse database type 'bytea'
	credentialId: text("credential_id").notNull(),
	// TODO: failed to parse database type 'bytea'
	publicKey: text("public_key").notNull(),
	attestationType: text("attestation_type").default('').notNull(),
	aaguid: uuid(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	signCount: bigint("sign_count", { mode: "number" }).default(0).notNull(),
	transports: jsonb().default([]).notNull(),
	backupEligible: boolean("backup_eligible").default(false).notNull(),
	backedUp: boolean("backed_up").default(false).notNull(),
	friendlyName: text("friendly_name").default('').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("webauthn_credentials_credential_id_key").using("btree", table.credentialId.asc().nullsLast().op("bytea_ops")),
	index("webauthn_credentials_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "webauthn_credentials_user_id_fkey"
		}).onDelete("cascade"),
]);

export const webauthnChallengesInAuth = auth.table("webauthn_challenges", {
	id: uuid().defaultRandom().notNull(),
	userId: uuid("user_id"),
	challengeType: text("challenge_type").notNull(),
	sessionData: jsonb("session_data").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("webauthn_challenges_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("webauthn_challenges_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "webauthn_challenges_user_id_fkey"
		}).onDelete("cascade"),
	check("webauthn_challenges_challenge_type_check", sql`challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])`),
]);

export const communityRequests = pgTable("community_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	requesterId: uuid("requester_id"),
	contactName: text("contact_name").notNull(),
	contactEmail: text("contact_email").notNull(),
	contactPhone: text("contact_phone"),
	universityDomain: text("university_domain").notNull(),
	communityName: text("community_name").notNull(),
	category: text().notNull(),
	description: text(),
	socialInstagram: text("social_instagram"),
	status: text().default('pending').notNull(),
	adminNotes: text("admin_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.requesterId],
			foreignColumns: [usersInAuth.id],
			name: "community_requests_requester_id_fkey"
		}).onDelete("set null"),
	check("community_requests_category_check", sql`category = ANY (ARRAY['academic'::text, 'sports'::text, 'arts'::text, 'tech'::text, 'social'::text, 'general'::text])`),
	check("community_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
]);

export const adminRoles = pgTable("admin_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roleKey: text("role_key").notNull(),
	roleName: text("role_name").notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("admin_roles_role_key_key").on(table.roleKey),
	pgPolicy("service_role_admin_roles_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
]);

export const revenueDeals = pgTable("revenue_deals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	partnerId: uuid("partner_id").notNull(),
	cityId: uuid("city_id"),
	dealName: text("deal_name").notNull(),
	packageTier: text("package_tier").default('organic').notNull(),
	stage: text().default('lead').notNull(),
	budgetAmount: numeric("budget_amount", { precision: 12, scale:  2 }),
	expectedStartAt: timestamp("expected_start_at", { withTimezone: true, mode: 'string' }),
	expectedEndAt: timestamp("expected_end_at", { withTimezone: true, mode: 'string' }),
	ownerIdentityId: uuid("owner_identity_id"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_revenue_deals_partner").using("btree", table.partnerId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_revenue_deals_stage_created").using("btree", table.stage.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "revenue_deals_city_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ownerIdentityId],
			foreignColumns: [adminIdentities.id],
			name: "revenue_deals_owner_identity_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.partnerId],
			foreignColumns: [eventPartners.id],
			name: "revenue_deals_partner_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("service_role_revenue_deals_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("revenue_deals_package_tier_check", sql`package_tier = ANY (ARRAY['organic'::text, 'featured'::text, 'story'::text, 'vitrin'::text, 'custom'::text])`),
	check("revenue_deals_stage_check", sql`stage = ANY (ARRAY['lead'::text, 'qualified'::text, 'proposal_sent'::text, 'negotiation'::text, 'won'::text, 'lost'::text])`),
]);

export const adminIdentities = pgTable("admin_identities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	displayName: text("display_name"),
	passwordHash: text("password_hash").notNull(),
	status: text().default('active').notNull(),
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("admin_identities_email_key").on(table.email),
	pgPolicy("service_role_admin_identities_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("admin_identities_status_check", sql`status = ANY (ARRAY['active'::text, 'suspended'::text])`),
]);

export const adminPermissions = pgTable("admin_permissions", {
	permissionKey: text("permission_key").primaryKey().notNull(),
	description: text().notNull(),
	approvalMode: text("approval_mode").default('SINGLE_APPROVAL').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("service_role_admin_permissions_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("admin_permissions_approval_mode_check", sql`approval_mode = 'SINGLE_APPROVAL'::text`),
]);

export const adminRoleBindings = pgTable("admin_role_bindings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	identityId: uuid("identity_id").notNull(),
	roleId: uuid("role_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.identityId],
			foreignColumns: [adminIdentities.id],
			name: "admin_role_bindings_identity_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [adminRoles.id],
			name: "admin_role_bindings_role_id_fkey"
		}).onDelete("cascade"),
	unique("admin_role_bindings_identity_id_role_id_key").on(table.identityId, table.roleId),
	pgPolicy("service_role_admin_role_bindings_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
]);

export const reports = pgTable("reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	targetType: text("target_type").notNull(),
	targetId: uuid("target_id").notNull(),
	reporterId: uuid("reporter_id").notNull(),
	reason: text().default('Diger').notNull(),
	description: text(),
	status: text().default('pending').notNull(),
	source: text().default('app').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_reports_reporter").using("btree", table.reporterId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_reports_status_created").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("idx_reports_target").using("btree", table.targetType.asc().nullsLast().op("timestamptz_ops"), table.targetId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [usersInAuth.id],
			name: "reports_reporter_id_fkey"
		}).onDelete("cascade"),
	unique("reports_target_type_target_id_reporter_id_key").on(table.targetType, table.targetId, table.reporterId),
	pgPolicy("reports_insert_authenticated", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`((auth.uid() IS NOT NULL) AND (reporter_id = auth.uid()) AND (status = 'pending'::text))`  }),
	pgPolicy("reports_service_delete", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("reports_service_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("reports_service_update", { as: "permissive", for: "update", to: ["public"] }),
	check("reports_status_check", sql`status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text])`),
	check("reports_target_type_allowed", sql`target_type = ANY (ARRAY['confession'::text, 'comment'::text, 'user'::text, 'note'::text])`),
]);

export const confessionComments = pgTable("confession_comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	confessionId: uuid("confession_id").notNull(),
	authorId: uuid("author_id").notNull(),
	body: text().notNull(),
	reportCount: integer("report_count").default(0).notNull(),
	isFlagged: boolean("is_flagged").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isAnonymous: boolean("is_anonymous").default(true).notNull(),
	replyTo: uuid("reply_to"),
	hiddenAt: timestamp("hidden_at", { withTimezone: true, mode: 'string' }),
	hiddenByAdminId: uuid("hidden_by_admin_id"),
	hiddenReason: text("hidden_reason"),
	restoredAt: timestamp("restored_at", { withTimezone: true, mode: 'string' }),
	moderationStatus: text("moderation_status").default('published').notNull(),
	moderationSource: text("moderation_source"),
	moderationLabel: text("moderation_label"),
	lastModeratedAt: timestamp("last_moderated_at", { withTimezone: true, mode: 'string' }),
	normalizedBody: text("normalized_body"),
}, (table) => [
	index("idx_confession_comments_author_created").using("btree", table.authorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_confession_comments_author_normalized_created").using("btree", table.authorId.asc().nullsLast().op("uuid_ops"), table.normalizedBody.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")).where(sql`(normalized_body IS NOT NULL)`),
	index("idx_confession_comments_confession").using("btree", table.confessionId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("idx_confession_comments_hidden_at").using("btree", table.hiddenAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_confession_comments_published_v2").using("btree", table.confessionId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("uuid_ops")).where(sql`((hidden_at IS NULL) AND (moderation_status = 'published'::text))`),
	index("idx_confession_comments_reply").using("btree", table.replyTo.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [usersInAuth.id],
			name: "confession_comments_author_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.confessionId],
			foreignColumns: [confessions.id],
			name: "confession_comments_confession_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.hiddenByAdminId],
			foreignColumns: [adminIdentities.id],
			name: "confession_comments_hidden_by_admin_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.replyTo],
			foreignColumns: [table.id],
			name: "confession_comments_reply_to_fkey"
		}).onDelete("set null"),
	pgPolicy("confession_comments_delete_admin", { as: "permissive", for: "delete", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))))` }),
	pgPolicy("confession_comments_insert_legacy_rollout", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("confession_comments_select", { as: "permissive", for: "select", to: ["public"] }),
	check("confession_comments_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 300)`),
	check("confession_comments_moderation_status_check", sql`moderation_status = ANY (ARRAY['published'::text, 'needs_review'::text, 'hidden'::text])`),
]);

export const moderationWordRules = pgTable("moderation_word_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ruleKey: text("rule_key").notNull(),
	scope: text().notNull(),
	category: text().notNull(),
	matchType: text("match_type").notNull(),
	pattern: text().notNull(),
	normalizedPattern: text("normalized_pattern"),
	action: text().notNull(),
	severity: text().default('P2').notNull(),
	enabled: boolean().default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
}, (table) => [
	index("idx_moderation_word_rules_scope_enabled").using("btree", table.scope.asc().nullsLast().op("text_ops"), table.enabled.asc().nullsLast().op("text_ops"), table.action.asc().nullsLast().op("text_ops"), table.severity.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [adminIdentities.id],
			name: "moderation_word_rules_updated_by_fkey"
		}).onDelete("set null"),
	unique("moderation_word_rules_rule_key_key").on(table.ruleKey),
	pgPolicy("service_role_moderation_word_rules_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("moderation_word_rules_action_check", sql`action = ANY (ARRAY['block'::text, 'review'::text])`),
	check("moderation_word_rules_category_check", sql`category = ANY (ARRAY['profanity'::text, 'hate_speech'::text, 'sexual_harassment'::text, 'targeted_abuse'::text, 'spam_link'::text, 'phone'::text, 'external_contact'::text, 'mass_repeat'::text])`),
	check("moderation_word_rules_match_type_check", sql`match_type = ANY (ARRAY['exact_token'::text, 'contains'::text, 'regex'::text])`),
	check("moderation_word_rules_scope_check", sql`scope = ANY (ARRAY['shared'::text, 'kursu_post'::text, 'kursu_comment'::text])`),
	check("moderation_word_rules_severity_check", sql`severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text])`),
]);

export const moderationScanLogs = pgTable("moderation_scan_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contentScope: text("content_scope").notNull(),
	contentId: uuid("content_id"),
	actorUserId: uuid("actor_user_id"),
	decision: text().notNull(),
	moderationLabel: text("moderation_label"),
	matchedRuleIds: uuid("matched_rule_ids").array().default([""]).notNull(),
	matchedTerms: text("matched_terms").array().default([""]).notNull(),
	previewMasked: text("preview_masked"),
	source: text().default('unknown').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_moderation_scan_actor_decision_created").using("btree", table.actorUserId.asc().nullsLast().op("text_ops"), table.decision.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_moderation_scan_content_created").using("btree", table.contentScope.asc().nullsLast().op("timestamptz_ops"), table.contentId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [usersInAuth.id],
			name: "moderation_scan_logs_actor_user_id_fkey"
		}).onDelete("set null"),
	pgPolicy("service_role_moderation_scan_logs_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("moderation_scan_logs_content_scope_check", sql`content_scope = ANY (ARRAY['kursu_post'::text, 'kursu_comment'::text])`),
	check("moderation_scan_logs_decision_check", sql`decision = ANY (ARRAY['allow'::text, 'review'::text, 'block'::text])`),
]);

export const pushCampaigns = pgTable("push_campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	payload: jsonb().default({}).notNull(),
	targetUniversityDomains: text("target_university_domains").array().default([""]).notNull(),
	targetPlatform: text("target_platform").default('all').notNull(),
	status: text().default('draft').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dryRunTotal: bigint("dry_run_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dryRunIos: bigint("dry_run_ios", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dryRunAndroid: bigint("dry_run_android", { mode: "number" }).default(0).notNull(),
	createdBy: uuid("created_by"),
	approvedBy: uuid("approved_by"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_push_campaigns_status_created").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [adminIdentities.id],
			name: "push_campaigns_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [adminIdentities.id],
			name: "push_campaigns_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("service_role_push_campaigns_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("push_campaigns_status_check", sql`status = ANY (ARRAY['draft'::text, 'dry_run'::text, 'pending_approval'::text, 'sending'::text, 'sent'::text, 'failed'::text])`),
	check("push_campaigns_target_platform_check", sql`target_platform = ANY (ARRAY['all'::text, 'ios'::text, 'android'::text])`),
]);

export const pushCampaignDeliveries = pgTable("push_campaign_deliveries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	batchIndex: integer("batch_index").notNull(),
	targetCount: integer("target_count").default(0).notNull(),
	successCount: integer("success_count").default(0).notNull(),
	failureCount: integer("failure_count").default(0).notNull(),
	responseJson: jsonb("response_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_push_campaign_deliveries_campaign").using("btree", table.campaignId.asc().nullsLast().op("int4_ops"), table.batchIndex.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [pushCampaigns.id],
			name: "push_campaign_deliveries_campaign_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("service_role_push_campaign_deliveries_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	email: text().notNull(),
	universityDomain: text("university_domain").notNull(),
	universityName: text("university_name"),
	faculty: text(),
	department: text(),
	yearOfStudy: integer("year_of_study"),
	fullName: text("full_name"),
	username: text(),
	avatarUrl: text("avatar_url"),
	bio: text(),
	studyStyle: text("study_style"),
	preferredLocation: text("preferred_location"),
	activeHours: jsonb("active_hours"),
	followerCount: integer("follower_count").default(0),
	xpPoints: integer("xp_points").default(0),
	isAnonymousDefault: boolean("is_anonymous_default").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	lastActive: timestamp("last_active", { withTimezone: true, mode: 'string' }).defaultNow(),
	isAdmin: boolean("is_admin").default(false).notNull(),
	isBanned: boolean("is_banned").default(false).notNull(),
	kvkkConsentAt: timestamp("kvkk_consent_at", { withTimezone: true, mode: 'string' }),
	privacyConsentAt: timestamp("privacy_consent_at", { withTimezone: true, mode: 'string' }),
	facultyId: uuid("faculty_id"),
	departmentId: uuid("department_id"),
	isRestricted: boolean("is_restricted").default(false).notNull(),
	restrictionEndsAt: timestamp("restriction_ends_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_profiles_banned").using("btree", table.isBanned.asc().nullsLast().op("bool_ops")).where(sql`(is_banned = true)`),
	index("idx_profiles_department_id").using("btree", table.departmentId.asc().nullsLast().op("uuid_ops")).where(sql`(department_id IS NOT NULL)`),
	index("idx_profiles_email_trgm").using("gin", table.email.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_profiles_faculty_id").using("btree", table.facultyId.asc().nullsLast().op("uuid_ops")).where(sql`(faculty_id IS NOT NULL)`),
	index("idx_profiles_full_name_trgm").using("gin", table.fullName.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_profiles_restricted").using("btree", table.isRestricted.asc().nullsLast().op("bool_ops")).where(sql`(is_restricted = true)`),
	index("idx_profiles_username_trgm").using("gin", table.username.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "profiles_department_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.facultyId],
			foreignColumns: [faculties.id],
			name: "profiles_faculty_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.id],
			foreignColumns: [usersInAuth.id],
			name: "profiles_id_fkey"
		}).onDelete("cascade"),
	unique("profiles_email_key").on(table.email),
	unique("profiles_username_key").on(table.username),
	pgPolicy("profiles_select_own", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = id)` }),
	pgPolicy("profiles_update_own", { as: "permissive", for: "update", to: ["public"] }),
	check("profiles_study_style_check", sql`(study_style IS NULL) OR (study_style = ANY (ARRAY['silent'::text, 'discussion'::text, 'music'::text]))`),
	check("profiles_year_of_study_check", sql`(year_of_study IS NULL) OR ((year_of_study >= 1) AND (year_of_study <= 6))`),
]);

export const communityMembers = pgTable("community_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	communityId: uuid("community_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: text().default('member').notNull(),
	status: text().default('pending').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_community_members_community_status").using("btree", table.communityId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("idx_community_members_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.communityId],
			foreignColumns: [communities.id],
			name: "community_members_community_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "community_members_user_id_fkey"
		}).onDelete("cascade"),
	unique("community_members_community_id_user_id_key").on(table.communityId, table.userId),
	pgPolicy("community_members_delete_self_or_staff", { as: "permissive", for: "delete", to: ["public"], using: sql`((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM community_members me
  WHERE ((me.community_id = community_members.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))` }),
	pgPolicy("community_members_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("community_members_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("community_members_update_staff", { as: "permissive", for: "update", to: ["public"] }),
	check("community_members_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])`),
	check("community_members_status_check", sql`status = ANY (ARRAY['active'::text, 'pending'::text])`),
]);

export const communityPosts = pgTable("community_posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	communityId: uuid("community_id").notNull(),
	authorId: uuid("author_id").notNull(),
	body: text().notNull(),
	imageUrl: text("image_url"),
	isPinned: boolean("is_pinned").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_community_posts_feed").using("btree", table.communityId.asc().nullsLast().op("timestamptz_ops"), table.isPinned.desc().nullsFirst().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [usersInAuth.id],
			name: "community_posts_author_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.communityId],
			foreignColumns: [communities.id],
			name: "community_posts_community_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("community_posts_delete_author_or_staff", { as: "permissive", for: "delete", to: ["public"], using: sql`((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM community_members me
  WHERE ((me.community_id = community_posts.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))` }),
	pgPolicy("community_posts_insert_active_member", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("community_posts_select_active_member", { as: "permissive", for: "select", to: ["public"] }),
	check("community_posts_body_check", sql`(char_length(body) >= 1) AND (char_length(body) <= 2000)`),
]);

export const communityEvents = pgTable("community_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	communityId: uuid("community_id").notNull(),
	authorId: uuid("author_id").notNull(),
	title: text().notNull(),
	description: text(),
	location: text(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_community_events_feed").using("btree", table.communityId.asc().nullsLast().op("timestamptz_ops"), table.startsAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [usersInAuth.id],
			name: "community_events_author_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.communityId],
			foreignColumns: [communities.id],
			name: "community_events_community_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("community_events_delete_author_or_staff", { as: "permissive", for: "delete", to: ["public"], using: sql`((author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM community_members me
  WHERE ((me.community_id = community_events.community_id) AND (me.user_id = auth.uid()) AND (me.status = 'active'::text) AND (me.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))` }),
	pgPolicy("community_events_insert_active_member", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("community_events_select_active_member", { as: "permissive", for: "select", to: ["public"] }),
	check("community_events_check", sql`(ends_at IS NULL) OR (ends_at >= starts_at)`),
	check("community_events_title_check", sql`(char_length(title) >= 2) AND (char_length(title) <= 120)`),
]);

export const userSanctions = pgTable("user_sanctions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	sanctionType: text("sanction_type").notNull(),
	reason: text().default('Topluluk kurallarina aykiri davranis').notNull(),
	violationCount: integer("violation_count").default(1).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_sanctions_active").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")).where(sql`(is_active = true)`),
	index("idx_user_sanctions_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_sanctions_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("service_role_full_access_user_sanctions", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	pgPolicy("users_read_own_sanctions", { as: "permissive", for: "select", to: ["public"] }),
	check("user_sanctions_sanction_type_check", sql`sanction_type = ANY (ARRAY['warning'::text, 'temp_ban'::text, 'permanent_ban'::text])`),
]);

export const communities = pgTable("communities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: uuid("owner_id").notNull(),
	universityDomain: text("university_domain").notNull(),
	name: text().notNull(),
	description: text(),
	avatarUrl: text("avatar_url"),
	category: text().default('general').notNull(),
	joinType: text("join_type").default('open').notNull(),
	memberCount: integer("member_count").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isVerified: boolean("is_verified").default(false).notNull(),
	coverUrl: text("cover_url"),
}, (table) => [
	uniqueIndex("communities_university_domain_lower_name_uniq").using("btree", sql`university_domain`, sql`lower(name)`),
	index("idx_communities_domain_active").using("btree", table.universityDomain.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops"), table.createdAt.desc().nullsFirst().op("bool_ops")),
	index("idx_communities_name_trgm").using("gin", table.name.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [usersInAuth.id],
			name: "communities_owner_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("communities_delete_owner", { as: "permissive", for: "delete", to: ["public"], using: sql`(owner_id = auth.uid())` }),
	pgPolicy("communities_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("communities_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("communities_update_owner", { as: "permissive", for: "update", to: ["public"] }),
	check("communities_category_check", sql`category = ANY (ARRAY['academic'::text, 'sports'::text, 'arts'::text, 'tech'::text, 'social'::text, 'general'::text])`),
	check("communities_join_type_check", sql`join_type = ANY (ARRAY['open'::text, 'approval'::text, 'invite'::text])`),
	check("communities_member_count_check", sql`member_count >= 0`),
	check("communities_name_check", sql`(char_length(name) >= 2) AND (char_length(name) <= 80)`),
]);

export const userConsents = pgTable("user_consents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	consentType: text("consent_type").notNull(),
	version: text().default('1.0').notNull(),
	granted: boolean().default(true).notNull(),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
}, (table) => [
	index("idx_user_consents_user").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.consentType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_consents_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("service_role_full_access_consents", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	pgPolicy("users_insert_own_consents", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("users_read_own_consents", { as: "permissive", for: "select", to: ["public"] }),
	check("user_consents_consent_type_check", sql`consent_type = ANY (ARRAY['kvkk'::text, 'privacy_policy'::text, 'terms_of_service'::text, 'notifications'::text, 'telemetry'::text])`),
]);

export const adminActionApprovals = pgTable("admin_action_approvals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	requestId: uuid("request_id").defaultRandom().notNull(),
	actionKey: text("action_key").notNull(),
	permissionKey: text("permission_key").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	requestedBy: uuid("requested_by").notNull(),
	approvedBy: uuid("approved_by"),
	status: text().default('pending').notNull(),
	reason: text().notNull(),
	payload: jsonb().default({}).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_admin_action_approvals_status_created").using("btree", table.status.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [adminIdentities.id],
			name: "admin_action_approvals_approved_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.permissionKey],
			foreignColumns: [adminPermissions.permissionKey],
			name: "admin_action_approvals_permission_key_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.requestedBy],
			foreignColumns: [adminIdentities.id],
			name: "admin_action_approvals_requested_by_fkey"
		}).onDelete("restrict"),
	pgPolicy("service_role_admin_action_approvals_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("admin_action_approvals_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])`),
]);

export const moderationAppeals = pgTable("moderation_appeals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	appealType: text("appeal_type").notNull(),
	relatedEntityType: text("related_entity_type"),
	relatedEntityId: uuid("related_entity_id"),
	sanctionId: uuid("sanction_id"),
	reason: text().notNull(),
	status: text().default('pending').notNull(),
	adminResponse: text("admin_response"),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_appeals_status").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	index("idx_appeals_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [adminIdentities.id],
			name: "moderation_appeals_reviewed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.sanctionId],
			foreignColumns: [userSanctions.id],
			name: "moderation_appeals_sanction_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "moderation_appeals_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("service_role_full_access_appeals", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	pgPolicy("users_create_own_appeals", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("users_read_own_appeals", { as: "permissive", for: "select", to: ["public"] }),
	check("moderation_appeals_appeal_type_check", sql`appeal_type = ANY (ARRAY['sanction'::text, 'content_removal'::text, 'account_ban'::text])`),
	check("moderation_appeals_reason_check", sql`(char_length(reason) >= 10) AND (char_length(reason) <= 2000)`),
	check("moderation_appeals_status_check", sql`status = ANY (ARRAY['pending'::text, 'under_review'::text, 'accepted'::text, 'rejected'::text])`),
]);

export const opsQueueItems = pgTable("ops_queue_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	queueDomain: text("queue_domain").notNull(),
	sourceTable: text("source_table").notNull(),
	sourceId: uuid("source_id").notNull(),
	state: text().default('open').notNull(),
	severity: text().default('P2').notNull(),
	title: text().notNull(),
	ownerId: uuid("owner_id"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ops_queue_items_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_ops_queue_items_domain_state_due").using("btree", table.queueDomain.asc().nullsLast().op("text_ops"), table.state.asc().nullsLast().op("timestamptz_ops"), table.dueAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_ops_queue_items_owner_state").using("btree", table.ownerId.asc().nullsLast().op("uuid_ops"), table.state.asc().nullsLast().op("uuid_ops"), table.updatedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [adminIdentities.id],
			name: "ops_queue_items_owner_id_fkey"
		}).onDelete("set null"),
	unique("ops_queue_items_source_table_source_id_key").on(table.sourceTable, table.sourceId),
	pgPolicy("service_role_ops_queue_items_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("ops_queue_items_queue_domain_check", sql`queue_domain = ANY (ARRAY['moderation'::text, 'event_submissions'::text, 'story_placements'::text, 'support_tickets'::text, 'fraud_review'::text])`),
	check("ops_queue_items_severity_check", sql`severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text])`),
	check("ops_queue_items_state_check", sql`state = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'dismissed'::text])`),
]);

export const opsQueueAssignments = pgTable("ops_queue_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	queueItemId: uuid("queue_item_id").notNull(),
	adminId: uuid("admin_id").notNull(),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	unassignedAt: timestamp("unassigned_at", { withTimezone: true, mode: 'string' }),
	note: text(),
}, (table) => [
	index("idx_ops_queue_assignments_admin").using("btree", table.adminId.asc().nullsLast().op("uuid_ops"), table.assignedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_ops_queue_assignments_queue").using("btree", table.queueItemId.asc().nullsLast().op("uuid_ops"), table.assignedAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [adminIdentities.id],
			name: "ops_queue_assignments_admin_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.queueItemId],
			foreignColumns: [opsQueueItems.id],
			name: "ops_queue_assignments_queue_item_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("service_role_ops_queue_assignments_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
]);

export const opsQueueSla = pgTable("ops_queue_sla", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	queueDomain: text("queue_domain").notNull(),
	severity: text().notNull(),
	targetMinutes: integer("target_minutes").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("ops_queue_sla_queue_domain_severity_key").on(table.queueDomain, table.severity),
	pgPolicy("service_role_ops_queue_sla_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("ops_queue_sla_queue_domain_check", sql`queue_domain = ANY (ARRAY['moderation'::text, 'event_submissions'::text, 'story_placements'::text, 'support_tickets'::text, 'fraud_review'::text])`),
	check("ops_queue_sla_severity_check", sql`severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text])`),
	check("ops_queue_sla_target_minutes_check", sql`target_minutes > 0`),
]);

export const adminFeatureFlags = pgTable("admin_feature_flags", {
	flagKey: text("flag_key").primaryKey().notNull(),
	description: text().notNull(),
	enabled: boolean().default(false).notNull(),
	rolloutPercent: integer("rollout_percent").default(100).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [adminIdentities.id],
			name: "admin_feature_flags_updated_by_fkey"
		}).onDelete("set null"),
	pgPolicy("service_role_admin_feature_flags_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("admin_feature_flags_rollout_percent_check", sql`(rollout_percent >= 0) AND (rollout_percent <= 100)`),
]);

export const adminIncidentEvents = pgTable("admin_incident_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	severity: text().notNull(),
	title: text().notNull(),
	status: text().default('open').notNull(),
	notes: text(),
	createdBy: uuid("created_by"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_admin_incidents_status_started").using("btree", table.status.asc().nullsLast().op("text_ops"), table.startedAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [adminIdentities.id],
			name: "admin_incident_events_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("service_role_admin_incident_events_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
	check("admin_incident_events_severity_check", sql`severity = ANY (ARRAY['P0'::text, 'P1'::text, 'P2'::text, 'P3'::text])`),
	check("admin_incident_events_status_check", sql`status = ANY (ARRAY['open'::text, 'monitoring'::text, 'resolved'::text])`),
]);

export const userSisterUniversities = pgTable("user_sister_universities", {
	userId: uuid("user_id").notNull(),
	universityDomain: text("university_domain").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "user_sister_universities_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.universityDomain], name: "user_sister_universities_pkey"}),
	pgPolicy("Users can manage own sister universities", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.uid() = user_id)`, withCheck: sql`(auth.uid() = user_id)`  }),
	pgPolicy("Users can read other users sister universities for matching", { as: "permissive", for: "select", to: ["public"] }),
]);

export const adminRolePermissions = pgTable("admin_role_permissions", {
	roleId: uuid("role_id").notNull(),
	permissionKey: text("permission_key").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.permissionKey],
			foreignColumns: [adminPermissions.permissionKey],
			name: "admin_role_permissions_permission_key_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [adminRoles.id],
			name: "admin_role_permissions_role_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.roleId, table.permissionKey], name: "admin_role_permissions_pkey"}),
	pgPolicy("service_role_admin_role_permissions_all", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)`, withCheck: sql`(auth.role() = 'service_role'::text)`  }),
]);

export const appTelemetryEventsDefault = pgTable("app_telemetry_events_default", {
	id: uuid().defaultRandom().notNull(),
	userId: uuid("user_id"),
	eventType: text("event_type").notNull(),
	platform: text(),
	appVersion: text("app_version"),
	route: text(),
	endpoint: text(),
	statusCode: integer("status_code"),
	responseMs: integer("response_ms"),
	errorCode: text("error_code"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_telemetry_events_default_endpoint_created_at_idx").using("btree", table.endpoint.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("app_telemetry_events_default_event_type_created_at_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("app_telemetry_events_default_user_id_event_type_created_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.eventType.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "app_telemetry_events_user_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "app_telemetry_events_default_pkey"}),
	check("app_telemetry_events_event_type_check", sql`event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])`),
]);

export const appTelemetryEvents202603 = pgTable("app_telemetry_events_202603", {
	id: uuid().defaultRandom().notNull(),
	userId: uuid("user_id"),
	eventType: text("event_type").notNull(),
	platform: text(),
	appVersion: text("app_version"),
	route: text(),
	endpoint: text(),
	statusCode: integer("status_code"),
	responseMs: integer("response_ms"),
	errorCode: text("error_code"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_telemetry_events_202603_endpoint_created_at_idx").using("btree", table.endpoint.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("app_telemetry_events_202603_event_type_created_at_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("app_telemetry_events_202603_user_id_event_type_created_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.eventType.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "app_telemetry_events_user_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "app_telemetry_events_202603_pkey"}),
	check("app_telemetry_events_event_type_check", sql`event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])`),
]);

export const appTelemetryEvents202604 = pgTable("app_telemetry_events_202604", {
	id: uuid().defaultRandom().notNull(),
	userId: uuid("user_id"),
	eventType: text("event_type").notNull(),
	platform: text(),
	appVersion: text("app_version"),
	route: text(),
	endpoint: text(),
	statusCode: integer("status_code"),
	responseMs: integer("response_ms"),
	errorCode: text("error_code"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_telemetry_events_202604_endpoint_created_at_idx").using("btree", table.endpoint.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("app_telemetry_events_202604_event_type_created_at_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("app_telemetry_events_202604_user_id_event_type_created_at_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.eventType.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [usersInAuth.id],
			name: "app_telemetry_events_user_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "app_telemetry_events_202604_pkey"}),
	check("app_telemetry_events_event_type_check", sql`event_type = ANY (ARRAY['app_open'::text, 'heartbeat'::text, 'screen_view'::text, 'api_error'::text, 'api_success'::text])`),
]);

export const adminAuditLogsDefault = pgTable("admin_audit_logs_default", {
	id: uuid().defaultRandom().notNull(),
	actorId: uuid("actor_id"),
	actorEmail: text("actor_email"),
	permissionKey: text("permission_key").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	action: text().notNull(),
	beforeJson: jsonb("before_json"),
	afterJson: jsonb("after_json"),
	reason: text(),
	ipHash: text("ip_hash"),
	userAgentHash: text("user_agent_hash"),
	requestId: uuid("request_id").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admin_audit_logs_default_actor_id_created_at_idx").using("btree", table.actorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("admin_audit_logs_default_entity_type_entity_id_created_at_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("admin_audit_logs_default_permission_key_created_at_idx").using("btree", table.permissionKey.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("admin_audit_logs_default_request_id_idx").using("btree", table.requestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [adminIdentities.id],
			name: "admin_audit_logs_actor_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "admin_audit_logs_default_pkey"}),
]);

export const adminAuditLogs202603 = pgTable("admin_audit_logs_202603", {
	id: uuid().defaultRandom().notNull(),
	actorId: uuid("actor_id"),
	actorEmail: text("actor_email"),
	permissionKey: text("permission_key").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	action: text().notNull(),
	beforeJson: jsonb("before_json"),
	afterJson: jsonb("after_json"),
	reason: text(),
	ipHash: text("ip_hash"),
	userAgentHash: text("user_agent_hash"),
	requestId: uuid("request_id").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admin_audit_logs_202603_actor_id_created_at_idx").using("btree", table.actorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("admin_audit_logs_202603_entity_type_entity_id_created_at_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("admin_audit_logs_202603_permission_key_created_at_idx").using("btree", table.permissionKey.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("admin_audit_logs_202603_request_id_idx").using("btree", table.requestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [adminIdentities.id],
			name: "admin_audit_logs_actor_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "admin_audit_logs_202603_pkey"}),
]);

export const adminAuditLogs202604 = pgTable("admin_audit_logs_202604", {
	id: uuid().defaultRandom().notNull(),
	actorId: uuid("actor_id"),
	actorEmail: text("actor_email"),
	permissionKey: text("permission_key").notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	action: text().notNull(),
	beforeJson: jsonb("before_json"),
	afterJson: jsonb("after_json"),
	reason: text(),
	ipHash: text("ip_hash"),
	userAgentHash: text("user_agent_hash"),
	requestId: uuid("request_id").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("admin_audit_logs_202604_actor_id_created_at_idx").using("btree", table.actorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("admin_audit_logs_202604_entity_type_entity_id_created_at_idx").using("btree", table.entityType.asc().nullsLast().op("timestamptz_ops"), table.entityId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("admin_audit_logs_202604_permission_key_created_at_idx").using("btree", table.permissionKey.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("admin_audit_logs_202604_request_id_idx").using("btree", table.requestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [adminIdentities.id],
			name: "admin_audit_logs_actor_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.id, table.createdAt], name: "admin_audit_logs_202604_pkey"}),
]);
export const confessionsFeed = pgView("confessions_feed", {	id: uuid(),
	body: text(),
	category: text(),
	imageUrl: text("image_url"),
	isAnonymous: boolean("is_anonymous"),
	likeCount: integer("like_count"),
	commentCount: integer("comment_count"),
	reportCount: integer("report_count"),
	isFlagged: boolean("is_flagged"),
	universityDomain: text("university_domain"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	isMine: boolean("is_mine"),
	authorName: text("author_name"),
	authorUsername: text("author_username"),
	authorAvatar: text("author_avatar"),
}).as(sql`SELECT c.id, c.body, c.category, c.image_url, c.is_anonymous, c.like_count, c.comment_count, c.report_count, c.is_flagged, c.university_domain, c.created_at, c.author_id = auth.uid() AS is_mine, CASE WHEN c.is_anonymous THEN 'Anonim Öğrenci'::text WHEN c.author_id = auth.uid() THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text) WHEN COALESCE(us.profile_visibility_enabled, true) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text) ELSE 'Anonim Öğrenci'::text END AS author_name, CASE WHEN c.is_anonymous THEN NULL::text WHEN c.author_id = auth.uid() THEN p.username WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.username ELSE NULL::text END AS author_username, CASE WHEN c.is_anonymous THEN NULL::text WHEN c.author_id = auth.uid() THEN p.avatar_url WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.avatar_url ELSE NULL::text END AS author_avatar FROM confessions c LEFT JOIN profiles p ON p.id = c.author_id LEFT JOIN user_settings us ON us.user_id = c.author_id WHERE c.university_domain = (( SELECT p2.university_domain FROM profiles p2 WHERE p2.id = auth.uid())) AND c.hidden_at IS NULL AND COALESCE(c.moderation_status, 'published'::text) = 'published'::text`);

export const confessionCommentsFeed = pgView("confession_comments_feed", {	id: uuid(),
	confessionId: uuid("confession_id"),
	body: text(),
	isAnonymous: boolean("is_anonymous"),
	replyTo: uuid("reply_to"),
	reportCount: integer("report_count"),
	isFlagged: boolean("is_flagged"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	isMine: boolean("is_mine"),
	authorName: text("author_name"),
	authorUsername: text("author_username"),
	authorAvatar: text("author_avatar"),
}).as(sql`SELECT cc.id, cc.confession_id, cc.body, cc.is_anonymous, cc.reply_to, cc.report_count, cc.is_flagged, cc.created_at, cc.author_id = auth.uid() AS is_mine, CASE WHEN cc.is_anonymous THEN 'Anonim Öğrenci'::text WHEN cc.author_id = auth.uid() THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text) WHEN COALESCE(us.profile_visibility_enabled, true) THEN COALESCE(p.full_name, p.username, 'Öğrenci'::text) ELSE 'Anonim Öğrenci'::text END AS author_name, CASE WHEN cc.is_anonymous THEN NULL::text WHEN cc.author_id = auth.uid() THEN p.username WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.username ELSE NULL::text END AS author_username, CASE WHEN cc.is_anonymous THEN NULL::text WHEN cc.author_id = auth.uid() THEN p.avatar_url WHEN COALESCE(us.profile_visibility_enabled, true) THEN p.avatar_url ELSE NULL::text END AS author_avatar FROM confession_comments cc JOIN confessions c ON c.id = cc.confession_id LEFT JOIN profiles p ON p.id = cc.author_id LEFT JOIN user_settings us ON us.user_id = cc.author_id WHERE c.university_domain = (( SELECT p2.university_domain FROM profiles p2 WHERE p2.id = auth.uid())) AND c.hidden_at IS NULL AND COALESCE(c.moderation_status, 'published'::text) = 'published'::text AND cc.hidden_at IS NULL AND COALESCE(cc.moderation_status, 'published'::text) = 'published'::text`);

export const adminStatsSnapshot = pgMaterializedView("admin_stats_snapshot", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalUsers: bigint("total_users", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalSessions: bigint("total_sessions", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalConfessions: bigint("total_confessions", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalNotes: bigint("total_notes", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalReports: bigint("total_reports", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalCommunities: bigint("total_communities", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalCommunityMembers: bigint("total_community_members", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	activeSessions: bigint("active_sessions", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	pendingReports: bigint("pending_reports", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalLikes: bigint("total_likes", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalComments: bigint("total_comments", { mode: "number" }),
	refreshedAt: timestamp("refreshed_at", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT ( SELECT count(*) AS count FROM profiles) AS total_users, ( SELECT count(*) AS count FROM study_sessions) AS total_sessions, ( SELECT count(*) AS count FROM confessions) AS total_confessions, ( SELECT count(*) AS count FROM notes) AS total_notes, ( SELECT count(*) AS count FROM reports) AS total_reports, ( SELECT count(*) AS count FROM communities) AS total_communities, ( SELECT count(*) AS count FROM community_members) AS total_community_members, ( SELECT count(*) AS count FROM study_sessions WHERE study_sessions.status = ANY (ARRAY['active'::text, 'planned'::text])) AS active_sessions, ( SELECT count(*) AS count FROM reports WHERE reports.status = 'pending'::text) AS pending_reports, ( SELECT count(*) AS count FROM confession_likes) AS total_likes, ( SELECT count(*) AS count FROM confession_comments) AS total_comments, now() AS refreshed_at`);