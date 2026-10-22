import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MermaidRenderer } from "../mermaid-renderer";

// jsdom has no SVG layout engine. Stub the measuring APIs mermaid relies on so the
// real mermaid (and its DOMPurify sanitize step) runs end to end.
type SvgProto = Record<string, unknown>;
const svgProto = SVGElement.prototype as unknown as SvgProto;
const stubbed: Array<[string, unknown]> = [];

function stub(name: string, value: unknown) {
  stubbed.push([name, svgProto[name]]);
  svgProto[name] = value;
}

beforeAll(() => {
  stub("getBBox", () => ({ x: 0, y: 0, width: 80, height: 20 }));
  stub("getComputedTextLength", () => 80);
});

afterAll(() => {
  for (const [name, original] of stubbed.reverse()) {
    if (original === undefined) {
      delete svgProto[name];
    } else {
      svgProto[name] = original;
    }
  }
});

describe("MermaidRenderer", () => {
  it("renders a flowchart into an svg element with the real mermaid library", async () => {
    const { container } = render(<MermaidRenderer code={"flowchart LR\n  A-->B"} />);

    await waitFor(
      () => {
        expect(container.querySelector(".text-red-500")).toBeNull();
        // The expand button also contains an icon svg, so match mermaid's own svg id.
        expect(container.querySelector('svg[id^="mermaid-"]')).not.toBeNull();
      },
      { timeout: 10000 },
    );

    const diagram = container.querySelector('svg[id^="mermaid-"]');
    expect(container.querySelector(".text-red-500")).toBeNull();
    expect(diagram?.querySelectorAll(".node").length).toBe(2);
  }, 20000);
});
