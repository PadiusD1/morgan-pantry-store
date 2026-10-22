import type { ProductIdentity } from '@shared/product-identity';

/** Keep a saved brand legible below the product name, including on small screens. */
export function ProductName({ item }: { item: Pick<ProductIdentity, 'name' | 'brand'> }) {
  return <span className="block min-w-0 [overflow-wrap:anywhere]">
    <span className="block">{item.name}</span>
    {item.brand?.trim() && <span className="block text-sm font-normal text-muted-foreground" data-testid="product-brand">{item.brand.trim()}</span>}
  </span>;
}
