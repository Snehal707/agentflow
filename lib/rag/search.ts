import { adminDb } from '../supabase';
import { answerProductQuestion } from '../product-rag';
import { generateEmbedding } from './embeddings';

export type RagSearchResult = {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

function normalizeRagResult(row: Record<string, unknown>): RagSearchResult {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    content: String(row.content ?? ''),
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
    similarity: Number(row.similarity ?? 0),
  };
}

export async function searchRag(
  query: string,
  options: { threshold?: number; limit?: number } = {},
): Promise<RagSearchResult[]> {
  try {
    const embedding = await generateEmbedding(query);
    const { data, error } = await adminDb.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: options.threshold ?? 0.7,
      match_count: options.limit ?? 5,
    });

    if (error) {
      throw error;
    }

    const results = ((data ?? []) as Record<string, unknown>[])
      .map(normalizeRagResult)
      .filter((result) => result.content.trim());

    if (results.length > 0) {
      console.info('[RAG_VECTOR_HIT]', {
        count: results.length,
        top_similarity: results[0].similarity,
      });
      return results;
    }

    console.info('[RAG_KEYWORD_FALLBACK]', {
      reason: 'no_vector_results',
      has_keyword_answer: Boolean(answerProductQuestion(query)),
    });
    return [];
  } catch (error) {
    console.warn('[RAG_KEYWORD_FALLBACK]', {
      reason: error instanceof Error ? error.message : String(error),
      has_keyword_answer: Boolean(answerProductQuestion(query)),
    });
    return [];
  }
}
