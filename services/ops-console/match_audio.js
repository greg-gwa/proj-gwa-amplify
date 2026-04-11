const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@35.225.87.123/amplify' });

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
  const res = await pool.query(`
    SELECT ac.id, c.title as creative_title, ac.transcript, ac.audio_fingerprint 
    FROM ad_clips ac
    LEFT JOIN creatives c ON c.id = ac.creative_id
    WHERE ac.is_relevant=true 
    ORDER BY ac.created_at DESC 
  `);
  
  const clips = res.rows.filter(c => c.audio_fingerprint);
  console.log(`Analyzing ${clips.length} clips with audio fingerprints...\n`);
  
  const matches = [];
  const threshold = 0.85;

  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const c1 = clips[i];
      const c2 = clips[j];
      
      const score = audioSimilarity(c1.audio_fingerprint, c2.audio_fingerprint);
      
      if (score >= threshold) {
        matches.push({ 
          score, 
          c1: c1.id.substring(0,8), 
          c2: c2.id.substring(0,8),
          t1: c1.transcript ? c1.transcript.substring(0, 50).replace(/\n/g, ' ') : "",
          t2: c2.transcript ? c2.transcript.substring(0, 50).replace(/\n/g, ' ') : ""
        });
      }
    }
  }
  
  matches.sort((a, b) => b.score - a.score);
  
  console.log(`Found ${matches.length} pairs with > ${(threshold*100)}% acoustic similarity:\n`);
  
  matches.slice(0, 15).forEach(m => {
    console.log(`[${(m.score*100).toFixed(1)}%] Similarity`);
    console.log(`  Clip A (${m.c1}): ${m.t1}...`);
    console.log(`  Clip B (${m.c2}): ${m.t2}...`);
    console.log();
  });
  
  process.exit(0);
}
run();