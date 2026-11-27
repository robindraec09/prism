/**
 * A string enumeration that stays open: it accepts the `Known` values with
 * editor autocompletion, and any other string.
 *
 * The wire protocol keeps every enumerated string open (protocol.md §5.2
 * rule 3), so a newer driver or agent may send values this version of core has
 * never heard of. Types for values that core *receives* (roles, platforms,
 * error codes, reasons, capabilities) use `OpenString`, so code that switches
 * on them must handle the unknown case. Types for values that core *sends*
 * (for example `TypeMode`) are closed unions instead, so typos fail to compile.
 *
 * @typeParam Known - The values defined by the current protocol version.
 *
 * @example
 * ```ts
 * import type { OpenString } from '@prismtest/core';
 *
 * type Fruit = OpenString<'apple' | 'pear'>;
 * const a: Fruit = 'apple'; // autocompleted
 * const b: Fruit = 'kiwi'; // also allowed: a newer peer may send it
 * ```
 */
export type OpenString<Known extends string> = Known | (string & Record<never, never>);
