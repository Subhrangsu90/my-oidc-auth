import { text, pgTable, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
	id: uuid("id").primaryKey().defaultRandom(),

	firstName: varchar("first_name", { length: 25 }).notNull(),
	lastName: varchar("last_name", { length: 25 }).notNull(),

	profileImageURL: text("profile_image_url"),

	email: varchar("email", { length: 322 }).notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),

	password: varchar("password", { length: 66 }).notNull(),
	salt: text("salt"),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const applicationsTable = pgTable("applications", {
	id: uuid("id").primaryKey().defaultRandom(),

	applicationName: varchar("application_name", { length: 50 }).notNull(),
	applicationDescription: text("application_description"),
	applicationURL: text("application_url").notNull(),
	redirectURIs: text("redirect_uris").notNull(),

	clientId: varchar("client_id").notNull().unique(),
	clientSecret: varchar("client_secret").notNull(),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const authorizationCodesTable = pgTable("authorization_codes", {
	id: uuid("id").primaryKey().defaultRandom(),

	code: varchar("code", { length: 64 }).notNull().unique(),
	applicationId: uuid("application_id")
		.notNull()
		.references(() => applicationsTable.id),
	userId: uuid("user_id")
		.notNull()
		.references(() => usersTable.id),
	redirectURI: text("redirect_uri").notNull(),

	expiresAt: timestamp("expires_at").notNull(),
	usedAt: timestamp("used_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
