import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex data model for Checkfu
export default defineSchema({
  // Keep example table for existing demo pages
  numbers: defineTable({ value: v.number() }),

  users: defineTable({
    externalId: v.string(), // Clerk user id (subject)
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_externalId", ["externalId"]),

  projects: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    // publication and discovery
    slug: v.optional(v.string()),
    isPublic: v.boolean(),
    featuredAt: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    // forking and stats
    forkedFromProjectId: v.optional(v.id("projects")),
    forkCount: v.optional(v.number()),
    starCount: v.optional(v.number()),
    viewCount: v.optional(v.number()),
    // housekeeping
    createdAt: v.number(),
    updatedAt: v.number(),
    archived: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("public_recent", ["isPublic", "updatedAt"])
    .index("featured", ["featuredAt"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),

  pages: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    kind: v.string(), // "coloring" | "worksheet"
    // canvas placement in the project graph
    x: v.number(),
    y: v.number(),
    scale: v.optional(v.number()),
    // inspector fields
    orientation: v.optional(v.string()),
    marginInches: v.optional(v.number()),
    style: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    userPrompt: v.optional(v.string()),
    // publication and lineage
    pageSlug: v.optional(v.string()), // unique within project
    isPublic: v.boolean(),
    forkedFromPageId: v.optional(v.id("pages")),
    // optional render
    renderFileId: v.optional(v.id("files")),
    isRoot: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_updated", ["projectId", "updatedAt"])
    .index("by_slug", ["pageSlug"]),

  pageEdges: defineTable({
    projectId: v.id("projects"),
    srcPageId: v.id("pages"),
    dstPageId: v.id("pages"),
    label: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_src", ["srcPageId"])
    .index("by_dst", ["dstPageId"])
    .index("by_project", ["projectId"]),

  nodes: defineTable(
    v.union(
      v.object({
        kind: v.literal("text"),
        pageId: v.id("pages"),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
        rotation: v.number(),
        z: v.number(),
        searchableText: v.optional(v.string()),
        content: v.string(),
        style: v.optional(
          v.object({
            fontFamily: v.optional(v.string()),
            fontSize: v.optional(v.number()),
            bold: v.optional(v.boolean()),
            italic: v.optional(v.boolean()),
            align: v.optional(v.string()),
          }),
        ),
        createdAt: v.number(),
        createdBy: v.id("users"),
      }),
      v.object({
        kind: v.literal("image"),
        pageId: v.id("pages"),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
        rotation: v.number(),
        z: v.number(),
        searchableText: v.optional(v.string()),
        fileId: v.id("files"),
        alt: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.id("users"),
      }),
    ),
  )
    .index("by_page", ["pageId"])
    .index("by_page_kind", ["pageId", "kind"])
    .index("by_page_z", ["pageId", "z"])
    .searchIndex("search_text", {
      searchField: "searchableText",
      filterFields: ["pageId", "kind"],
    }),

  files: defineTable({
    ownerId: v.id("users"),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    purpose: v.optional(v.string()), // page_render | thumbnail | upload | pdf
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_project", ["projectId"]),

  generations: defineTable({
    projectId: v.id("projects"),
    parentPageId: v.optional(v.id("pages")),
    pageId: v.optional(v.id("pages")),
    model: v.string(),
    systemPrompt: v.optional(v.string()),
    userPrompt: v.optional(v.string()),
    params: v.optional(v.any()),
    status: v.string(), // queued | running | succeeded | failed
    error: v.optional(v.string()),
    outputFileId: v.optional(v.id("files")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_page", ["pageId"])
    .index("by_status", ["status"]),

  usageCounters: defineTable({
    userId: v.id("users"),
    periodStart: v.number(), // millis
    periodEnd: v.number(),
    generationsUsed: v.number(),
    lastIncrementAt: v.optional(v.number()),
  }).index("by_user_period", ["userId", "periodStart"]),

  shareTokens: defineTable({
    kind: v.union(v.literal("project"), v.literal("page")),
    resourceId: v.union(v.id("projects"), v.id("pages")),
    mode: v.union(v.literal("view"), v.literal("comment")),
    tokenHash: v.string(),
    expiresAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_resource", ["kind", "resourceId"])
    .index("by_token", ["tokenHash"]),

  projectStars: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),
});
