import * as React from "react";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

/** An icon-only button: `label` is both its tooltip and its accessible name, so it never goes unnamed. */
export function IconButton({
  label, kbd, side, size = "icon-sm", variant = "ghost", ...props
}: React.ComponentProps<typeof Button> & { label: string; kbd?: string; side?: React.ComponentProps<typeof Tooltip>["side"] }) {
  return (
    <Tooltip label={label} kbd={kbd} side={side}>
      <Button size={size} variant={variant} aria-label={label} {...props} />
    </Tooltip>
  );
}
