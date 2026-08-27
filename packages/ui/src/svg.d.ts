/**
 * SVGs are transformed into React components by SVGR, configured in the
 * consuming app's next.config.ts. This package ships source, not a build, so
 * the transform applies at the app's compile step.
 */
declare module "*.svg" {
  import type { FC, SVGProps } from "react";
  const content: FC<SVGProps<SVGSVGElement>>;
  export default content;
}
