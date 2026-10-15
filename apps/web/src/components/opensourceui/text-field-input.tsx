"use client";

// Adapted from bidyut10/opensourceui (MIT). See ./LICENSE and SOURCES.md.

import { forwardRef, useId, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export type TextFieldInputProps = Readonly<
  {
    label?: string;
    hint?: string;
    error?: boolean;
    errorMessage?: string;
    containerClassName?: string;
  } & Omit<ComponentPropsWithoutRef<"input">, "size">
>;

export const TextFieldInput = forwardRef<HTMLInputElement, TextFieldInputProps>(
  function TextFieldInput(
    {
      className,
      containerClassName,
      id,
      label,
      hint,
      error = false,
      errorMessage = "This field is required.",
      disabled,
      required,
      type = "text",
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;

    return (
      <div
        data-slot="text-field-input"
        data-error={error || undefined}
        className={cn("w-full font-sans", containerClassName)}
      >
        {label ? <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-ink"
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-rose-500" aria-hidden>
              *
            </span>
          ) : null}
        </label> : null}

        <input
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          required={required}
          aria-invalid={error || undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "h-8 w-full rounded-md border bg-surface px-2.5 font-sans text-sm text-ink ring-0 transition-[border-color,background-color] duration-200 outline-none placeholder:text-muted focus:ring-0 disabled:cursor-not-allowed disabled:bg-wash disabled:text-muted",
            error
              ? "border-rose-300 focus:border-rose-400"
              : "border-line focus:border-axis",
            className,
          )}
          {...props}
        />

        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-rose-600">
            {errorMessage}
          </p>
        ) : hint ? (
          <p id={hintId} className="mt-1.5 text-xs text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);

TextFieldInput.displayName = "TextFieldInput";
