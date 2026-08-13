// Tab groups: stacking the tabs of one subject together (13 Ağu 2026).
//
// The screen is not split and nothing new is invented — a group is a stack of
// tabs the reader made, with a name and a closed/open state. The whole of it is
// two facts: a tab carries `groupId`, and the app keeps a list of groups.
//
// The rule everything else rests on: **a group's tabs are next to each other**.
// The strip draws runs, not lookups, so a group scattered across the row would
// have to be drawn in several places — with the same name, several times — and
// the reader would be told a group is one thing while seeing three. Every move
// below therefore returns the slot that keeps the run whole, and `gather`
// repairs an order that arrived broken (an older session, a hand-edited file).
//
// Pure on purpose: no DOM, no Tauri. A tab here is anything with a `groupId`
// (`test/gruplar.test.mjs` uses plain objects).

/**
 * The row as it is drawn: consecutive tabs that share a group are one run,
 * every ungrouped tab is a run of its own.
 *
 * `to` is exclusive, like a slice.
 */
export function runsOf(tabs) {
  const runs = [];
  tabs.forEach((tab, index) => {
    const last = runs[runs.length - 1];
    if (tab.groupId && last?.groupId === tab.groupId) {
      last.to = index + 1;
      return;
    }
    runs.push({ groupId: tab.groupId ?? null, from: index, to: index + 1 });
  });
  return runs;
}

/**
 * Where a tab dropped onto another one lands: immediately after its target.
 *
 * The index is counted in the row the tab has already left, which is what the
 * caller's splice sees — dragging rightwards therefore lands one slot lower
 * than the target's own index.
 */
export function slotAfter(from, target) {
  return from < target ? target : target + 1;
}

/**
 * Where a tab lands when it leaves its group: just past the group's last
 * remaining member, so the run it is stepping out of stays whole.
 */
export function slotForLeaving(tabs, from) {
  const groupId = tabs[from]?.groupId;
  if (!groupId) return from;

  const rest = tabs.filter((_, index) => index !== from);
  let last = -1;
  rest.forEach((tab, index) => {
    if (tab.groupId === groupId) last = index;
  });
  // The last one out: nothing left to stand behind, so it stays where it is.
  return last === -1 ? Math.min(from, rest.length) : last + 1;
}

/**
 * Puts a broken order right: every group's tabs are pulled together at the
 * position of its first member, and the rest keep the order they had.
 *
 * Runs on session restore, where the order comes off disk and the invariant is
 * a promise nobody checked.
 */
export function gather(tabs) {
  const out = [];
  const done = new Set();
  for (const tab of tabs) {
    if (!tab.groupId) {
      out.push(tab);
      continue;
    }
    if (done.has(tab.groupId)) continue;
    done.add(tab.groupId);
    for (const each of tabs) if (each.groupId === tab.groupId) out.push(each);
  }
  return out;
}

/**
 * The groups that still have a tab in them. A group is its tabs: the last one
 * leaving — closed, or dragged out — takes the group with it, so no empty name
 * is left on the strip for the reader to wonder about.
 */
export const liveGroups = (tabs, groups) =>
  groups.filter((group) => tabs.some((tab) => tab.groupId === group.id));

/**
 * A new group's name: the document it was made from. Named, not "Grup 1" — the
 * reader dropped one tab onto another, and the one already standing there is
 * what the pile is about. It can be renamed; it starts by telling the truth.
 */
export const nameFromTab = (tab) => tab?.title ?? "";
