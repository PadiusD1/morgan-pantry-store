/**
 * How the shared pantry records stay in step across devices.
 *
 * The pantry runs on several screens at once: a laptop at the desk, a tablet at
 * the door, a phone in the storeroom. The application default is an infinite
 * stale time with no focus refetch and no interval, which is right for data only
 * this tab can change, and wrong for every record the pantry shares. A record
 * saved on one device never appeared on another until someone reloaded the page,
 * and invalidating a query key could never have fixed that, because an
 * invalidation only reaches the tab that did the saving.
 *
 * So every canonical directory read carries this instead. A tab that regains
 * focus refetches, which covers a staff member looking back at the other screen,
 * and a tab left open refetches on a timer so a screen nobody touched is not
 * quietly out of date. The timer does not run while the tab is hidden, so a
 * forgotten tab costs nothing.
 *
 * It is safe for an unsaved form because none of these reads feeds a form's
 * value. Forms hold their own state and follow their selection by canonical id,
 * and a failed refetch over already-loaded data leaves every page mounted
 * behind the retry notice rather than unmounting what someone was typing.
 */
export const SHARED_RECORD_FRESHNESS = {
  /** Long enough that moving between pages reuses what is loaded. */
  staleTime: 15_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnMount: true,
} as const;

/**
 * For a picker that is open while someone types into it. The list has to be
 * current the moment it is opened, so it is always refetched on mount, and it
 * keeps the same bounded timer so an open picker converges on a record another
 * device just created.
 */
export const OPEN_PICKER_FRESHNESS = {
  ...SHARED_RECORD_FRESHNESS,
  staleTime: 0,
} as const;
