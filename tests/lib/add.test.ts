import { add } from "@/lib/add";
import { describe, expect, test } from "vitest";

describe("add", () => {

  test("correctly adds two integers", () => {
    const result = add(2, 2);
    expect(result).toBe(4);
  });

  test("correctly adds two floats", () => {
    const result = add(1.5, 8.5);
    expect(result).toBe(10);
  });

});