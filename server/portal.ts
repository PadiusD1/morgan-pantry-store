/**
 * Student portal — session-scoped endpoints under /api/portal/*.
 * The apiGuard restricts students to exactly these paths; identity always
 * comes from the session, never from the request body.
 */

import type { Express, Request } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  createFoodRequest,
  getRequestPayload,
  moveRequestStatus,
  RequestRateLimitError,
} from "./request-service";

const portalRequestSchema = z.object({
  reason: z.string().trim().min(1, "Tell us why you need assistance").max(2000),
  studentNote: z.string().trim().max(2000).nullish(),
  items: z
    .array(
      z.object({
        inventoryItemId: z.string().uuid(),
        itemName: z.string().trim().min(1).max(200),
        itemCategory: z.string().trim().max(120).nullish(),
        requestedQuantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, "Pick at least one item")
    .max(50),
});

/** All requests belonging to the session user (by account id or student ID). */
async function ownRequests(req: Request): Promise<any[]> {
  const user = req.user!;
  const byUser = await storage.getRequestsByUserId(user.id);
  const byIdentifier = user.studentId
    ? await storage.getRequestsByClientIdentifier(user.studentId)
    : [];
  const seen = new Set<string>();
  const merged = [...byUser, ...byIdentifier].filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return merged;
}

function ownsRequest(req: Request, request: any): boolean {
  const user = req.user!;
  return (
    (request.userId && request.userId === user.id) ||
    (user.studentId && request.clientIdentifier === user.studentId)
  );
}

export function registerPortalRoutes(app: Express): void {
  // Session summary for the portal header
  app.get("/api/portal/me/summary", async (req, res) => {
    const user = req.user!;
    const unreadNotifications = user.studentId
      ? await storage.getUnreadNotificationCount(user.studentId)
      : 0;
    res.json({ user, unreadNotifications });
  });

  // My requests, newest first, with items
  app.get("/api/portal/requests", async (req, res) => {
    const requests = await ownRequests(req);
    const withItems = await Promise.all(
      requests.map(async (r) => ({
        ...r,
        items: await storage.getRequestItems(r.id),
      })),
    );
    res.json(withItems);
  });

  // Submit a request — identity from the session
  app.post("/api/portal/requests", async (req, res) => {
    const user = req.user!;
    if (!user.studentId) {
      return res.status(400).json({
        message: "Your account has no student ID on file. Contact the FRC staff.",
      });
    }

    const parsed = portalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: parsed.error.errors[0]?.message ?? "Invalid request" });
    }

    // Link to the client roster record when one exists for this student ID
    let clientId: string | null = null;
    try {
      const client = await storage.getClientByIdentifier(user.studentId);
      clientId = client?.id ?? null;
    } catch {
      // roster link is best-effort
    }

    try {
      const payload = await createFoodRequest(
        {
          clientName: user.name,
          clientIdentifier: user.studentId,
          clientEmail: user.email,
          clientPhone: null,
          clientId,
          userId: user.id,
          reason: parsed.data.reason,
          studentNote: parsed.data.studentNote ?? null,
          items: parsed.data.items,
        },
        user.name,
      );
      res.status(201).json(payload);
    } catch (err) {
      if (err instanceof RequestRateLimitError) {
        return res.status(429).json({ message: err.message });
      }
      throw err;
    }
  });

  // Cancel my own pending request
  app.post("/api/portal/requests/:id/cancel", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request || !ownsRequest(req, request)) {
      return res.status(404).json({ message: "Request not found" });
    }
    if (!["pending", "under_review"].includes(request.status)) {
      return res.status(400).json({
        message: `Only pending requests can be cancelled (this one is '${request.status}')`,
      });
    }

    if (!(await moveRequestStatus(req.params.id, "cancelled", ["pending", "under_review"]))) {
      return res.status(409).json({ message: "This request was already changed" });
    }
    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "cancelled",
      actor: req.user!.name,
      details: "Cancelled by student",
      previousStatus: request.status,
      newStatus: "cancelled",
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // My notifications
  app.get("/api/portal/notifications", async (req, res) => {
    const user = req.user!;
    if (!user.studentId) return res.json([]);
    res.json(await storage.getNotifications(user.studentId));
  });

  app.post("/api/portal/notifications/:id/read", async (req, res) => {
    // Scope check: the notification must belong to this student
    const user = req.user!;
    if (user.studentId) {
      const own = await storage.getNotifications(user.studentId);
      if (!own.some((n: any) => n.id === req.params.id)) {
        return res.status(404).json({ message: "Notification not found" });
      }
    }
    await storage.markNotificationRead(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/portal/notifications/read-all", async (req, res) => {
    const user = req.user!;
    if (user.studentId) {
      await storage.markAllNotificationsRead(user.studentId);
    }
    res.json({ success: true });
  });
}
