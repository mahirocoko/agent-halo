import type { ComponentPropsWithRef } from "react";

export interface ISurfaceStatusProps extends ComponentPropsWithRef<"span"> {
  tone: "success" | "info" | "warning" | "danger" | "neutral";
}

const SurfaceStatus = ({ className, tone, ...spanProps }: ISurfaceStatusProps) => (
  <span
    className={["surface-status", className].filter(Boolean).join(" ")}
    data-surface-status-tone={tone}
    {...spanProps}
  />
);

export { SurfaceStatus };
