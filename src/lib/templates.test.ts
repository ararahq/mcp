import { describe, expect, it } from "vitest";
import { hasDynamicUrlButton, templateButtonLabels } from "./templates.js";

const structure = {
  types: {
    "whatsapp/card": {
      body: "Oi {{1}}",
      actions: [
        { title: "Ver saldo", type: "URL", url: "https://ararahq.com/l/ULw0dv" },
        { title: "Falar", type: "QUICK_REPLY" },
      ],
    },
  },
};

describe("template structure helpers", () => {
  it("lists button labels in order", () => {
    expect(templateButtonLabels(structure)).toEqual(["Ver saldo", "Falar"]);
    expect(templateButtonLabels(null)).toEqual([]);
    expect(templateButtonLabels({ types: { x: { body: "b" } } })).toEqual([]);
  });

  it("detects dynamic URL buttons", () => {
    expect(hasDynamicUrlButton(structure)).toBe(false);
    expect(
      hasDynamicUrlButton({
        types: { "whatsapp/card": { actions: [{ type: "URL", url: "https://a.b/{{1}}" }] } },
      }),
    ).toBe(true);
  });
});
