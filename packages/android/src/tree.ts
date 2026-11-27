import type { UiNode } from './protocol.js';

/**
 * Visits every node in pre-order (document order, protocol.md §3.3).
 *
 * @example
 * ```ts
 * for (const node of walk(snapshot.root)) console.log(node.role);
 * ```
 */
export function* walk(root: UiNode): Generator<UiNode> {
  const stack: UiNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as UiNode;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * First node whose `testId` equals `testId`, or the part after `:id/` (protocol.md §3.1). Spike
 * helper only: the real locator engine is P0-04 in `@prismtest/core`.
 *
 * @example
 * ```ts
 * findByTestId(snapshot.root, 'sign_in'); // matches com.example.shop:id/sign_in
 * ```
 */
export function findByTestId(root: UiNode, testId: string): UiNode | undefined {
  for (const node of walk(root)) {
    if (node.webContent) continue;
    const id = node.testId;
    if (id === null) continue;
    if (id === testId || id.slice(id.indexOf(':id/') + 4) === testId) return node;
  }
  return undefined;
}

/**
 * Centre of a node's bounds in DIP.
 *
 * @example
 * ```ts
 * centerOf({ ...node, bounds: { x: 16, y: 500, width: 328, height: 48 } }); // { x: 180, y: 524 }
 * ```
 */
export function centerOf(node: UiNode): { x: number; y: number } {
  return { x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 };
}
