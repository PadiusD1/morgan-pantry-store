import React, { useEffect, useState } from "react";
import { PackageIcon } from "lucide-react";
/** A missing photograph is labelled, never replaced with a misleading look-alike. */
export function ProductPhoto({ item }: { item: { id: string; name: string; imageUrl?: string | null } }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  const valid = typeof item.imageUrl === "string" && /^\/api\/public\/inventory\/[a-f0-9-]+\/photo(?:\?|$)/i.test(item.imageUrl);
  return <div className="mb-3 flex h-36 items-center justify-center overflow-hidden rounded border bg-muted/20" data-testid={`product-photo-${item.id}`}>
    {valid && !failed ? <img src={item.imageUrl!} alt={item.name} width={320} height={144} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 p-3 text-center text-xs text-muted-foreground"><PackageIcon aria-hidden="true" className="h-8 w-8" /><span>Product photo not yet available</span></div>}
  </div>;
}
