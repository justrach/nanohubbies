// From Rare UI (MIT License), commit f64e583, Copyright (c) 2026 Swami Malode.
// The license text is in components/rare/LICENSE.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
