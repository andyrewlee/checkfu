import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

// Internal: get a user row by Clerk subject (externalId)
export const getByExternalId = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
      .unique();
    return user ?? null;
  },
});

// Ensure a Convex user row exists for the signed-in Clerk user
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (existing) return existing._id;

    const id = await ctx.db.insert("users", {
      externalId: identity.subject,
      displayName: identity.name ?? "",
      email: identity.email ?? "",
      imageUrl: identity.pictureUrl ?? "",
      createdAt: Date.now(),
    });
    return id;
  },
});
