import { Resend } from 'resend';

export async function sendDigestEmail(input: {
  to: string;
  subject: string;
  html: string;
  pdf: Buffer;
  pdfFilename: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    throw new Error('[resend] RESEND_API_KEY and RESEND_FROM_EMAIL are required');
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: [
      {
        filename: input.pdfFilename,
        content: input.pdf,
      },
    ],
  });

  if (error) {
    throw new Error(`[resend] send failed: ${JSON.stringify(error)}`);
  }
}
