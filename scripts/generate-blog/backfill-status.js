// One-time backfill: set status:'published' on every blog post that has no status.
//
// Why: the public home page now queries where('status','==','published'). Posts
// created before this feature have no `status` field and would silently disappear
// from the public site until they carry the field. This script adds it.
//
// Safe to run more than once (it only touches docs missing `status`).
//
// Run once, with the same secret as the generator:
//   cd scripts/generate-blog
//   FIREBASE_SERVICE_ACCOUNT="$(cat path/to/serviceAccount.json)" node backfill-status.js

import { initFirestore } from './generate.js';

async function backfill(db) {
  const snap = await db.collection('blogs').get();
  let updated = 0, skipped = 0;

  // Batch updates (Firestore caps batches at 500 ops).
  let batch = db.batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status === 'published' || data.status === 'pending') { skipped++; continue; }
    batch.update(doc.ref, { status: 'published' });
    updated++; inBatch++;
    if (inBatch === 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();

  console.log(`Backfill complete. Updated ${updated} post(s) to status:'published', skipped ${skipped} already-set.`);
}

backfill(initFirestore())
  .then(() => process.exit(0))
  .catch(err => { console.error('Backfill failed:', err); process.exit(1); });
