import type { Express } from "express";
import { z } from "zod";
import { pool } from "./pg";
import { requireRole } from "./auth";
import { productPhotoSource } from "@shared/product-photo";
import { photoAttributionHtml } from "@shared/photo-attribution";

const MAX_IMAGE_BYTES = 180_000;
export function imageContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") return "image/webp";
  return null;
}
export function parsePhotoUpload(dataUrl: string): { bytes: Buffer; type: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Use a JPEG, PNG or WebP product photograph.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || imageContentType(bytes) !== match[1]) throw new Error("Photo is invalid or too large. Use a resized product photograph under 180 KB.");
  return { bytes, type: match[1] };
}

export function registerProductPhotoRoutes(app: Express) {
  app.put("/api/inventory/:id/photo", requireRole("admin", "staff"), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ dataUrl: z.string().max(250_000), description: z.string().trim().min(1).max(200) }).strict().safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: "A valid item and product photo are required." });
    try { parsePhotoUpload(body.data.dataUrl); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
    const photo = { ...body.data, source: "Staff-supplied product photo", reviewedAt: new Date().toISOString(), reviewedBy: req.user!.id };
    const { rowCount } = await pool.query(`UPDATE inventory_items SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('frcPhoto', $2::jsonb), updated_at = GREATEST(clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id = $1`, [id.data, JSON.stringify(photo)]);
    if (!rowCount) return res.status(404).json({ message: "Item not found." });
    return res.json({ saved: true, imageUrl: `/api/public/inventory/${id.data}/photo?v=${Date.now()}` });
  });
  app.get("/api/public/inventory/:id/photo", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).end();
    const { rows } = await pool.query("SELECT raw_payload FROM inventory_items WHERE id = $1", [id.data]);
    const photo = productPhotoSource(rows[0]?.raw_payload);
    if (!photo) return res.status(404).end();
    // Credits are fetched only when requested, not once per card render. The
    // public page exposes source/license links, never staff IDs or evidence.
    if (req.query.attribution === "1") {
      const page = photoAttributionHtml(rows[0]?.raw_payload);
      if (!page) return res.status(404).end();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.type("html").send(page);
    }
    try {
      let bytes: Uint8Array;
      if (photo.kind === "upload") bytes = parsePhotoUpload(photo.dataUrl).bytes;
      else {
        // Hostnames are an exact allowlist; no arbitrary URL proxy or redirects.
        const result = await fetch(photo.url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "Morgan-FRC-Product-Photos/1.0" } });
        if (!result.ok || Number(result.headers.get("content-length")) > 2_000_000 || !result.body) return res.status(404).end();
        const reader = result.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 2_000_000) throw new Error("Photo too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        bytes = Buffer.concat(chunks);
      }
      const type = imageContentType(bytes);
      if (!type) return res.status(404).end();
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.end(bytes);
    } catch { return res.status(404).end(); }
  });
}
