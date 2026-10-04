import { test, expect } from "@playwright/test";
import { defaultAppearance, normalizeAppearance, type Appearance } from "../src/appearance";

test("old notebooks receive safe appearance defaults", () => {
  expect(normalizeAppearance()).toEqual(defaultAppearance);
  expect(normalizeAppearance(null)).toEqual(defaultAppearance);
  expect(normalizeAppearance({ font: "caveat" })).toEqual({ ...defaultAppearance, font: "caveat" });
});

test("invalid appearance values cannot inject styles or break layout", () => {
  expect(normalizeAppearance({ elementSize: "huge", font: 'serif; color: red', textScale: NaN } as unknown as Appearance)).toEqual(defaultAppearance);
  expect(normalizeAppearance({ textScale: Infinity })).toEqual(defaultAppearance);
  expect(normalizeAppearance({ textScale: "120" } as unknown as Appearance)).toEqual(defaultAppearance);
  expect(normalizeAppearance({ textScale: -40 }).textScale).toBe(80);
  expect(normalizeAppearance({ textScale: 900 }).textScale).toBe(150);
});

test("valid independent preferences survive normalization without changing input", () => {
  const value: Appearance = { elementSize: "small", textScale: 125, font: "roboto-light" };
  const original = { ...value };
  expect(normalizeAppearance(value)).toEqual(value);
  expect(value).toEqual(original);
});
