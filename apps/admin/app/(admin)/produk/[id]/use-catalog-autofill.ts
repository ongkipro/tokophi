"use client";
import * as React from "react";
import { autoCatalogFill, isApparelPath } from "@tokophi/lib/taxonomy-suggest";

type Field = "gcat" | "gender" | "age";

/**
 * AUTO-FILL FROM THE GOOGLE CATALOGUE (owner 2026-11-05), extracted from product-editor.tsx (Task 6.6
 * size guard: extract, do not append). As the merchant types the title / category / description, the
 * Google category, gender and age group fill themselves (`autoCatalogFill`, pure + tested in
 * @tokophi/lib). A field is LOCKED once it had a value on load or the merchant touched it, and a locked
 * field is never overwritten. `auto` marks values the editor filled ("otomatis" tag), so nobody mistakes
 * a guess for a decision. Event-driven (called from the input handlers), not an effect: no render loop.
 * The editor keeps OWNING the four values (they are its submit fields); this hook only writes them.
 */
export function useCatalogAutoFill(s: {
  gcatId: number | null;
  gcatPath: string;
  gender: string;
  ageGroup: string;
  setGcatId: (v: number | null) => void;
  setGcatPath: (v: string) => void;
  setGender: (v: string) => void;
  setAgeGroup: (v: string) => void;
}) {
  const locked = React.useRef({ gcat: s.gcatId != null, gender: !!s.gender, age: !!s.ageGroup });
  const [auto, setAuto] = React.useState({ gcat: false, gender: false, age: false });

  const runAutoFill = (title: string, category: string, description: string) => {
    const patch = autoCatalogFill({ title, category, description, currentPath: s.gcatPath, locked: locked.current });
    if ("gcat" in patch) {
      s.setGcatId(patch.gcat?.id ?? null);
      s.setGcatPath(patch.gcat?.path ?? "");
    }
    if ("gender" in patch) s.setGender(patch.gender ?? "");
    if ("ageGroup" in patch) s.setAgeGroup(patch.ageGroup ?? "");
    setAuto((a) => ({
      gcat: "gcat" in patch ? !!patch.gcat : a.gcat,
      gender: "gender" in patch ? !!patch.gender : a.gender,
      age: "ageGroup" in patch ? !!patch.ageGroup : a.age,
    }));
  };

  const lock = (k: Field) => {
    locked.current = { ...locked.current, [k]: true };
    setAuto((a) => ({ ...a, [k]: false }));
  };

  const showApparel = isApparelPath(s.gcatPath) || !!s.gender || !!s.ageGroup;
  return { auto, runAutoFill, lock, showApparel };
}
