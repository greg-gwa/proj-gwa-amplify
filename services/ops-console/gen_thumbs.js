const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const pool = new Pool({ connectionString: 'postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@35.225.87.123/amplify' });
const storage = new Storage();
const bucket = storage.bucket('amplify-raw-emails');

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT id, video_storage_path 
      FROM ad_clips 
      WHERE thumbnail_storage_path IS NULL 
        AND video_storage_path IS NOT NULL
        AND video_storage_path LIKE 'gs://amplify-raw-emails/%'
    `);
    
    console.log(`Found ${rows.length} clips needing thumbnails`);
    
    for (const row of rows) {
      console.log(`Processing ${row.id}...`);
      try {
        const objectPath = row.video_storage_path.replace('gs://amplify-raw-emails/', '');
        const file = bucket.file(objectPath);
        
        // 1. Download video
        const tempVideo = path.join('/tmp', `${row.id}.mp4`);
        await file.download({ destination: tempVideo });
        
        // 2. Extract thumbnail
        const tempThumb = path.join('/tmp', `${row.id}_thumb.jpg`);
        execSync(`ffmpeg -y -i ${tempVideo} -ss 1 -frames:v 1 -q:v 2 ${tempThumb}`, { stdio: 'ignore' });
        
        // 3. Upload thumbnail
        const thumbObjectPath = objectPath.replace('.mp4', '_thumb.jpg');
        await bucket.upload(tempThumb, { destination: thumbObjectPath });
        
        // 4. Update DB
        const thumbGsPath = `gs://amplify-raw-emails/${thumbObjectPath}`;
        await pool.query('UPDATE ad_clips SET thumbnail_storage_path = $1 WHERE id = $2', [thumbGsPath, row.id]);
        
        console.log(`  Done -> ${thumbGsPath}`);
        
        // Cleanup
        if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
        if (fs.existsSync(tempThumb)) fs.unlinkSync(tempThumb);
      } catch (err) {
        console.error(`  Failed on ${row.id}:`, err.message);
      }
    }
    
    console.log('Finished');
    process.exit(0);
  } catch (e) {
    console.error('Fatal:', e);
    process.exit(1);
  }
}

run();