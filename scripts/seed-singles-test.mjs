import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const now = new Date();
  const weeksAgo = (w) => new Date(now - w * 7 * 24 * 60 * 60 * 1000).toISOString();

  // Insert 4 players into Singles Test league (ID = 5)
  const playerRows = await client.query(`
    INSERT INTO players (name, email, skill_level, league_id, wins, losses)
    VALUES
      ('Marcus Silva',   'marcus.silva@example.com',   'intermediate', 5, 0, 0),
      ('Sophie Laurent', 'sophie.laurent@example.com', 'intermediate', 5, 0, 0),
      ('Diego Ramirez',  'diego.ramirez@example.com',  'intermediate', 5, 0, 0),
      ('Priya Patel',    'priya.patel@example.com',    'beginner',     5, 0, 0)
    RETURNING id, name
  `);

  const [marcus, sophie, diego, priya] = playerRows.rows;
  console.log("Inserted players:", playerRows.rows.map(r => `${r.name} (id=${r.id})`).join(", "));

  // Insert 6 completed round-robin matches
  const matches = [
    { p1: marcus, p2: sophie, winner: marcus, score: "6-4, 7-5",      completedAt: weeksAgo(8) },
    { p1: marcus, p2: diego,  winner: marcus, score: "3-6, 6-3, 6-4", completedAt: weeksAgo(6) },
    { p1: marcus, p2: priya,  winner: marcus, score: "6-2, 6-1",      completedAt: weeksAgo(4) },
    { p1: sophie, p2: diego,  winner: sophie, score: "6-7, 7-5, 6-4", completedAt: weeksAgo(7) },
    { p1: sophie, p2: priya,  winner: sophie, score: "6-3, 6-4",      completedAt: weeksAgo(3) },
    { p1: diego,  p2: priya,  winner: diego,  score: "7-6, 4-6, 6-3", completedAt: weeksAgo(5) },
  ];

  for (const m of matches) {
    await client.query(`
      INSERT INTO matches (league_id, player1_id, player2_id, winner_id, status, score, completed_at)
      VALUES ($1, $2, $3, $4, 'completed', $5, $6)
    `, [5, m.p1.id, m.p2.id, m.winner.id, m.score, m.completedAt]);
    console.log(`  Match: ${m.p1.name} vs ${m.p2.name} → ${m.winner.name} wins (${m.score})`);
  }

  // Update wins/losses: Marcus 3-0, Sophie 2-1, Diego 1-2, Priya 0-3
  const records = [
    { id: marcus.id, wins: 3, losses: 0 },
    { id: sophie.id, wins: 2, losses: 1 },
    { id: diego.id,  wins: 1, losses: 2 },
    { id: priya.id,  wins: 0, losses: 3 },
  ];

  for (const r of records) {
    await client.query(
      `UPDATE players SET wins = $1, losses = $2 WHERE id = $3`,
      [r.wins, r.losses, r.id]
    );
  }

  console.log("\nWins/losses updated.");
  console.log("Done! Singles Test league seeded successfully.");
} finally {
  await client.end();
}
