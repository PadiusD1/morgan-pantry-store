import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../server/pg', () => ({ pool: { connect: mocks.connect } }));
import { syncRosterClient } from '../server/client-roster';
const student = { name:'Synthetic Student',identifier:'ROSTER123',clientType:'student' };
beforeEach(()=>{vi.clearAllMocks();});
describe('best-effort roster synchronization after account creation',()=>{
  it('returns failed when the pool cannot provide a connection instead of rejecting a successful signup',async()=>{
    mocks.connect.mockRejectedValueOnce(new Error('Synthetic pool timeout'));
    await expect(syncRosterClient(student)).resolves.toBe('failed');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
  it('releases an acquired connection even when BEGIN and cleanup both fail',async()=>{
    const query=vi.fn().mockRejectedValue(new Error('Synthetic disconnected socket'));
    const release=vi.fn(); mocks.connect.mockResolvedValueOnce({query,release});
    await expect(syncRosterClient(student)).resolves.toBe('failed');
    expect(query.mock.calls.map(args=>args[0])).toEqual(['BEGIN','ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
