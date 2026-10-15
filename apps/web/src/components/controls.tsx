"use client";

import { Check, Copy } from "lucide-react";
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { buttonClass, type Size, type Variant } from "./ui";
import { DepthOutlineButton } from "./opensourceui/depth-outline-button";
import { TextFieldInput } from "./opensourceui/text-field-input";

// The shared controls that keep state or take handlers (./ui has the rest).

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(function Button(
  { variant, size, className, type = "button", ...rest },
  ref,
) {
  return <DepthOutlineButton ref={ref} type={type} size={size} className={buttonClass(variant, size, className)} {...rest} />;
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <TextFieldInput ref={ref} label={undefined} containerClassName="contents" className={className} {...rest} />;
});

/** Copies `text`, and says so for a moment. */
export function CopyButton({ text, label = "Copy", className, variant = "secondary" }: { text: string; label?: string; className?: string; variant?: Variant }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {done ? "Copied" : label}
    </Button>
  );
}

/** Commands to run, with a copy button. */
export function Commands({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <pre className="overflow-x-auto rounded-lg border border-line bg-page px-3 py-2.5 pr-20 font-mono text-[12px] leading-5 text-ink">{code}</pre>
      <CopyButton text={code} className="absolute top-1.5 right-1.5" />
    </div>
  );
}
