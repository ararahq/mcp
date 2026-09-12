import { z } from "zod";

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const identitySchema = z
  .object({ name: z.string(), email: z.string().email() })
  .passthrough();
export const planSchema = z.record(jsonValueSchema);
export const balanceSchema = z.record(jsonValueSchema);
export const mutationSchema = z.record(jsonValueSchema);

export const paginationSchema = z.object({
  page: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  totalElements: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const templateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    formattedName: z.string().optional(),
    category: z.string(),
    language: z.string(),
    providerStatus: z.string(),
    rejectionReason: z.string().nullable().optional(),
    availableForSending: z.boolean(),
    bodyPreview: z.string().nullable().optional(),
    structureJson: jsonValueSchema.optional(),
  })
  .passthrough();
export const templatesSchema = z.array(templateSchema);
export const pagedTemplatesSchema = z
  .object({ data: templatesSchema, pagination: paginationSchema })
  .transform(({ data }) => data);
export const templateStatusSchema = z
  .object({
    status: z.string(),
    rejectionReason: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
  })
  .passthrough();

export const messageSchema = z
  .object({
    id: z.string().nullable(),
    status: z.string(),
    receiver: z.string(),
    cost: z.number().nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .passthrough();

export const windowStatusSchema = z.object({
  results: z.array(
    z
      .object({
        phone: z.string(),
        isWindowOpen: z.boolean(),
        hoursRemaining: z.number().nullable().optional(),
      })
      .passthrough(),
  ),
});

export const contactSchema = z.object({ name: z.string(), phone: z.string() }).passthrough();
export const contactsListSchema = z
  .object({ contacts: z.array(contactSchema), total: z.number().int().nonnegative() })
  .passthrough();
export const contactsBatchSchema = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z
      .array(
        z
          .object({
            index: z.number().int(),
            phone: z.string().nullable().optional(),
            reason: z.string(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export const conversationMessageSchema = z
  .object({
    direction: z.string(),
    status: z.string(),
    templateName: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .passthrough();
export const conversationSchema = z
  .object({
    phone: z.string(),
    total: z.number().int().nonnegative(),
    messages: z.array(conversationMessageSchema),
  })
  .passthrough();

export const campaignSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    totalMessages: z.number().int().nonnegative(),
    totalCost: z.number(),
    scheduledAt: z.string().nullable().optional(),
  })
  .passthrough();
export const campaignListItemSchema = campaignSchema.extend({
  templateName: z.string(),
  sentCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  readCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: z.string().nullable().optional(),
});
export const campaignListSchema = z
  .object({
    content: z.array(campaignListItemSchema),
    totalPages: z.number().int().nonnegative(),
    totalElements: z.number().int().nonnegative(),
  })
  .transform(({ content, totalPages, totalElements }) => ({
    data: content,
    pagination: { totalPages, totalElements },
  }));
export const campaignDetailSchema = campaignListItemSchema.extend({
  clickedCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative().default(0),
  convertedCount: z.number().int().nonnegative(),
  convertedValue: z.number(),
  holdoutCount: z.number().int().nonnegative().default(0),
  blockedCount: z.number().int().nonnegative().default(0),
  blockReasons: z.array(z.object({ motivo: z.string(), quantidade: z.number() })).default([]),
  refundCount: z.number().int().nonnegative().default(0),
  refundValue: z.number().default(0),
});

export const numberSchema = z.record(jsonValueSchema);
export const numbersSchema = z.object({
  numbers: z.array(numberSchema),
  slot: jsonValueSchema.nullable().optional(),
});

export const campaignEstimateSchema = z
  .object({
    templateCategory: z.string(),
    recipientCount: z.number().int().nonnegative(),
    unitPrice: z.number(),
    totalCost: z.number(),
  })
  .passthrough();
