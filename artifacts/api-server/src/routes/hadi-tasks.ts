import { Router, type IRouter } from "express";
import { generateText } from "../lib/ai-providers.js";
import { db } from "@workspace/db";
import { hadiTaskGroupsTable, hadiTaskItemsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

router.post("/hadi-tasks/extract", async (req, res) => {
  try {
    const { text, sessionId } = req.body as { text: string; sessionId: string };
    if (!text?.trim() || !sessionId) {
      res.status(400).json({ error: "text and sessionId are required" });
      return;
    }

    const raw = await generateText({
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content: `أنت مساعد يستخرج المهام القابلة للتنفيذ من النصائح الإسلامية.
استخرج الخطوات أو المهام من النص وأرجعها كـ JSON بهذا الشكل بالضبط:
{
  "title": "عنوان قصير للمجموعة (٣-٥ كلمات بالعربية)",
  "tasks": ["المهمة الأولى", "المهمة الثانية", ...]
}
- كل مهمة يجب أن تكون جملة فعلية واضحة قابلة للتنفيذ
- لا تضف أرقاماً أمام المهام
- لا تضف أي نص خارج الـ JSON
- أقصى عدد للمهام: ١٠`,
        },
        {
          role: "user",
          content: text.slice(0, 2000),
        },
      ],
    });

    let parsed: { title?: string; tasks?: string[] } = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const title = parsed.title?.trim() || "مهام هادي";
    const tasks = (parsed.tasks ?? []).filter((t): t is string => typeof t === "string" && t.trim().length > 0);

    if (tasks.length === 0) {
      res.status(422).json({ error: "لم أجد مهام قابلة للتنفيذ في هذا الرد" });
      return;
    }

    const [group] = await db
      .insert(hadiTaskGroupsTable)
      .values({ sessionId, title })
      .returning();

    const items = await db
      .insert(hadiTaskItemsTable)
      .values(tasks.map((t, idx) => ({
        groupId: group!.id,
        sessionId,
        title: t.trim(),
        orderIdx: idx,
      })))
      .returning();

    res.json({
      groupId: group!.id,
      title: group!.title,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        completed: item.completed,
        orderIdx: item.orderIdx,
      })),
    });
  } catch {
    console.error("Hadi tasks extraction failed");
    res.status(500).json({ error: "Failed to extract tasks" });
  }
});

router.get("/hadi-tasks", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

    const groups = await db
      .select()
      .from(hadiTaskGroupsTable)
      .where(eq(hadiTaskGroupsTable.sessionId, sessionId))
      .orderBy(desc(hadiTaskGroupsTable.createdAt));

    const allItems = await db
      .select()
      .from(hadiTaskItemsTable)
      .where(eq(hadiTaskItemsTable.sessionId, sessionId))
      .orderBy(hadiTaskItemsTable.orderIdx);

    const itemsByGroup: Record<number, typeof allItems> = {};
    for (const item of allItems) {
      if (!itemsByGroup[item.groupId]) itemsByGroup[item.groupId] = [];
      itemsByGroup[item.groupId]!.push(item);
    }

    res.json(groups.map((g) => ({
      id: g.id,
      title: g.title,
      createdAt: g.createdAt,
      items: (itemsByGroup[g.id] ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        completed: item.completed,
        completedAt: item.completedAt,
        orderIdx: item.orderIdx,
      })),
    })));
  } catch (err) {
    console.error("Hadi tasks list error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.patch("/hadi-tasks/items/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { sessionId, completed } = req.body as { sessionId: string; completed: boolean };
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

    const [updated] = await db
      .update(hadiTaskItemsTable)
      .set({
        completed,
        completedAt: completed ? new Date() : null,
      })
      .where(and(eq(hadiTaskItemsTable.id, id), eq(hadiTaskItemsTable.sessionId, sessionId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Item not found" }); return; }
    res.json({ id: updated.id, completed: updated.completed });
  } catch (err) {
    console.error("Hadi tasks toggle error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/hadi-tasks/groups/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { sessionId } = req.body as { sessionId: string };
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

    await db.delete(hadiTaskItemsTable).where(
      and(eq(hadiTaskItemsTable.groupId, id), eq(hadiTaskItemsTable.sessionId, sessionId))
    );
    await db.delete(hadiTaskGroupsTable).where(
      and(eq(hadiTaskGroupsTable.id, id), eq(hadiTaskGroupsTable.sessionId, sessionId))
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Hadi tasks delete error:", err);
    res.status(500).json({ error: "Failed to delete task group" });
  }
});

export default router;
