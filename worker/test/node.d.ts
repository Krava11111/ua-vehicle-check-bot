declare module "node:test" {
  export default function test(name: string, fn: () => void | Promise<void>): void;
}
declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
    match(actual: string, expected: RegExp): void;
  };
  export default assert;
}
