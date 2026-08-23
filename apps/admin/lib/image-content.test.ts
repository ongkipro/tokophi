import { describe, expect, it } from "vitest";
import { activeSvgConstruct, sniffImageKind } from "./image-content";

// Task 6.5 / SEC-17. The module is pure, so every branch is driven with a Buffer — no fs, no sharp,
// no server. What is NOT claimed here: that a rejected file could have executed. Execution is stopped
// by the serving header (`sandbox; default-src 'none'` in app/api/uploads/[name]/route.ts); this suite
// only proves what is allowed to be STORED.

const buf = (s: string) => Buffer.from(s, "utf8");
const png = () => Buffer.concat([Buffer.from([0x89]), buf("PNG\r\n\n"), Buffer.alloc(16)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const gif = () => Buffer.concat([buf("GIF89a"), Buffer.alloc(16)]);
const webp = () => Buffer.concat([buf("RIFF"), Buffer.alloc(4), buf("WEBP"), Buffer.alloc(16)]);

describe("sniffImageKind — the bytes, never the claim", () => {
  it("recognises the four raster formats by magic bytes", () => {
    expect(sniffImageKind(png())).toEqual({ kind: "raster", format: "png" });
    expect(sniffImageKind(jpeg())).toEqual({ kind: "raster", format: "jpeg" });
    expect(sniffImageKind(gif())).toEqual({ kind: "raster", format: "gif" });
    expect(sniffImageKind(webp())).toEqual({ kind: "raster", format: "webp" });
  });

  it("recognises an SVG behind the preamble a real exporter writes", () => {
    // BOM + prolog + DOCTYPE + comment + newlines, all before the root element. Inkscape and
    // Illustrator between them emit every one of these; a stricter test would reject real logos.
    const messy = "﻿<?xml version=\"1.0\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"x.dtd\">\n<!-- made by something -->\n\n<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>";
    expect(sniffImageKind(buf(messy))).toEqual({ kind: "svg" });
    expect(sniffImageKind(buf("<svg viewBox='0 0 1 1'></svg>"))).toEqual({ kind: "svg" });
  });

  it("refuses to guess: anything that is not provably an image is unknown", () => {
    // The shape the old code stored happily, because the CLIENT called it image/svg+xml.
    expect(sniffImageKind(buf("<html><body>hi</body></html>"))).toEqual({ kind: "unknown" });
    expect(sniffImageKind(buf("<?php system($_GET['c']); ?>"))).toEqual({ kind: "unknown" });
    expect(sniffImageKind(buf("GIF87"))).toEqual({ kind: "unknown" }); // truncated magic
    expect(sniffImageKind(Buffer.alloc(0))).toEqual({ kind: "unknown" });
    // `<svg` INSIDE a document that is not an SVG must not promote it.
    expect(sniffImageKind(buf("<html><svg></svg></html>"))).toEqual({ kind: "unknown" });
  });
});

describe("activeSvgConstruct — names the construct, so the refusal can be acted on", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["<svg><script>alert(1)</script></svg>", "<script>"],
    ["<svg>< script >alert(1)</script></svg>", "<script>"], // whitespace inside the tag
    ["<svg><foreignObject><b/></foreignObject></svg>", "<foreignObject>"],
    ["<svg><iframe src='x'/></svg>", "<iframe>/<embed>/<object>"],
    ["<svg onload=\"alert(1)\"><rect/></svg>", "an on… event handler"],
    // Whitespace AROUND the `=`, and a newline before the attribute — both still real handlers.
    // ⚠️ `on click='x'` is deliberately NOT here: that parses as an attribute `on` plus an attribute
    // `click`, neither of which executes. It was in this list once and the pattern correctly refused
    // to match it; the assertion was the thing that was wrong, not the code.
    ["<svg><rect onclick = \"alert(1)\"/></svg>", "an on… event handler"],
    ["<svg>\n<rect\n  onmouseover='alert(1)'/></svg>", "an on… event handler"],
    ["<svg><a href=\"javascript:alert(1)\"><rect/></a></svg>", "a javascript: URL"],
    ["<svg><image href='https://evil.example/p.png'/></svg>", "a remote reference"],
    ["<svg><use xlink:href='//evil.example/x#a'/></svg>", "a remote reference"],
    ["<svg><style>@import url('https://evil.example/x.css');</style></svg>", "a remote CSS import"],
    ["<svg><rect fill=\"url(https://evil.example/x)\"/></svg>", "a remote url() reference"],
  ];
  for (const [svg, name] of cases) {
    it(`refuses ${name} — ${svg.slice(0, 44)}…`, () => {
      expect(activeSvgConstruct(buf(svg))).toBe(name);
    });
  }

  it("passes an ordinary logo through, including the attributes that LOOK active", () => {
    // ⚠️ `font="…"` is the one that matters and it was MISSING from this fixture at first — which
    // made the `[\s<]` prefix on the handler pattern look like decoration under mutation (dropping
    // the prefix stayed green). It is not decoration: without it `on[a-z]+\s*=` matches the `ont=`
    // inside `font=`, so every logo carrying that presentation attribute would be refused as if it
    // held an event handler. `font-family=` does NOT match either way (the `[a-z]+` stops at the
    // hyphen), so only the bare form proves the point.
    const logo =
      "<svg xmlns='http://www.w3.org/2000/svg' version='1.1' viewBox='0 0 24 24'>" +
      "<g transform-origin='center' font-family='Inter'><text font=\"italic 12px Inter\">TokoΦ</text>" +
      "<path d='M1 1h22v22H1z' fill='#4f46e5'/>" +
      "<use href='#glyph'/></g></svg>"; // a LOCAL fragment reference is fine
    expect(activeSvgConstruct(buf(logo))).toBeNull();
  });
});
