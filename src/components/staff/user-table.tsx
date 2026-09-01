"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GrantPlanDialog } from "@/components/staff/grant-plan-dialog";
import { resetModeratorAccountAction } from "@/admin/moderator-actions";
import { MoreHorizontal, ShieldOff, ShieldCheck, Trash2, KeyRound, Mail, MailCheck, UserCog, Gauge, Eye, Gift, RotateCcw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableScroll } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReasonDialog } from "@/components/staff/reason-dialog";
import { toast } from "@/components/ui/toast";
import type { StaffUserRow } from "@/admin/users";
import {
  suspendUserAction,
  restoreUserAction,
  disableUserAction,
  deleteUserAction,
  sendPasswordResetAction,
  sendMagicLinkAction,
  sendVerificationAction,
  modifyUserRoleAction,
  resetUserUsageAction,
  type ActionResponse,
} from "@/admin/user-actions";

type Capability =
  | "suspend"
  | "restore"
  | "disable"
  | "delete"
  | "reset_password"
  | "magic_link"
  | "verification"
  | "modify_role"
  | "reset_usage"
  | "grant_plan"
  | "reset_staff"
  | "view_detail";

/**
 * The account table for both staff portals.
 *
 * `capabilities` controls what this component *offers*; it is derived
 * server-side from the permission matrix and passed in. It is presentation
 * only — every action re-checks the same matrix on the server, so a
 * moderator who forges a request to `deleteUserAction` is still refused.
 */
export function UserTable({
  users,
  capabilities,
  currentUserId,
  detailBasePath,
  emptyTitle,
  emptyHint,
}: {
  users: StaffUserRow[];
  capabilities: Capability[];
  currentUserId: string;
  detailBasePath?: string;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const t = useTranslations("admin");
  const tm = useTranslations("moderator");
  const [pending, setPending] = React.useState<string | null>(null);
  const [grantTarget, setGrantTarget] = React.useState<{ id: string; label: string } | null>(null);
  const [dialog, setDialog] = React.useState<
    | { kind: "suspend" | "disable"; user: StaffUserRow }
    | { kind: "delete" | "role"; user: StaffUserRow }
    | null
  >(null);

  const has = (capability: Capability) => capabilities.includes(capability);

  async function run(id: string, action: () => Promise<ActionResponse>) {
    setPending(id);
    try {
      const result = await action();
      if (result.ok) {
        toast.success(result.message ? t(result.message.replace(/^admin\./, "") as never) : t("common.save"));
      } else {
        toast.error(resolveMessage(result.message));
      }
    } catch {
      toast.error(t("common.actionFailed"));
    } finally {
      setPending(null);
    }
  }

  // Action results carry a fully-qualified catalog key so the server can
  // reuse the same string in either portal; resolve it against whichever
  // namespace it belongs to.
  function resolveMessage(key: string | undefined): string {
    if (!key) return t("common.actionFailed");
    if (key.startsWith("admin.")) return t(key.slice("admin.".length) as never);
    if (key.startsWith("moderator.")) return tm(key.slice("moderator.".length) as never);
    return t("common.actionFailed");
  }

  return (
    <>
      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>{t("users.colUser")}</TH>
              <TH>{t("users.colRole")}</TH>
              <TH>{t("users.colStatus")}</TH>
              <TH>{t("users.colJoined")}</TH>
              <TH className="w-10">
                <span className="sr-only">{t("users.colActions")}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {users.length === 0 ? (
              <TableEmpty colSpan={5}>
                <p className="font-medium text-foreground">{emptyTitle}</p>
                {emptyHint ? <p className="mt-1">{emptyHint}</p> : null}
              </TableEmpty>
            ) : null}

            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const name = user.displayName || user.email || user.id;

              return (
                <TR key={user.id}>
                  <TD>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">
                        {user.displayName ?? "—"}
                        {isSelf ? <span className="ms-1.5 text-[11px] text-faint">({t("users.you")})</span> : null}
                      </span>
                      <span className="truncate text-[12px] text-muted">{user.email ?? "—"}</span>
                    </div>
                  </TD>
                  <TD>
                    <Badge variant={user.role === "super_admin" ? "accent" : user.role === "moderator" ? "warning" : "neutral"}>
                      {t(`role.${user.role}` as never)}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 text-[12px]">
                      <StatusDot variant={statusTone(user.status)} />
                      {t(`status_.${user.status}` as never)}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-[12px] text-muted tabular-nums">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TD>
                  <TD className="text-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending === user.id}
                          aria-label={t("users.actions", { name })}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{name}</DropdownMenuLabel>

                        {has("view_detail") && detailBasePath ? (
                          <DropdownMenuItem asChild>
                            <Link href={`${detailBasePath}/${user.id}`}>
                              <Eye />
                              {t("users.viewDetail")}
                            </Link>
                          </DropdownMenuItem>
                        ) : null}

                        {has("verification") ? (
                          <DropdownMenuItem onSelect={() => run(user.id, () => sendVerificationAction(user.id))}>
                            <MailCheck />
                            {t("users.sendVerification")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("reset_password") ? (
                          <DropdownMenuItem onSelect={() => run(user.id, () => sendPasswordResetAction(user.id))}>
                            <KeyRound />
                            {t("users.sendReset")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("magic_link") ? (
                          <DropdownMenuItem onSelect={() => run(user.id, () => sendMagicLinkAction(user.id))}>
                            <Mail />
                            {t("users.sendMagicLink")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("reset_usage") ? (
                          <DropdownMenuItem onSelect={() => run(user.id, () => resetUserUsageAction(user.id))}>
                            <Gauge />
                            {t("users.resetUsage")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("grant_plan") ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setGrantTarget({
                                id: user.id,
                                label: user.displayName || user.email || user.id,
                              })
                            }
                          >
                            <Gift />
                            {t("users.grantPro")}
                          </DropdownMenuItem>
                        ) : null}

                        {/* Full staff reset: new temporary password, the
                            authenticator cleared, sessions revoked. Offered
                            only for staff accounts, since it is the recovery
                            path for a lost authenticator. */}
                        {has("reset_staff") && user.role !== "user" && !isSelf ? (
                          <DropdownMenuItem
                            onSelect={() => run(user.id, () => resetModeratorAccountAction({ userId: user.id }))}
                          >
                            <RotateCcw />
                            {t("users.resetStaffAccount")}
                          </DropdownMenuItem>
                        ) : null}

                        <DropdownMenuSeparator />

                        {user.status !== "active" && has("restore") ? (
                          <DropdownMenuItem onSelect={() => run(user.id, () => restoreUserAction(user.id))}>
                            <ShieldCheck />
                            {t("users.restore")}
                          </DropdownMenuItem>
                        ) : null}

                        {user.status === "active" && has("suspend") && !isSelf ? (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "suspend", user })}>
                            <ShieldOff />
                            {t("users.suspend")}
                          </DropdownMenuItem>
                        ) : null}

                        {user.status !== "disabled" && has("disable") && !isSelf ? (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "disable", user })}>
                            <ShieldOff />
                            {t("users.disable")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("modify_role") && user.role !== "super_admin" && !isSelf ? (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "role", user })}>
                            <UserCog />
                            {user.role === "moderator" ? t("users.removeModerator") : t("users.makeModerator")}
                          </DropdownMenuItem>
                        ) : null}

                        {has("delete") && user.role !== "super_admin" && !isSelf ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setDialog({ kind: "delete", user })}>
                              <Trash2 />
                              {t("users.delete")}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableScroll>

      {/* Suspend / disable both require a reason, which is what makes the
          moderation log worth reading later. */}
      <ReasonDialog
        open={dialog?.kind === "suspend" || dialog?.kind === "disable"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === "disable" ? t("users.confirm.disable.title") : t("users.confirm.suspend.title")}
        description={
          dialog
            ? dialog.kind === "disable"
              ? t("users.confirm.disable.body", { name: dialog.user.displayName || dialog.user.email || "" })
              : t("users.confirm.suspend.body", { name: dialog.user.displayName || dialog.user.email || "" })
            : ""
        }
        consequences={
          dialog?.kind === "suspend"
            ? [t("users.confirm.suspend.consequence1"), t("users.confirm.suspend.consequence2")]
            : undefined
        }
        confirmLabel={dialog?.kind === "disable" ? t("users.disable") : t("users.suspend")}
        cancelLabel={t("common.cancel")}
        onConfirm={async (reason) => {
          if (!dialog) return;
          const { user, kind } = dialog;
          await run(user.id, () =>
            kind === "disable" ? disableUserAction(user.id, reason) : suspendUserAction(user.id, reason),
          );
          setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("users.confirm.delete.title")}
        description={
          dialog ? t("users.confirm.delete.body", { name: dialog.user.displayName || dialog.user.email || "" }) : ""
        }
        consequences={[
          t("users.confirm.delete.consequence1"),
          t("users.confirm.delete.consequence2"),
          t("users.confirm.delete.consequence3"),
        ]}
        confirmLabel={t("users.delete")}
        cancelLabel={t("common.cancel")}
        confirmPhrase="DELETE"
        confirmPhraseHint={t("users.confirm.delete.phraseHint")}
        onConfirm={async () => {
          if (!dialog) return;
          await run(dialog.user.id, () => deleteUserAction(dialog.user.id));
          setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === "role"}
        onOpenChange={(open) => !open && setDialog(null)}
        tone="primary"
        title={t("users.confirm.role.title")}
        description={
          dialog
            ? t("users.confirm.role.body", {
                name: dialog.user.displayName || dialog.user.email || "",
                role: t(`role.${dialog.user.role === "moderator" ? "user" : "moderator"}` as never),
              })
            : ""
        }
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          if (!dialog) return;
          const nextRole = dialog.user.role === "moderator" ? "user" : "moderator";
          await run(dialog.user.id, () => modifyUserRoleAction(dialog.user.id, nextRole));
          setDialog(null);
        }}
      />

      {grantTarget ? (
        <GrantPlanDialog
          open
          onOpenChange={(open) => {
            if (!open) setGrantTarget(null);
          }}
          userId={grantTarget.id}
          userLabel={grantTarget.label}
        />
      ) : null}
    </>
  );
}

function statusTone(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended") return "warning" as const;
  if (status === "pending_verification") return "neutral" as const;
  return "danger" as const;
}
