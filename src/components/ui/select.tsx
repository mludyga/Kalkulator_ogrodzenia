"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";

export function Select({ value, onValueChange, children }: any) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      {children}
    </SelectPrimitive.Root>
  );
}

export function SelectTrigger({ children }: any) {
  return (
    <SelectPrimitive.Trigger className="w-full h-10 inline-flex items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-400">
      {children}
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ children }: any) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="z-50 overflow-hidden rounded-md border bg-white shadow-md">
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ value, children }: any) {
  return (
    <SelectPrimitive.Item value={value} className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none hover:bg-slate-100">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectValue(props: any) {
  return <SelectPrimitive.Value {...props} />;
}
