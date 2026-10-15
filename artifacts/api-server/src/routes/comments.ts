import { Router } from "express";
import { db } from "@workspace/db";
import { commentsTable } from "@workspace/db";
import { CreateMatchCommentBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/matches/:matchId/comments", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const comments = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.matchId, matchId));
  return res.json(
    comments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }))
  );
});

router.post("/matches/:matchId/comments", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  if (isNaN(matchId)) return res.status(400).json({ error: "Invalid id" });
  const parsed = CreateMatchCommentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [comment] = await db
    .insert(commentsTable)
    .values({ ...parsed.data, matchId })
    .returning();
  return res.status(201).json({
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  });
});

router.delete("/comments/:commentId", async (req, res) => {
  const commentId = parseInt(req.params.commentId);
  if (isNaN(commentId)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(commentsTable).where(eq(commentsTable.id, commentId));
  return res.status(204).send();
});

export default router;
