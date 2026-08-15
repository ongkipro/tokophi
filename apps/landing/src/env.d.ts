/// <reference types="astro/client" />

interface GSAPTimeline {
  from(target: unknown, vars: unknown): void;
  fromTo(target: unknown, fromVars: unknown, toVars: unknown): void;
}

interface GSAPMatchMedia {
  add(query: string, callback: () => void): void;
}

interface GSAPUtils {
  toArray<T>(targets: string | unknown): T[];
}

interface GSAPStatic {
  registerPlugin(...args: unknown[]): void;
  matchMedia(): GSAPMatchMedia;
  from(target: unknown, vars: unknown): void;
  fromTo(target: unknown, fromVars: unknown, toVars: unknown): void;
  utils: GSAPUtils;
}

declare module "gsap" {
  const gsap: GSAPStatic;
  export default gsap;
}

declare module "gsap/ScrollTrigger" {
  export const ScrollTrigger: unknown;
}
