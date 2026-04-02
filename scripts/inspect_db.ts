
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspect() {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT id, title, type, wikipedia_id FROM nodes WHERE title ILIKE '%Moy%' OR title ILIKE '%Mow%'");
        console.log("Nodes found:");
        console.table(res.rows);
    } finally {
        client.release();
    }
    await pool.end();
}

inspect();
