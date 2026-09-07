"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Brain, Trash2, Plus, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { UserMemory, UserMemoryCategory } from "@/ai/memory/types";
import {
  toggleMemoryAction,
  addMemoryAction,
  deleteMemoryAction,
  clearAllMemoriesAction,
} from "./memory-actions";

interface MemoryFormProps {
  initialEnabled: boolean;
  initialMemories: UserMemory[];
}

export function MemoryForm({ initialEnabled, initialMemories }: MemoryFormProps) {
  const t = useTranslations("settings.memory");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [memories, setMemories] = useState<UserMemory[]>(initialMemories);
  const [newContent, setNewContent] = useState("");
  const [category, setCategory] = useState<UserMemoryCategory>("preference");
  const [isPending, startTransition] = useTransition();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    startTransition(async () => {
      const res = await toggleMemoryAction(checked);
      if (res.ok) {
        toast.success(checked ? t("enabledToast") : t("disabledToast"));
      } else {
        setEnabled(!checked);
        toast.error(t("toggleFailed"));
      }
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newContent.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const res = await addMemoryAction(trimmed, category);
      if (res.ok && res.memory) {
        setMemories((prev) => [res.memory!, ...prev.filter((m) => m.id !== res.memory!.id)]);
        setNewContent("");
        toast.success(t("addedToast"));
      } else {
        toast.error(t("addFailed"));
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteMemoryAction(id);
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        toast.success(t("deletedToast"));
      } else {
        toast.error(t("deleteFailed"));
      }
    });
  };

  const handleClearAll = () => {
    startTransition(async () => {
      const res = await clearAllMemoriesAction();
      if (res.ok) {
        setMemories([]);
        setShowClearConfirm(false);
        toast.success(t("clearedToast"));
      } else {
        toast.error(t("clearFailed"));
      }
    });
  };

  const getCategoryBadgeVariant = (cat: UserMemoryCategory) => {
    switch (cat) {
      case "preference":
        return "accent";
      case "bio":
        return "success";
      case "project":
        return "neutral";
      case "constraint":
        return "warning";
      default:
        return "outline";
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Toggle Row */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            <span className="text-[14px] font-semibold text-foreground">{t("enabledLabel")}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-muted">{t("enabledDesc")}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
          aria-label={t("enabledLabel")}
        />
      </div>

      {enabled ? (
        <div className="flex flex-col gap-4">
          {/* Add Memory Input */}
          <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t("addPlaceholder")}
                className="h-9 pr-8 text-[13px]"
                disabled={isPending}
              />
              <Sparkles className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted/60" />
            </div>

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as UserMemoryCategory)}
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isPending}
            >
              <option value="preference">{t("categories.preference")}</option>
              <option value="bio">{t("categories.bio")}</option>
              <option value="project">{t("categories.project")}</option>
              <option value="constraint">{t("categories.constraint")}</option>
              <option value="general">{t("categories.general")}</option>
            </select>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isPending || !newContent.trim()}
              className="h-9 gap-1.5 shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("addBtn")}
            </Button>
          </form>

          {/* Memory List */}
          <div className="flex flex-col gap-2">
            {memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center">
                <Brain className="mb-2 h-7 w-7 text-muted/40" />
                <p className="text-[13px] font-medium text-foreground">{t("emptyTitle")}</p>
                <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
                  {t("emptyDesc")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border/50 rounded-xl border border-border/80 bg-card/30">
                {memories.map((mem) => (
                  <div
                    key={mem.id}
                    className="group flex items-center justify-between gap-3 p-3 transition-colors hover:bg-card/70"
                  >
                    <div className="flex flex-1 items-start gap-2.5 min-w-0">
                      <Badge variant={getCategoryBadgeVariant(mem.category)} className="mt-0.5 shrink-0 text-[10px]">
                        {t(`categories.${mem.category}`)}
                      </Badge>
                      <p className="text-[13px] leading-relaxed text-foreground break-words">{mem.content}</p>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(mem.id)}
                      disabled={isPending}
                      className="h-7 w-7 shrink-0 text-muted opacity-80 hover:text-destructive hover:opacity-100"
                      title={t("deleteBtn")}
                      aria-label={t("deleteBtn")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clear All Footer */}
          {memories.length > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                disabled={isPending}
                className="text-[12px] text-muted hover:text-destructive"
              >
                {t("clearAllBtn")}
              </Button>

              <ConfirmDialog
                open={showClearConfirm}
                onOpenChange={setShowClearConfirm}
                title={t("clearConfirmTitle")}
                description={t("clearConfirmDesc")}
                confirmLabel={t("clearConfirmBtn")}
                cancelLabel={t("cancelBtn")}
                tone="danger"
                onConfirm={handleClearAll}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-center">
          <p className="text-[12px] text-muted">{t("pausedNotice")}</p>
        </div>
      )}
    </div>
  );
}
