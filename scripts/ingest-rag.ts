import '../lib/loadEnv';
import { PRODUCT_KNOWLEDGE } from '../lib/product-rag';
import { generateEmbeddings } from '../lib/rag/embeddings';
import { adminDb } from '../lib/supabase';

type RagDocumentRow = {
  id: string;
};

type ChunkMetadata = {
  doc_id: string;
  title: string;
  category: string;
  source: string;
  chunk_index: number;
  chunk_type: 'summary' | 'fact';
  keywords: string[];
};

async function upsertDocument(doc: { title: string }): Promise<string> {
  const payload = {
    title: doc.title,
    category: 'product',
    source: 'product-rag',
  };
  const existing = await adminDb
    .from('rag_documents')
    .select('id')
    .eq('title', payload.title)
    .eq('category', payload.category)
    .eq('source', payload.source)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data?.id) {
    const updated = await adminDb
      .from('rag_documents')
      .update(payload)
      .eq('id', existing.data.id);
    if (updated.error) {
      throw updated.error;
    }
    return String(existing.data.id);
  }

  const inserted = await adminDb
    .from('rag_documents')
    .insert(payload)
    .select('id')
    .single();
  if (inserted.error) {
    throw inserted.error;
  }
  return String((inserted.data as RagDocumentRow).id);
}

async function upsertChunk(chunk: {
  document_id: string;
  content: string;
  embedding: number[];
  metadata: ChunkMetadata;
}): Promise<void> {
  const existing = await adminDb
    .from('rag_chunks')
    .select('id')
    .eq('document_id', chunk.document_id)
    .eq('metadata->>chunk_index', String(chunk.metadata.chunk_index))
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const result = existing.data?.id
    ? await adminDb.from('rag_chunks').update(chunk).eq('id', existing.data.id)
    : await adminDb.from('rag_chunks').insert(chunk);

  if (result.error) {
    throw result.error;
  }
}

async function main(): Promise<void> {
  let totalChunks = 0;

  for (const doc of PRODUCT_KNOWLEDGE) {
    const documentId = await upsertDocument(doc);
    const chunks = [`${doc.title}\n\n${doc.summary}`, ...doc.facts];
    const embeddings = await generateEmbeddings(chunks);

    for (let index = 0; index < chunks.length; index += 1) {
      await upsertChunk({
        document_id: documentId,
        content: chunks[index],
        embedding: embeddings[index],
        metadata: {
          doc_id: doc.id,
          title: doc.title,
          category: 'product',
          source: 'product-rag',
          chunk_index: index,
          chunk_type: index === 0 ? 'summary' : 'fact',
          keywords: doc.keywords,
        },
      });
    }

    totalChunks += chunks.length;
    console.info('[RAG_INGEST]', {
      title: doc.title,
      chunk_count: chunks.length,
    });
  }

  console.info('[RAG_INGEST_DONE]', {
    document_count: PRODUCT_KNOWLEDGE.length,
    chunk_count: totalChunks,
  });
}

main().catch((error) => {
  console.error('[RAG_INGEST_FAILED]', error);
  process.exit(1);
});
