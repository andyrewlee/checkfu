import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const getOrCreateMyProject = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    // Ensure user row
    let user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) {
      const id = await ctx.db.insert("users", {
        externalId: identity.subject,
        displayName: identity.name ?? "",
        email: identity.email ?? "",
        imageUrl: identity.pictureUrl ?? "",
        createdAt: Date.now(),
      });
      user = await ctx.db.get(id);
    }
    if (!user) throw new Error("User missing");

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      ownerId: user._id,
      name: "My Project",
      slug: undefined,
      isPublic: false,
      featuredAt: undefined,
      tags: [],
      forkedFromProjectId: undefined,
      forkCount: 0,
      starCount: 0,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
      archived: false,
    });
    return projectId;
  },
});

export const getProjectFull = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const edges = await ctx.db
      .query("pageEdges")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const nodesByPage: Record<string, any[]> = {};
    for (const p of pages) {
      const nodes = await ctx.db
        .query("nodes")
        .withIndex("by_page", (q) => q.eq("pageId", p._id))
        .collect();
      nodesByPage[p._id] = nodes;
    }
    return { project, pages, edges, nodesByPage };
  },
});

export const getProjectById = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    return project;
  },
});
