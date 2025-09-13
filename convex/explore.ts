import { query } from "./_generated/server";

// Featured carousel: most recently featured first (max 12)
export const listFeatured = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("projects")
      .withIndex("featured", (q) => q.gt("featuredAt", 0))
      .order("desc")
      .take(12);
  },
});

// Recent public projects (max 50)
export const listPublicRecent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("projects")
      .withIndex("public_recent", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(50);
  },
});
