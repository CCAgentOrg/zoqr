/**
 * zod schemas for request validation. Centralized so the
 * route handlers stay terse and the contract is documented in one place.
 */
import { z } from "zod";

// ---- Wedges ----

export const WedgeInstallSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  base_url: z.string().url(),
  config: z.record(z.unknown()).optional().default({}),
});
export type WedgeInstall = z.infer<typeof WedgeInstallSchema>;

// ---- QR content ----

/**
 * Content block — the building block of a QR landing page.
 * Variants: rich-text, image, file (PDF etc.), link, form, divider.
 */
export const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), html: z.string().max(20_000) }),
  z.object({
    type: z.literal("image"),
    src: z.string().url(),
    alt: z.string().max(200).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("file"),
    src: z.string().url(),
    filename: z.string().max(200),
    size_bytes: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("link"),
    href: z.string().url(),
    label: z.string().max(120),
    cta: z.boolean().optional().default(false),
  }),
  z.object({
    type: z.literal("form"),
    fields: z
      .array(
        z.object({
          name: z.string().regex(/^[a-z0-9_]+$/),
          label: z.string().min(1).max(80),
          kind: z.enum(["text", "email", "tel", "textarea", "rating", "select"]),
          required: z.boolean().optional().default(false),
          options: z.array(z.string()).optional(),
        })
      )
      .min(1),
    submit_label: z.string().max(40).optional().default("Submit"),
  }),
  z.object({ type: z.literal("divider") }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const QRContentSchema = z.object({
  blocks: z.array(BlockSchema).max(50).default([]),
  meta: z
    .object({
      og_title: z.string().max(120).optional(),
      og_description: z.string().max(300).optional(),
      og_image: z.string().url().optional(),
      theme: z.enum(["light", "dark"]).optional().default("light"),
    })
    .optional()
    .default({}),
});
export type QRContent = z.infer<typeof QRContentSchema>;

// ---- QR CRUD ----

export const QRCreateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  title: z.string().min(1).max(200),
  wedge_id: z.string().max(64).nullable().optional(),
  content: QRContentSchema.optional().default({ blocks: [], meta: {} }),
});

export const QRUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  wedge_id: z.string().max(64).nullable().optional(),
  content: QRContentSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

// ---- Submissions ----

export const SubmitSchema = z.object({
  slug: z.string().min(1).max(48),
  form_data: z.record(z.unknown()),
});

// ---- Scan log ----

export const ScanSchema = z.object({
  slug: z.string().min(1).max(48),
  referer: z.string().url().optional(),
});
