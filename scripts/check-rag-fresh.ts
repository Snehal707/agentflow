import '../lib/loadEnv';
import { PRODUCT_KNOWLEDGE } from '../lib/product-rag';
import { adminDb } from '../lib/supabase';

// Mirror the exact chunk construction the ingest script uses.
function chunksFor(doc: (typeof PRODUCT_KNOWLEDGE)[number]): string[] {
  return [`${doc.title}\n\n${doc.summary}`, ...doc.facts];
}

async function main() {
  const expectedDocs = PRODUCT_KNOWLEDGE.length;
  const expectedChunks = PRODUCT_KNOWLEDGE.reduce((n, d) => n + chunksFor(d).length, 0);

  const { count: docCount } = await adminDb
    .from('rag_documents')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'product-rag');
  const { count: chunkCount } = await adminDb
    .from('rag_chunks')
    .select('*', { count: 'exact', head: true });

  console.log('=== counts ===');
  console.log(`docs   : source ${expectedDocs}  | db ${docCount}`);
  console.log(`chunks : source ${expectedChunks} | db ${chunkCount}`);

  // Pull all product-rag docs + their chunks for content comparison.
  const { data: docs } = await adminDb
    .from('rag_documents')
    .select('id, title')
    .eq('source', 'product-rag');
  const dbDocByTitle = new Map((docs ?? []).map((d) => [d.title as string, d.id as string]));

  const missingDocs: string[] = [];
  const drift: string[] = [];
  const staleExtra: string[] = [];

  for (const doc of PRODUCT_KNOWLEDGE) {
    const docId = dbDocByTitle.get(doc.title);
    if (!docId) {
      missingDocs.push(doc.title);
      continue;
    }
    const { data: rows } = await adminDb
      .from('rag_chunks')
      .select('content, metadata')
      .eq('document_id', docId);
    const byIndex = new Map<number, string>();
    for (const r of rows ?? []) {
      const idx = Number((r.metadata as any)?.chunk_index);
      if (Number.isFinite(idx)) byIndex.set(idx, (r.content as string) ?? '');
    }
    const expected = chunksFor(doc);
    for (let i = 0; i < expected.length; i++) {
      const got = byIndex.get(i);
      if (got === undefined) drift.push(`${doc.title} [chunk ${i}] MISSING in db`);
      else if (got.trim() !== expected[i].trim())
        drift.push(`${doc.title} [chunk ${i}] CONTENT DIFFERS`);
    }
    // chunks in db beyond what the source now defines = stale leftovers
    for (const idx of byIndex.keys()) {
      if (idx >= expected.length) staleExtra.push(`${doc.title} [chunk ${idx}] stale (source has ${expected.length})`);
    }
  }

  // docs present in db but no longer in source
  const sourceTitles = new Set(PRODUCT_KNOWLEDGE.map((d) => d.title));
  const orphanDocs = (docs ?? []).map((d) => d.title as string).filter((t) => !sourceTitles.has(t));

  console.log('\n=== drift report ===');
  console.log(`missing docs (in source, not db): ${missingDocs.length}`);
  missingDocs.forEach((t) => console.log('  - ' + t));
  console.log(`content drift (chunk text changed/missing): ${drift.length}`);
  drift.slice(0, 40).forEach((t) => console.log('  - ' + t));
  console.log(`stale extra chunks (db has more than source): ${staleExtra.length}`);
  staleExtra.slice(0, 40).forEach((t) => console.log('  - ' + t));
  console.log(`orphan docs (in db, not in source): ${orphanDocs.length}`);
  orphanDocs.forEach((t) => console.log('  - ' + t));

  const upToDate =
    docCount === expectedDocs &&
    chunkCount === expectedChunks &&
    missingDocs.length === 0 &&
    drift.length === 0 &&
    staleExtra.length === 0 &&
    orphanDocs.length === 0;
  console.log(`\n=== VERDICT: ${upToDate ? 'UP TO DATE' : 'STALE — re-ingest needed'} ===`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
