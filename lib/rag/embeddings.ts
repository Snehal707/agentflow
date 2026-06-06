import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const startedAt = Date.now();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  console.info('[RAG_EMBED]', {
    model: EMBEDDING_MODEL,
    token_count: response.usage?.total_tokens ?? estimateTokenCount(text),
    latency_ms: Date.now() - startedAt,
  });

  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += 100) {
    const batch = texts.slice(index, index + 100);
    const startedAt = Date.now();
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    console.info('[RAG_EMBED]', {
      model: EMBEDDING_MODEL,
      token_count:
        response.usage?.total_tokens ??
        batch.reduce((sum, text) => sum + estimateTokenCount(text), 0),
      latency_ms: Date.now() - startedAt,
      batch_count: batch.length,
    });

    embeddings.push(
      ...response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding),
    );
  }

  return embeddings;
}
