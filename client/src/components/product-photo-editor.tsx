import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { ProductPhoto } from "./product-photo";

async function resizePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000) throw new Error("Choose a JPEG, PNG or WebP photograph under 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize the photo.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encoding also removes camera location/EXIF metadata before upload.
    const result = canvas.toDataURL("image/jpeg", 0.78);
    if (result.length > 240_000) throw new Error("This photo is too detailed. Choose a smaller product photo.");
    return result;
  } finally { bitmap.close(); }
}
export function ProductPhotoEditor({ item }: { item: { id: string; name: string } }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  if (user?.role !== "admin" && user?.role !== "staff") return null;
  return <section className="space-y-2 rounded border p-3">
    <h3 className="text-sm font-medium">Student-facing product photo</h3>
    <ProductPhoto item={{ ...item, imageUrl: `/api/public/inventory/${item.id}/photo?v=${version}` }} />
    <label className="block text-sm">Upload the actual item or package<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="mt-2 block w-full text-sm" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      setBusy(true); setMessage("");
      try {
        const dataUrl = await resizePhoto(file);
        await apiRequest("PUT", `/api/inventory/${item.id}/photo`, { dataUrl, description: item.name });
        setVersion(Date.now());
        await client.invalidateQueries({ queryKey: ["/api/inventory"] });
        await client.invalidateQueries({ queryKey: ["/api/inventory/quality"] });
        setMessage("Photo saved. Students will see it when the catalogue refreshes.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Photo could not be saved."); }
      finally { setBusy(false); }
    }} /></label>
    <p className="text-xs text-muted-foreground">Product photos become public in the student catalogue. Do not upload people, IDs or paperwork. Photos are resized and camera metadata is removed before saving.</p>
    <p role="status" className="text-sm">{busy ? "Saving product photo…" : message}</p>
  </section>;
}
