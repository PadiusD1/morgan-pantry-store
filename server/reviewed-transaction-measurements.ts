import type {PoolClient} from 'pg';
import type {InsertTransactionItem} from '@shared/schema';

/** Call after the transaction's inventory locks. Old tabs cannot undo a review
 * through a new receipt. Explicit backdated evidence still needs the deliberate
 * historical correction workflow; a current price is not a past price. */
export async function reviewedTransactionMeasurements(
  client: Pick<PoolClient,'query'>,
  lines: InsertTransactionItem[],
  timestamp?: string | Date | null,
): Promise<InsertTransactionItem[]> {
  const {rows}=await client.query(`SELECT id, weight_per_unit_lbs, value_per_unit_usd,
    raw_payload->'frcMeasurementReview' AS review,
    raw_payload->'frcMeasurementHistory' AS history
    FROM inventory_items WHERE id=ANY($1::uuid[])`,[[...new Set(lines.map(line=>line.inventoryItemId))]]);
  const items=new Map(rows.map(row=>[row.id,row]));
  const eventTime=timestamp ? new Date(timestamp).getTime() : Date.now();
  return lines.map(line=>{
    const item=items.get(line.inventoryItemId.toLowerCase());
    if(!item) return line;
    const reviews=[...(Array.isArray(item.history)?item.history:[]),item.review]
      .filter(review=>review && Number.isFinite(Date.parse(review.at)))
      .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const result={...line};
    for(const [field,column] of [['weightPerUnitLbs','weight_per_unit_lbs'],['valuePerUnitUsd','value_per_unit_usd']] as const){
      const review=reviews.find(entry=>entry.changes?.[field]!==undefined);
      if(review && eventTime>=Date.parse(review.at) && Number(item[column])>0
        && Number(item[column])===Number(review.changes[field])) result[field]=String(item[column]);
    }
    return result;
  });
}
