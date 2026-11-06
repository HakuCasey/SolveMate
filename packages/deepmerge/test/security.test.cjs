const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRequire } = require("node:module");
const merge = require("../index.cjs");

test("the PWA build plugin actually resolves the patched dependency", () => {
  const pluginRequire = createRequire(
    require.resolve("@rollup/plugin-node-resolve"),
  );
  assert.equal(pluginRequire("deepmerge"), merge);
});

test("null placeholders cannot acquire an attacker-controlled prototype", () => {
  const payload = JSON.parse('{"session":{"__proto__":{"admin":true}}}');
  const result = merge({ session: null }, payload);
  assert.equal(result.session.admin, undefined);
  assert.equal(Object.getPrototypeOf(result.session), Object.prototype);
  assert.equal(Object.prototype.admin, undefined);
});

test("null-prototype targets and own dangerous target keys are rejected", () => {
  const payload = JSON.parse('{"__proto__":{"admin":true},"safe":1}');
  for (const target of [Object.create(null), payload]) {
    const result = merge(target, payload);
    assert.equal(result.admin, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, "__proto__"), false);
    assert.equal(result.safe, 1);
  }
});

test("nested constructor and prototype keys are excluded on both copy paths", () => {
  const payload = JSON.parse(
    '{"settings":{"constructor":{"prototype":{"admin":true}},"prototype":{"admin":true},"safe":1}}',
  );
  for (const result of [merge({}, payload), merge(payload, {})]) {
    assert.equal(Object.hasOwn(result.settings, "constructor"), false);
    assert.equal(Object.hasOwn(result.settings, "prototype"), false);
    assert.equal(result.settings.safe, 1);
  }
});

test("normal nested objects, symbols and concatenated arrays retain clone behavior", () => {
  const key = Symbol("option");
  const original = { nested: { keep: true }, list: [{ value: 1 }], [key]: 2 };
  const result = merge(original, { nested: { add: true }, list: [3] });
  assert.deepEqual(result.nested, { keep: true, add: true });
  assert.deepEqual(result.list, [{ value: 1 }, 3]);
  assert.equal(result[key], 2);
  result.list[0].value = 4;
  assert.equal(original.list[0].value, 1);
});

test("all, custom array merge and clone=false stay compatible", () => {
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
  assert.deepEqual(merge([1], [2], { arrayMerge: (_, source) => source }), [2]);
  const value = { x: 1 };
  assert.equal(merge({}, { value }, { clone: false }).value, value);
});
