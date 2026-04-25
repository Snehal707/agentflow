import OpenAI from 'openai';

/**
 * GPT-4o vision for invoice images. Uses OpenAI API (not Hermes).
 * Env: OPENAI_API_KEY
 */
export async function extractInvoiceFromImageUrl(imageUrl: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('[openai-vision] OPENAI_API_KEY is required');
  }

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Extract invoice fields as a single JSON object with keys: vendor, vendorEmail, amount (number), currency, dueDate (ISO date string), invoiceNumber, lineItems (array of {description?, amount?, quantity?}). Return JSON only, no markdown.',
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 2000,
  });

  return response.choices[0]?.message?.content ?? '';
}
