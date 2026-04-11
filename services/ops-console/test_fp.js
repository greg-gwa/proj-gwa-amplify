const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@35.225.87.123/amplify' });

function bigramSimilarity(a, b) {
  function getBigrams(str) {
    const s = str.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  }
  const setA = getBigrams(a);
  const setB = getBigrams(b);
  let intersection = 0;
  for (let bg of setA) {
    if (setB.has(bg)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Compare audio fingerprints (bit array matching)
// Adapted from libchromaprint algorithm
function audioSimilarity(fp1, fp2) {
  if (!fp1 || !fp2) return 0;
  const a = fp1.split(',').map(Number);
  const b = fp2.split(',').map(Number);
  if (a.length === 0 || b.length === 0) return 0;
  
  let maxScore = 0;
  const minOverlap = Math.min(10, a.length, b.length);
  
  for (let offset = -a.length + minOverlap; offset < b.length - minOverlap; offset++) {
    let score = 0;
    let overlap = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + offset;
      if (j >= 0 && j < b.length) {
        overlap++;
        const xor = a[i] ^ b[j];
        // Count set bits (Brian Kernighan's way)
        let count = 0;
        let n = Math.abs(xor);
        while (n) {
          n &= (n - 1);
          count++;
        }
        score += (32 - count) / 32;
      }
    }
    if (overlap > 0) {
      maxScore = Math.max(maxScore, score / overlap);
    }
  }
  return maxScore;
}

async function run() {
  const res = await pool.query("SELECT id, advertiser, transcript, audio_fingerprint FROM ad_clips WHERE is_relevant=true ORDER BY created_at DESC LIMIT 100");
  const clips = res.rows.filter(c => c.transcript);
  console.log(`Analyzing ${clips.length} political ad clips...\n`);
  
  const clean = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  
  let exactCount = 0;
  let fuzzyCount = 0;
  let fuzzyPairs = [];
  let audioCount = 0;
  let audioPairs = [];

  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const c1 = clips[i];
      const c2 = clips[j];
      
      const t1 = clean(c1.transcript);
      const t2 = clean(c2.transcript);
      
      // 1. Current production logic: exact match of first 200 chars
      if (t1.substring(0, 200) === t2.substring(0, 200)) {
        exactCount++;
      }
      
      // 2. Fuzzy text (Bigram > 80%)
      const tScore = bigramSimilarity(t1, t2);
      if (tScore > 0.8) {
        fuzzyCount++;
        fuzzyPairs.push(`[${(tScore*100).toFixed(1)}%] ${c1.advertiser || 'Unknown'} / ${c2.advertiser || 'Unknown'}\n   ${c1.transcript.substring(0,60).replace(/\n/g,' ')}...\n   ${c2.transcript.substring(0,60).replace(/\n/g,' ')}...`);
      }
      
      // 3. Audio fingerprint (> 85%)
      const aScore = audioSimilarity(c1.audio_fingerprint, c2.audio_fingerprint);
      if (aScore > 0.85) {
        audioCount++;
        audioPairs.push(`[${(aScore*100).toFixed(1)}%] ${c1.id} / ${c2.id}`);
      }
    }
  }
  
  console.log('--- 1. EXACT HASH (First 200 chars - Production) ---');
  console.log(`Found ${exactCount} duplicate pairs\n`);
  
  console.log('--- 2. FUZZY TEXT (Bigram > 80% overlap) ---');
  console.log(`Found ${fuzzyCount} duplicate pairs`);
  if (fuzzyPairs.length > exactCount) {
    console.log("Fuzzy matching caught these extra duplicates:");
    fuzzyPairs.slice(0, 3).forEach(p => console.log(p));
  } else {
    console.log("Fuzzy didn't find anything the exact hash didn't catch.");
  }
  console.log('\n--- 3. AUDIO FINGERPRINT (Chromaprint > 85%) ---');
  console.log(`Found ${audioCount} duplicate pairs\n`);
  
  process.exit(0);
}
run();