import { z } from "zod";

export const aiStatusSchema = z.enum(["pending", "processing", "complete", "failed"]);
export const reviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const sendStatusSchema = z.enum(["none", "queued", "sent", "failed"]);
export const jobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

export const receiptExtractionSchema = z.object({
  amount: z.number().finite().nonnegative().max(9_999_999_999.99).nullable(),
  brand: z.string().trim().max(120).nullable(),
  summary: z.string().trim().min(1).max(500),
  confidence: z.number().finite().min(0).max(1)
});
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

export const receiptModificationSchema = z.object({
  id: z.string(),
  modified_at: z.string(),
  modified_by: z.string().nullable(),
  field_name: z.enum(["amount", "brand"]),
  old_value: z.string().nullable(),
  new_value: z.string().nullable()
});
export type ReceiptModification = z.infer<typeof receiptModificationSchema>;

export const receiptSchema = z.object({
  id: z.string(),
  campaign_id: z.string().nullable(),
  phone_e164: z.string(),
  ic_last4: z.string().nullable(),
  media_path: z.string().nullable(),
  extracted_amount: z.number().nullable(),
  extracted_brand: z.string().nullable(),
  ai_result: receiptExtractionSchema.nullable().optional(),
  modifications: z.array(receiptModificationSchema).optional(),
  media_url: z.string().url().nullable().optional(),
  ai_status: aiStatusSchema,
  review_status: reviewStatusSchema,
  send_status: sendStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  campaign: z.object({ name: z.string(), brand: z.string() }).nullable().optional()
});

export const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  phone_number_id: z.string(),
  reject_template_name: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  min_amount: z.coerce.number().finite().nonnegative(),
  is_active: z.boolean(),
  created_at: z.string()
});

export const campaignMutationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(120),
  phone_number_id: z.string().trim().min(1).max(255),
  reject_template_name: z.string().trim().max(120).nullable(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  min_amount: z.coerce.number().finite().nonnegative().max(9_999_999_999.99),
  is_active: z.boolean()
}).superRefine((campaign, context) => {
  if (new Date(campaign.ends_at).getTime() <= new Date(campaign.starts_at).getTime()) {
    context.addIssue({ code: "custom", path: ["ends_at"], message: "Campaign end must be after its start" });
  }
});

export const metaMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), caption: z.string().optional() }).optional()
});

export const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string().optional() }).optional(),
        messages: z.array(metaMessageSchema).optional()
      })
    }))
  }))
});

export type Receipt = z.infer<typeof receiptSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignMutation = z.infer<typeof campaignMutationSchema>;
export type MetaMessage = z.infer<typeof metaMessageSchema>;
export type MetaWebhook = z.infer<typeof metaWebhookSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobTypeSchema = z.enum([
  "message.process",
  "receipt.extract",
  "whatsapp.send_template"
]);

export type JobType = z.infer<typeof jobTypeSchema>;
