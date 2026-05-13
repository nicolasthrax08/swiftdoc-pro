"use server";

import { sendTemplatedEmail } from "@/lib/postmark/send";

// Server action that handles a waitlist signup and sends a welcome email
// via Postmark.
//
// USAGE: Wire this from a form on a waitlist page. The form's `action`
// prop accepts a server action directly:
//
//   // src/app/waitlist/page.tsx
//   import { signUpForWaitlist } from "@/actions/waitlist";
//
//   export default function WaitlistPage() {
//     return (
//       <form action={signUpForWaitlist}>
//         <input name="email" type="email" required />
//         <button type="submit">Join waitlist</button>
//       </form>
//     );
//   }
//
// WHY A SERVER ACTION (not an API route): Next.js server actions are
// only callable from your own UI. The framework adds an origin check
// and a server-action-encoded payload format that makes naive curling
// from outside the app impractical. Combined with the email-format
// check below, this is much safer than shipping an unauthenticated
// POST endpoint into a customer repo.
//
// PRODUCTION CHECKLIST (do these before launch):
// - Add per-IP rate limiting (e.g. Upstash Redis) so a spammer can't
//   drain your Postmark sending quota or damage your sender reputation.
// - Persist the signup to a `waitlist` table in Supabase so you can
//   send launch announcements to everyone later.
// - Replace the placeholder template fields below with your real
//   product name, onboarding URL, and support address.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistSignupResult =
  | { ok: true }
  | { ok: false; error: string };

export async function signUpForWaitlist(
  formData: FormData,
): Promise<WaitlistSignupResult> {
  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string") {
    return { ok: false, error: "Email is required." };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  try {
    await sendTemplatedEmail({
      to: email,
      templateAlias: "welcome-email",
      templateModel: {
        product_name: "Your Product",
        first_name: email.split("@")[0],
        next_step: "We'll let you know the moment we're live.",
        cta_url: "https://your-product.example.com",
        cta_label: "Visit site",
        support_email: "support@your-product.example.com",
      },
    });
  } catch (error) {
    console.error("Waitlist signup email failed", error);
    return {
      ok: false,
      error: "We couldn't send your confirmation email. Please try again shortly.",
    };
  }

  return { ok: true };
}
