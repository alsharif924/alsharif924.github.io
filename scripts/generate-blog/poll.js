// Manual-trigger poller — runs on a short GitHub Actions cron (every ~5 min).
//
// The static dashboard can't securely hold the AI key, so "Generate now" and
// "Regenerate" write a request doc to the admin-only `generationRequests`
// collection. This poller picks up unprocessed requests via the Admin SDK and
// runs the same generation logic, then marks them processed.

import admin from 'firebase-admin';
import { initFirestore, generateAndStore } from './generate.js';

const MAX_PER_RUN = 5; // cap work per tick so a backlog can't run away

async function processRequests(db) {
  const snap = await db
    .collection('generationRequests')
    .where('processed', '==', false)
    .orderBy('createdAt', 'asc')
    .limit(MAX_PER_RUN)
    .get();

  if (snap.empty) {
    console.log('No pending generation requests.');
    return;
  }

  console.log(`Processing ${snap.size} generation request(s).`);
  for (const reqDoc of snap.docs) {
    const req = reqDoc.data();
    try {
      // 'regenerate' deletes the rejected draft first, then generates fresh.
      if (req.action === 'regenerate' && req.docId) {
        await db.collection('blogs').doc(req.docId).delete().catch(() => {});
      }
      const result = await generateAndStore(db);
      await reqDoc.ref.update({
        processed: true,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: result.skipped ? `skipped: ${result.reason || ''}` : `created ${result.id || ''}`,
      });
    } catch (err) {
      console.error(`Request ${reqDoc.id} failed:`, err);
      await reqDoc.ref.update({
        processed: true,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: `error: ${err.message || 'unknown'}`,
      });
    }
  }
}

processRequests(initFirestore())
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Poller failed:', err);
    process.exit(1);
  });
