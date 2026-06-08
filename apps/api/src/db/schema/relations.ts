// @ts-nocheck
import { relations } from "drizzle-orm/relations";
import { flowStateInAuth, samlRelayStatesInAuth, ssoProvidersInAuth, samlProvidersInAuth, usersInAuth, notifications, sessionsInAuth, refreshTokensInAuth, oauthClientsInAuth, ssoDomainsInAuth, mfaAmrClaimsInAuth, identitiesInAuth, oneTimeTokensInAuth, mfaFactorsInAuth, mfaChallengesInAuth, oauthConsentsInAuth, oauthAuthorizationsInAuth, cities, universities, universityDomainAliases, confessions, confessionReports, faculties, departments, notes, courses, userCourses, studySessions, sessionParticipants, cityEvents, eventSubmissions, eventPartners, eventStorySlots, eventCampaignLogs, adminIdentities, confessionLikes, confessionBookmarks, noteVotes, noteComments, deviceTokens, landingPageSections, userSettings, userPresence, webauthnCredentialsInAuth, webauthnChallengesInAuth, communityRequests, revenueDeals, adminRoleBindings, adminRoles, reports, confessionComments, moderationWordRules, moderationScanLogs, pushCampaigns, pushCampaignDeliveries, profiles, communities, communityMembers, communityPosts, communityEvents, userSanctions, userConsents, adminActionApprovals, adminPermissions, moderationAppeals, opsQueueItems, opsQueueAssignments, adminFeatureFlags, adminIncidentEvents, userSisterUniversities, adminRolePermissions, appTelemetryEventsDefault, appTelemetryEvents202603, appTelemetryEvents202604, adminAuditLogsDefault, adminAuditLogs202603, adminAuditLogs202604 } from "./schema";

export const samlRelayStatesInAuthRelations = relations(samlRelayStatesInAuth, ({one}) => ({
	flowStateInAuth: one(flowStateInAuth, {
		fields: [samlRelayStatesInAuth.flowStateId],
		references: [flowStateInAuth.id]
	}),
	ssoProvidersInAuth: one(ssoProvidersInAuth, {
		fields: [samlRelayStatesInAuth.ssoProviderId],
		references: [ssoProvidersInAuth.id]
	}),
}));

export const flowStateInAuthRelations = relations(flowStateInAuth, ({many}) => ({
	samlRelayStatesInAuths: many(samlRelayStatesInAuth),
}));

export const ssoProvidersInAuthRelations = relations(ssoProvidersInAuth, ({many}) => ({
	samlRelayStatesInAuths: many(samlRelayStatesInAuth),
	samlProvidersInAuths: many(samlProvidersInAuth),
	ssoDomainsInAuths: many(ssoDomainsInAuth),
}));

export const samlProvidersInAuthRelations = relations(samlProvidersInAuth, ({one}) => ({
	ssoProvidersInAuth: one(ssoProvidersInAuth, {
		fields: [samlProvidersInAuth.ssoProviderId],
		references: [ssoProvidersInAuth.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [notifications.recipientId],
		references: [usersInAuth.id]
	}),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	notifications: many(notifications),
	sessionsInAuths: many(sessionsInAuth),
	identitiesInAuths: many(identitiesInAuth),
	oneTimeTokensInAuths: many(oneTimeTokensInAuth),
	mfaFactorsInAuths: many(mfaFactorsInAuth),
	oauthConsentsInAuths: many(oauthConsentsInAuth),
	oauthAuthorizationsInAuths: many(oauthAuthorizationsInAuth),
	confessionReports: many(confessionReports),
	notes_authorId: many(notes, {
		relationName: "notes_authorId_usersInAuth_id"
	}),
	notes_uploaderId: many(notes, {
		relationName: "notes_uploaderId_usersInAuth_id"
	}),
	userCourses: many(userCourses),
	studySessions: many(studySessions),
	sessionParticipants: many(sessionParticipants),
	eventCampaignLogs: many(eventCampaignLogs),
	confessions: many(confessions),
	confessionLikes: many(confessionLikes),
	confessionBookmarks: many(confessionBookmarks),
	noteVotes: many(noteVotes),
	noteComments: many(noteComments),
	deviceTokens: many(deviceTokens),
	landingPageSections: many(landingPageSections),
	userSettings: many(userSettings),
	userPresences: many(userPresence),
	webauthnCredentialsInAuths: many(webauthnCredentialsInAuth),
	webauthnChallengesInAuths: many(webauthnChallengesInAuth),
	communityRequests: many(communityRequests),
	reports: many(reports),
	confessionComments: many(confessionComments),
	moderationScanLogs: many(moderationScanLogs),
	profiles: many(profiles),
	communityMembers: many(communityMembers),
	communityPosts: many(communityPosts),
	communityEvents: many(communityEvents),
	userSanctions: many(userSanctions),
	communities: many(communities),
	userConsents: many(userConsents),
	moderationAppeals: many(moderationAppeals),
	userSisterUniversities: many(userSisterUniversities),
	appTelemetryEventsDefaults: many(appTelemetryEventsDefault),
	appTelemetryEvents202603s: many(appTelemetryEvents202603),
	appTelemetryEvents202604s: many(appTelemetryEvents202604),
}));

export const refreshTokensInAuthRelations = relations(refreshTokensInAuth, ({one}) => ({
	sessionsInAuth: one(sessionsInAuth, {
		fields: [refreshTokensInAuth.sessionId],
		references: [sessionsInAuth.id]
	}),
}));

export const sessionsInAuthRelations = relations(sessionsInAuth, ({one, many}) => ({
	refreshTokensInAuths: many(refreshTokensInAuth),
	oauthClientsInAuth: one(oauthClientsInAuth, {
		fields: [sessionsInAuth.oauthClientId],
		references: [oauthClientsInAuth.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [sessionsInAuth.userId],
		references: [usersInAuth.id]
	}),
	mfaAmrClaimsInAuths: many(mfaAmrClaimsInAuth),
}));

export const oauthClientsInAuthRelations = relations(oauthClientsInAuth, ({many}) => ({
	sessionsInAuths: many(sessionsInAuth),
	oauthConsentsInAuths: many(oauthConsentsInAuth),
	oauthAuthorizationsInAuths: many(oauthAuthorizationsInAuth),
}));

export const ssoDomainsInAuthRelations = relations(ssoDomainsInAuth, ({one}) => ({
	ssoProvidersInAuth: one(ssoProvidersInAuth, {
		fields: [ssoDomainsInAuth.ssoProviderId],
		references: [ssoProvidersInAuth.id]
	}),
}));

export const mfaAmrClaimsInAuthRelations = relations(mfaAmrClaimsInAuth, ({one}) => ({
	sessionsInAuth: one(sessionsInAuth, {
		fields: [mfaAmrClaimsInAuth.sessionId],
		references: [sessionsInAuth.id]
	}),
}));

export const identitiesInAuthRelations = relations(identitiesInAuth, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [identitiesInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const oneTimeTokensInAuthRelations = relations(oneTimeTokensInAuth, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [oneTimeTokensInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const mfaChallengesInAuthRelations = relations(mfaChallengesInAuth, ({one}) => ({
	mfaFactorsInAuth: one(mfaFactorsInAuth, {
		fields: [mfaChallengesInAuth.factorId],
		references: [mfaFactorsInAuth.id]
	}),
}));

export const mfaFactorsInAuthRelations = relations(mfaFactorsInAuth, ({one, many}) => ({
	mfaChallengesInAuths: many(mfaChallengesInAuth),
	usersInAuth: one(usersInAuth, {
		fields: [mfaFactorsInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const oauthConsentsInAuthRelations = relations(oauthConsentsInAuth, ({one}) => ({
	oauthClientsInAuth: one(oauthClientsInAuth, {
		fields: [oauthConsentsInAuth.clientId],
		references: [oauthClientsInAuth.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [oauthConsentsInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const oauthAuthorizationsInAuthRelations = relations(oauthAuthorizationsInAuth, ({one}) => ({
	oauthClientsInAuth: one(oauthClientsInAuth, {
		fields: [oauthAuthorizationsInAuth.clientId],
		references: [oauthClientsInAuth.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [oauthAuthorizationsInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const universitiesRelations = relations(universities, ({one, many}) => ({
	city: one(cities, {
		fields: [universities.cityId],
		references: [cities.id]
	}),
	universityDomainAliases: many(universityDomainAliases),
}));

export const citiesRelations = relations(cities, ({many}) => ({
	universities: many(universities),
	eventSubmissions: many(eventSubmissions),
	cityEvents: many(cityEvents),
	eventStorySlots: many(eventStorySlots),
	eventCampaignLogs: many(eventCampaignLogs),
	revenueDeals: many(revenueDeals),
}));

export const universityDomainAliasesRelations = relations(universityDomainAliases, ({one}) => ({
	university: one(universities, {
		fields: [universityDomainAliases.universityId],
		references: [universities.id]
	}),
}));

export const confessionReportsRelations = relations(confessionReports, ({one}) => ({
	confession: one(confessions, {
		fields: [confessionReports.confessionId],
		references: [confessions.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [confessionReports.reporterId],
		references: [usersInAuth.id]
	}),
}));

export const confessionsRelations = relations(confessions, ({one, many}) => ({
	confessionReports: many(confessionReports),
	usersInAuth: one(usersInAuth, {
		fields: [confessions.authorId],
		references: [usersInAuth.id]
	}),
	adminIdentity: one(adminIdentities, {
		fields: [confessions.hiddenByAdminId],
		references: [adminIdentities.id]
	}),
	confessionLikes: many(confessionLikes),
	confessionBookmarks: many(confessionBookmarks),
	confessionComments: many(confessionComments),
}));

export const departmentsRelations = relations(departments, ({one, many}) => ({
	faculty: one(faculties, {
		fields: [departments.facultyId],
		references: [faculties.id]
	}),
	profiles: many(profiles),
}));

export const facultiesRelations = relations(faculties, ({many}) => ({
	departments: many(departments),
	profiles: many(profiles),
}));

export const notesRelations = relations(notes, ({one, many}) => ({
	usersInAuth_authorId: one(usersInAuth, {
		fields: [notes.authorId],
		references: [usersInAuth.id],
		relationName: "notes_authorId_usersInAuth_id"
	}),
	course: one(courses, {
		fields: [notes.courseId],
		references: [courses.id]
	}),
	usersInAuth_uploaderId: one(usersInAuth, {
		fields: [notes.uploaderId],
		references: [usersInAuth.id],
		relationName: "notes_uploaderId_usersInAuth_id"
	}),
	noteVotes: many(noteVotes),
	noteComments: many(noteComments),
}));

export const coursesRelations = relations(courses, ({many}) => ({
	notes: many(notes),
	userCourses: many(userCourses),
	studySessions: many(studySessions),
}));

export const userCoursesRelations = relations(userCourses, ({one}) => ({
	course: one(courses, {
		fields: [userCourses.courseId],
		references: [courses.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [userCourses.userId],
		references: [usersInAuth.id]
	}),
}));

export const studySessionsRelations = relations(studySessions, ({one, many}) => ({
	course: one(courses, {
		fields: [studySessions.courseId],
		references: [courses.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [studySessions.creatorId],
		references: [usersInAuth.id]
	}),
	sessionParticipants: many(sessionParticipants),
}));

export const sessionParticipantsRelations = relations(sessionParticipants, ({one}) => ({
	studySession: one(studySessions, {
		fields: [sessionParticipants.sessionId],
		references: [studySessions.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [sessionParticipants.userId],
		references: [usersInAuth.id]
	}),
}));

export const eventSubmissionsRelations = relations(eventSubmissions, ({one, many}) => ({
	cityEvent: one(cityEvents, {
		fields: [eventSubmissions.approvedEventId],
		references: [cityEvents.id],
		relationName: "eventSubmissions_approvedEventId_cityEvents_id"
	}),
	city: one(cities, {
		fields: [eventSubmissions.cityId],
		references: [cities.id]
	}),
	cityEvents: many(cityEvents, {
		relationName: "cityEvents_sourceSubmissionId_eventSubmissions_id"
	}),
}));

export const cityEventsRelations = relations(cityEvents, ({one, many}) => ({
	eventSubmissions: many(eventSubmissions, {
		relationName: "eventSubmissions_approvedEventId_cityEvents_id"
	}),
	city: one(cities, {
		fields: [cityEvents.cityId],
		references: [cities.id]
	}),
	eventPartner: one(eventPartners, {
		fields: [cityEvents.partnerId],
		references: [eventPartners.id]
	}),
	eventSubmission: one(eventSubmissions, {
		fields: [cityEvents.sourceSubmissionId],
		references: [eventSubmissions.id],
		relationName: "cityEvents_sourceSubmissionId_eventSubmissions_id"
	}),
	eventStorySlots: many(eventStorySlots),
	eventCampaignLogs: many(eventCampaignLogs),
}));

export const eventPartnersRelations = relations(eventPartners, ({many}) => ({
	cityEvents: many(cityEvents),
	revenueDeals: many(revenueDeals),
}));

export const eventStorySlotsRelations = relations(eventStorySlots, ({one, many}) => ({
	city: one(cities, {
		fields: [eventStorySlots.cityId],
		references: [cities.id]
	}),
	cityEvent: one(cityEvents, {
		fields: [eventStorySlots.eventId],
		references: [cityEvents.id]
	}),
	eventCampaignLogs: many(eventCampaignLogs),
}));

export const eventCampaignLogsRelations = relations(eventCampaignLogs, ({one}) => ({
	cityEvent: one(cityEvents, {
		fields: [eventCampaignLogs.eventId],
		references: [cityEvents.id]
	}),
	eventStorySlot: one(eventStorySlots, {
		fields: [eventCampaignLogs.storySlotId],
		references: [eventStorySlots.id]
	}),
	city: one(cities, {
		fields: [eventCampaignLogs.viewerCityId],
		references: [cities.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [eventCampaignLogs.viewerId],
		references: [usersInAuth.id]
	}),
}));

export const adminIdentitiesRelations = relations(adminIdentities, ({many}) => ({
	confessions: many(confessions),
	revenueDeals: many(revenueDeals),
	adminRoleBindings: many(adminRoleBindings),
	confessionComments: many(confessionComments),
	moderationWordRules: many(moderationWordRules),
	pushCampaigns_approvedBy: many(pushCampaigns, {
		relationName: "pushCampaigns_approvedBy_adminIdentities_id"
	}),
	pushCampaigns_createdBy: many(pushCampaigns, {
		relationName: "pushCampaigns_createdBy_adminIdentities_id"
	}),
	adminActionApprovals_approvedBy: many(adminActionApprovals, {
		relationName: "adminActionApprovals_approvedBy_adminIdentities_id"
	}),
	adminActionApprovals_requestedBy: many(adminActionApprovals, {
		relationName: "adminActionApprovals_requestedBy_adminIdentities_id"
	}),
	moderationAppeals: many(moderationAppeals),
	opsQueueItems: many(opsQueueItems),
	opsQueueAssignments: many(opsQueueAssignments),
	adminFeatureFlags: many(adminFeatureFlags),
	adminIncidentEvents: many(adminIncidentEvents),
	adminAuditLogsDefaults: many(adminAuditLogsDefault),
	adminAuditLogs202603s: many(adminAuditLogs202603),
	adminAuditLogs202604s: many(adminAuditLogs202604),
}));

export const confessionLikesRelations = relations(confessionLikes, ({one}) => ({
	confession: one(confessions, {
		fields: [confessionLikes.confessionId],
		references: [confessions.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [confessionLikes.userId],
		references: [usersInAuth.id]
	}),
}));

export const confessionBookmarksRelations = relations(confessionBookmarks, ({one}) => ({
	confession: one(confessions, {
		fields: [confessionBookmarks.confessionId],
		references: [confessions.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [confessionBookmarks.userId],
		references: [usersInAuth.id]
	}),
}));

export const noteVotesRelations = relations(noteVotes, ({one}) => ({
	note: one(notes, {
		fields: [noteVotes.noteId],
		references: [notes.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [noteVotes.userId],
		references: [usersInAuth.id]
	}),
}));

export const noteCommentsRelations = relations(noteComments, ({one}) => ({
	note: one(notes, {
		fields: [noteComments.noteId],
		references: [notes.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [noteComments.userId],
		references: [usersInAuth.id]
	}),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [deviceTokens.userId],
		references: [usersInAuth.id]
	}),
}));

export const landingPageSectionsRelations = relations(landingPageSections, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [landingPageSections.updatedBy],
		references: [usersInAuth.id]
	}),
}));

export const userSettingsRelations = relations(userSettings, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userSettings.userId],
		references: [usersInAuth.id]
	}),
}));

export const userPresenceRelations = relations(userPresence, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userPresence.userId],
		references: [usersInAuth.id]
	}),
}));

export const webauthnCredentialsInAuthRelations = relations(webauthnCredentialsInAuth, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [webauthnCredentialsInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const webauthnChallengesInAuthRelations = relations(webauthnChallengesInAuth, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [webauthnChallengesInAuth.userId],
		references: [usersInAuth.id]
	}),
}));

export const communityRequestsRelations = relations(communityRequests, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [communityRequests.requesterId],
		references: [usersInAuth.id]
	}),
}));

export const revenueDealsRelations = relations(revenueDeals, ({one}) => ({
	city: one(cities, {
		fields: [revenueDeals.cityId],
		references: [cities.id]
	}),
	adminIdentity: one(adminIdentities, {
		fields: [revenueDeals.ownerIdentityId],
		references: [adminIdentities.id]
	}),
	eventPartner: one(eventPartners, {
		fields: [revenueDeals.partnerId],
		references: [eventPartners.id]
	}),
}));

export const adminRoleBindingsRelations = relations(adminRoleBindings, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminRoleBindings.identityId],
		references: [adminIdentities.id]
	}),
	adminRole: one(adminRoles, {
		fields: [adminRoleBindings.roleId],
		references: [adminRoles.id]
	}),
}));

export const adminRolesRelations = relations(adminRoles, ({many}) => ({
	adminRoleBindings: many(adminRoleBindings),
	adminRolePermissions: many(adminRolePermissions),
}));

export const reportsRelations = relations(reports, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [reports.reporterId],
		references: [usersInAuth.id]
	}),
}));

export const confessionCommentsRelations = relations(confessionComments, ({one, many}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [confessionComments.authorId],
		references: [usersInAuth.id]
	}),
	confession: one(confessions, {
		fields: [confessionComments.confessionId],
		references: [confessions.id]
	}),
	adminIdentity: one(adminIdentities, {
		fields: [confessionComments.hiddenByAdminId],
		references: [adminIdentities.id]
	}),
	confessionComment: one(confessionComments, {
		fields: [confessionComments.replyTo],
		references: [confessionComments.id],
		relationName: "confessionComments_replyTo_confessionComments_id"
	}),
	confessionComments: many(confessionComments, {
		relationName: "confessionComments_replyTo_confessionComments_id"
	}),
}));

export const moderationWordRulesRelations = relations(moderationWordRules, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [moderationWordRules.updatedBy],
		references: [adminIdentities.id]
	}),
}));

export const moderationScanLogsRelations = relations(moderationScanLogs, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [moderationScanLogs.actorUserId],
		references: [usersInAuth.id]
	}),
}));

export const pushCampaignsRelations = relations(pushCampaigns, ({one, many}) => ({
	adminIdentity_approvedBy: one(adminIdentities, {
		fields: [pushCampaigns.approvedBy],
		references: [adminIdentities.id],
		relationName: "pushCampaigns_approvedBy_adminIdentities_id"
	}),
	adminIdentity_createdBy: one(adminIdentities, {
		fields: [pushCampaigns.createdBy],
		references: [adminIdentities.id],
		relationName: "pushCampaigns_createdBy_adminIdentities_id"
	}),
	pushCampaignDeliveries: many(pushCampaignDeliveries),
}));

export const pushCampaignDeliveriesRelations = relations(pushCampaignDeliveries, ({one}) => ({
	pushCampaign: one(pushCampaigns, {
		fields: [pushCampaignDeliveries.campaignId],
		references: [pushCampaigns.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one}) => ({
	department: one(departments, {
		fields: [profiles.departmentId],
		references: [departments.id]
	}),
	faculty: one(faculties, {
		fields: [profiles.facultyId],
		references: [faculties.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [profiles.id],
		references: [usersInAuth.id]
	}),
}));

export const communityMembersRelations = relations(communityMembers, ({one}) => ({
	community: one(communities, {
		fields: [communityMembers.communityId],
		references: [communities.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [communityMembers.userId],
		references: [usersInAuth.id]
	}),
}));

export const communitiesRelations = relations(communities, ({one, many}) => ({
	communityMembers: many(communityMembers),
	communityPosts: many(communityPosts),
	communityEvents: many(communityEvents),
	usersInAuth: one(usersInAuth, {
		fields: [communities.ownerId],
		references: [usersInAuth.id]
	}),
}));

export const communityPostsRelations = relations(communityPosts, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [communityPosts.authorId],
		references: [usersInAuth.id]
	}),
	community: one(communities, {
		fields: [communityPosts.communityId],
		references: [communities.id]
	}),
}));

export const communityEventsRelations = relations(communityEvents, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [communityEvents.authorId],
		references: [usersInAuth.id]
	}),
	community: one(communities, {
		fields: [communityEvents.communityId],
		references: [communities.id]
	}),
}));

export const userSanctionsRelations = relations(userSanctions, ({one, many}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userSanctions.userId],
		references: [usersInAuth.id]
	}),
	moderationAppeals: many(moderationAppeals),
}));

export const userConsentsRelations = relations(userConsents, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userConsents.userId],
		references: [usersInAuth.id]
	}),
}));

export const adminActionApprovalsRelations = relations(adminActionApprovals, ({one}) => ({
	adminIdentity_approvedBy: one(adminIdentities, {
		fields: [adminActionApprovals.approvedBy],
		references: [adminIdentities.id],
		relationName: "adminActionApprovals_approvedBy_adminIdentities_id"
	}),
	adminPermission: one(adminPermissions, {
		fields: [adminActionApprovals.permissionKey],
		references: [adminPermissions.permissionKey]
	}),
	adminIdentity_requestedBy: one(adminIdentities, {
		fields: [adminActionApprovals.requestedBy],
		references: [adminIdentities.id],
		relationName: "adminActionApprovals_requestedBy_adminIdentities_id"
	}),
}));

export const adminPermissionsRelations = relations(adminPermissions, ({many}) => ({
	adminActionApprovals: many(adminActionApprovals),
	adminRolePermissions: many(adminRolePermissions),
}));

export const moderationAppealsRelations = relations(moderationAppeals, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [moderationAppeals.reviewedBy],
		references: [adminIdentities.id]
	}),
	userSanction: one(userSanctions, {
		fields: [moderationAppeals.sanctionId],
		references: [userSanctions.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [moderationAppeals.userId],
		references: [usersInAuth.id]
	}),
}));

export const opsQueueItemsRelations = relations(opsQueueItems, ({one, many}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [opsQueueItems.ownerId],
		references: [adminIdentities.id]
	}),
	opsQueueAssignments: many(opsQueueAssignments),
}));

export const opsQueueAssignmentsRelations = relations(opsQueueAssignments, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [opsQueueAssignments.adminId],
		references: [adminIdentities.id]
	}),
	opsQueueItem: one(opsQueueItems, {
		fields: [opsQueueAssignments.queueItemId],
		references: [opsQueueItems.id]
	}),
}));

export const adminFeatureFlagsRelations = relations(adminFeatureFlags, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminFeatureFlags.updatedBy],
		references: [adminIdentities.id]
	}),
}));

export const adminIncidentEventsRelations = relations(adminIncidentEvents, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminIncidentEvents.createdBy],
		references: [adminIdentities.id]
	}),
}));

export const userSisterUniversitiesRelations = relations(userSisterUniversities, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userSisterUniversities.userId],
		references: [usersInAuth.id]
	}),
}));

export const adminRolePermissionsRelations = relations(adminRolePermissions, ({one}) => ({
	adminPermission: one(adminPermissions, {
		fields: [adminRolePermissions.permissionKey],
		references: [adminPermissions.permissionKey]
	}),
	adminRole: one(adminRoles, {
		fields: [adminRolePermissions.roleId],
		references: [adminRoles.id]
	}),
}));

export const appTelemetryEventsDefaultRelations = relations(appTelemetryEventsDefault, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [appTelemetryEventsDefault.userId],
		references: [usersInAuth.id]
	}),
}));

export const appTelemetryEvents202603Relations = relations(appTelemetryEvents202603, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [appTelemetryEvents202603.userId],
		references: [usersInAuth.id]
	}),
}));

export const appTelemetryEvents202604Relations = relations(appTelemetryEvents202604, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [appTelemetryEvents202604.userId],
		references: [usersInAuth.id]
	}),
}));

export const adminAuditLogsDefaultRelations = relations(adminAuditLogsDefault, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminAuditLogsDefault.actorId],
		references: [adminIdentities.id]
	}),
}));

export const adminAuditLogs202603Relations = relations(adminAuditLogs202603, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminAuditLogs202603.actorId],
		references: [adminIdentities.id]
	}),
}));

export const adminAuditLogs202604Relations = relations(adminAuditLogs202604, ({one}) => ({
	adminIdentity: one(adminIdentities, {
		fields: [adminAuditLogs202604.actorId],
		references: [adminIdentities.id]
	}),
}));