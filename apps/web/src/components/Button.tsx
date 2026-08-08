import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "sm";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: Props) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", className ?? ""]
    .filter((value) => value.length > 0)
    .join(" ");

  return <button type="button" className={classes} {...rest} />;
}
