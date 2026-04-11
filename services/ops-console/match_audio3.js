const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@35.225.87.123/amplify' });

function bigramSimilarity(a, b) {
  function getBigrams(str) {
    const s = str.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
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

async function run() {
  const res = await pool.query(`
    SELECT ac.id, c.title as creative_title, ac.transcript
    FROM ad_clips ac 
    LEFT JOIN creatives c ON c.id = ac.creative_id 
    WHERE ac.is_relevant=true 
    ORDER BY ac.created_at DESC
  `);
  
  const clips = res.rows;
  
  const thresholds = [0.80, 0.70, 0.60, 0.50, 0.45, 0.40];
  const results = {};
  
  console.log(`Total clips: ${clips.length}\n`);
  
  for (const t of thresholds) {
    let clusters = [];
    for (const clip of clips) {
      const text = (clip.transcript||'').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      let matched = false;
      for (const c of clusters) {
        if (bigramSimilarity(text, c.headText) > t) {
          c.members.push(clip);
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({ headText: text, members: [clip] });
      }
    }
    results[t] = clusters.length;
    console.log(`> ${t*100}% overlap: ${clusters.length} unique clusters left`);
    
    // Dump an example of what 50% overlap looks like
    if (t === 0.50) {
      const largest = clusters.sort((a,b) => b.members.length - a.members.length)[0];
      if (largest && largest.members.length > 1) {
        console.log(`\nExample 50% match cluster (${largest.members.length} members):`);
        console.log(`Head: ${largest.headText.substring(0, 80)}...`);
        console.log(`Mem:  ${largest.members[1].transcript.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().substring(0, 80)}...\n`);
      }
    }
  }
  
  process.exit(0);
}
run();