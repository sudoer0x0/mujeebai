"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Rename a conversation. Submits on Enter; refuses an empty title. */
export function RenameDialog({
  open,
  onOpenChange,
  initialTitle,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  onSubmit: (title: string) => void | Promise<void>;
}) {
  const tc = useTranslations("chat.conversation");
  const tCommon = useTranslations("common");
  const [title, setTitle] = React.useState(initialTitle);
  const id = React.useId();

  React.useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);

  const valid = title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tc("rename")}</DialogTitle>
          <DialogDescription>{tc("renameHint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="sr-only">
            {tc("rename")}
          </label>
          <Input
            id={id}
            autoFocus
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid) {
                event.preventDefault();
                void onSubmit(title.trim());
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button disabled={!valid} onClick={() => onSubmit(title.trim())}>
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
