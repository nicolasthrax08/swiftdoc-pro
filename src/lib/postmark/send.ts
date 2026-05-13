import { getPostmarkClient } from "./client";

export type StarterTemplateAlias = "welcome-email" | "broadcast-update";

const BROADCAST_TEMPLATE_ALIASES: ReadonlySet<StarterTemplateAlias> = new Set([
  "broadcast-update",
]);

function defaultMessageStreamForTemplate(alias: StarterTemplateAlias): string {
  if (BROADCAST_TEMPLATE_ALIASES.has(alias)) {
    // "broadcasts" is Postmark's default broadcast stream ID (plural).
    return process.env.POSTMARK_BROADCAST_MESSAGE_STREAM ?? "broadcasts";
  }
  return process.env.POSTMARK_MESSAGE_STREAM ?? "outbound";
}

export type TemplateModels = {
  "welcome-email": {
    product_name: string;
    first_name: string;
    next_step: string;
    cta_url: string;
    cta_label: string;
    support_email: string;
  };
  "broadcast-update": {
    product_name: string;
    headline: string;
    summary: string;
    cta_url: string;
    cta_label: string;
    unsubscribe_url: string;
    support_email: string;
  };
};

export type SendTemplatedEmailArgs<T extends StarterTemplateAlias> = {
  to: string;
  templateAlias: T;
  templateModel: TemplateModels[T];
  messageStream?: string;
  replyTo?: string;
};

export async function sendTemplatedEmail<T extends StarterTemplateAlias>(
  args: SendTemplatedEmailArgs<T>,
) {
  const client = getPostmarkClient();
  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!from) {
    throw new Error(
      "POSTMARK_FROM_EMAIL is not set. Assign a domain and verify DKIM in Email settings.",
    );
  }
  return client.sendEmailWithTemplate({
    From: from,
    To: args.to,
    TemplateAlias: args.templateAlias,
    TemplateModel: args.templateModel,
    MessageStream:
      args.messageStream ?? defaultMessageStreamForTemplate(args.templateAlias),
    ReplyTo: args.replyTo,
  });
}
