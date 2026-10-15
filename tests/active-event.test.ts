import {describe,expect,it} from "vitest";
import {ACTIVE_EVENT_STORAGE_KEY,readActiveEvent,setActiveEvent} from "../../client/src/lib/active-event";
const id="11111111-1111-4111-8111-111111111111";
describe("checkout event session",()=>{
 it("persists event across checkout and reload until explicitly cleared",()=>{
  const values=new Map<string,string>();
  const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}};
  setActiveEvent(storage,id);
  expect(readActiveEvent(storage)).toBe(id);
  expect(readActiveEvent(storage)).toBe(id);
  setActiveEvent(storage,null);
  expect(readActiveEvent(storage)).toBeNull();
  expect(values.has(ACTIVE_EVENT_STORAGE_KEY)).toBe(false);
 });
 it("rejects malformed IDs and treats corrupted storage as unassigned",()=>{
  expect(()=>setActiveEvent({setItem(){},removeItem(){}},"invalid")).toThrow();
  expect(readActiveEvent({getItem:()=>"<script>"})).toBeNull();
  expect(readActiveEvent({getItem(){throw new Error("storage unavailable")}})).toBeNull();
 });
});
