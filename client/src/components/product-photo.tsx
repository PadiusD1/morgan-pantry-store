import React, { useEffect, useState } from "react";
import { productLabel } from '@shared/product-identity';
import { PackageIcon } from "lucide-react";
/** A missing photograph is labelled, never replaced with a misleading look-alike. */
export function ProductPhoto({ item }: { item: { id: string; name: string; brand?: string | null; imageUrl?: string | null } }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  const valid = typeof item.imageUrl === "string" && /^\/api\/public\/inventory\/[a-f0-9-]+\/photo(?:\?|$)/i.test(item.imageUrl);
  return <figure className="mb-3" data-testid={`product-photo-${item.id}`}>
    <div className="flex h-36 items-center justify-center overflow-hidden rounded border bg-muted/20">
      {valid && !failed ? <img src={item.imageUrl!} alt={productLabel(item)} width={320} height={144} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 p-3 text-center text-xs text-muted-foreground"><PackageIcon aria-hidden="true" className="h-8 w-8" /><span>Product photo not yet available</span></div>}
    </div>
    {valid && !failed && <figcaption className="mt-1 text-xs text-muted-foreground"><a className="underline underline-offset-2" href={`/api/public/inventory/${encodeURIComponent(item.id)}/photo?attribution=1`} target="_blank" rel="noreferrer">Photo source and license<span className="sr-only"> for {item.name}, opens in a new tab</span></a></figcaption>}
  </figure>;
}
