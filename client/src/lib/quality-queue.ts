export type QualityFilter = 'incomplete' | 'weight' | 'value' | 'both' | 'photo' | 'all';
type ReviewRow = { id: string; name: string; barcode?: string | null; brand?: string | null; category?: string; missingWeight: boolean; missingValue: boolean; imageUrl: string | null };
export function qualityMatches(item: ReviewRow, filter: QualityFilter, search: string) {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [item.name, item.barcode, item.brand, item.category].filter(Boolean).join(' ').toLocaleLowerCase();
  const included = filter === 'all' || (filter === 'photo' ? !item.imageUrl : filter === 'incomplete' ? item.missingWeight || item.missingValue : filter === 'weight' ? item.missingWeight : filter === 'value' ? item.missingValue : item.missingWeight && item.missingValue);
  return included && words.every(word => text.includes(word));
}
export function nextReviewId<T extends ReviewRow>(before: T[], after: T[], savedId: string, filter: QualityFilter, search: string) {
  const current = after.find(item => item.id === savedId);
  if (current && qualityMatches(current, filter, search)) return savedId;
  const queue = before.filter(item => qualityMatches(item, filter, search));
  const index = queue.findIndex(item => item.id === savedId);
  const order = [...queue.slice(index + 1), ...queue.slice(0, Math.max(index, 0))];
  return order.find(item => after.some(row => row.id === item.id && qualityMatches(row, filter, search)))?.id ?? savedId;
}
