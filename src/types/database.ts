/**
 * Typed mirror of the `public` schema.
 *
 * Maintained by hand rather than emitted by `supabase gen types`, for one
 * reason: the generator renders every CHECK-constrained column as a bare
 * `string`, so `profiles.role`, `messages.status`, `models.availability`
 * and friends lose the unions that make an invalid value a compile error
 * here. Those unions catch real mistakes, so they are worth the upkeep.
 *
 * The trade-off is that this file can drift from the database, which has
 * already happened once on this project (see
 * 0008_profile_provisioning_and_hardening.sql). Whenever a migration
 * lands, update this file in the same change, then verify it against the
 * live schema with:
 *
 *   npm run db:types:check
 *
 * which diffs these declarations against `supabase gen types` output and
 * fails if a column, table or nullability has drifted.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/**
 * `Update` defaults to `Partial<Row>`, not `Partial<Insert>`.
 *
 * Deriving updates from the insert shape silently makes every column the
 * insert omits un-updatable: postgrest-js narrows the value type to
 * `never`, and `.update({ edited_at })` fails to compile even though the
 * column is perfectly writable. That bit this project on
 * `messages.edited_at` and `usage_counters.updated_at`. Postgres's own
 * update shape is "any column, optionally", which is what `Partial<Row>`
 * expresses.
 */
type Table<Row, Insert, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  // Required by @supabase/postgrest-js's GenericTable constraint. This
  // hand-written mirror doesn't model foreign-key relationships (that
  // metadata only matters for the nested `select("foo(bar)")` embed
  // syntax, which this codebase doesn't use), so every table declares
  // none. Regenerating this file with `supabase gen types typescript`
  // would populate these for real.
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          email: string | null;
          display_name: string | null;
          avatar_url: string | null;
          locale: string;
          theme: "system" | "light" | "dark";
          accent_preference: string;
          role: "user" | "moderator" | "super_admin";
          status: "active" | "suspended" | "disabled" | "pending_verification" | "deleted";
          created_at: string;
          updated_at: string;
          // Staff onboarding state, added in 0015. Writable only by the
          // service role — a database trigger refuses everyone else, so a
          // browser cannot clear its own gate.
          font_preference: "system" | "grotesk" | "humanist" | "geometric" | "rounded" | "serif" | "slab" | "mono" | "reading";
          must_change_password: boolean;
          password_changed_at: string | null;
          mfa_enrolled_at: string | null;
          invited_by: string | null;
          invited_at: string | null;
        },
        {
          id: string;
          email?: string | null;
          font_preference?: "system" | "grotesk" | "humanist" | "geometric" | "rounded" | "serif" | "slab" | "mono" | "reading";
          must_change_password?: boolean;
          password_changed_at?: string | null;
          mfa_enrolled_at?: string | null;
          invited_by?: string | null;
          invited_at?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          theme?: "system" | "light" | "dark";
          accent_preference?: string;
          // Guarded at the database level (see `profiles_guard_privileged_fields`
          // in 0001_core_schema.sql) — only a service-role connection may
          // actually change these; typed here so admin server actions can.
          role?: "user" | "moderator" | "super_admin";
          status?: "active" | "suspended" | "disabled" | "pending_verification" | "deleted";
        }
      >;
      providers: Table<
        {
          id: string;
          slug: string;
          name: string;
          kind: "text" | "image" | "audio" | "video";
          status: "operational" | "degraded" | "disabled" | "configuration_error" | "unknown";
          enabled: boolean;
          config: Json;
          created_at: string;
          updated_at: string;
        },
        Partial<{
          slug: string;
          name: string;
          kind: "text" | "image" | "audio" | "video";
          status: "operational" | "degraded" | "disabled" | "configuration_error" | "unknown";
          enabled: boolean;
          config: Json;
        }>
      >;
      models: Table<
        {
          id: string;
          slug: string;
          display_name: string;
          provider_id: string;
          provider_model_id: string;
          description: string | null;
          capabilities: string[];
          context_limit: number | null;
          output_limit: number | null;
          tier: "free" | "pro" | "premium" | "experimental";
          availability: "available" | "locked" | "disabled" | "maintenance" | "deprecated";
          reasoning_mode: "auto" | "exclude" | "require";
          priority: number;
          fallback_model_id: string | null;
          is_default: boolean;
          is_default_vision: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        Partial<{
          slug: string;
          display_name: string;
          reasoning_mode: "auto" | "exclude" | "require";
          provider_id: string;
          provider_model_id: string;
          description: string | null;
          capabilities: string[];
          context_limit: number | null;
          output_limit: number | null;
          tier: "free" | "pro" | "premium" | "experimental";
          availability: "available" | "locked" | "disabled" | "maintenance" | "deprecated";
          priority: number;
          fallback_model_id: string | null;
          is_default: boolean;
          is_default_vision: boolean;
          metadata: Json;
        }>
      >;
      conversations: Table<
        {
          id: string;
          user_id: string;
          title: string;
          model_id: string | null;
          is_archived: boolean;
          is_pinned: boolean;
          last_message_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          title?: string;
          model_id?: string | null;
          is_archived?: boolean;
          is_pinned?: boolean;
          last_message_at?: string | null;
        }
      >;
      messages: Table<
        {
          id: string;
          conversation_id: string;
          user_id: string;
          role: "user" | "assistant" | "system";
          status: "pending" | "streaming" | "complete" | "error" | "stopped";
          content: string | null;
          active_variant_id: string | null;
          edited_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          conversation_id: string;
          user_id: string;
          role: "user" | "assistant" | "system";
          status?: "pending" | "streaming" | "complete" | "error" | "stopped";
          content?: string | null;
          active_variant_id?: string | null;
          /**
           * Writable on purpose.
           *
           * The two rows of a turn are inserted concurrently, so leaving
           * this to the database's `now()` made their order a race — and
           * messages are read back `order by created_at`. The route
           * stamps the pair a millisecond apart so a reply can never sort
           * above the question that prompted it.
           */
          created_at?: string;
        }
      >;
      message_variants: Table<
        {
          id: string;
          message_id: string;
          sequence: number;
          content: string | null;
          reasoning_summary: string | null;
          model_id: string | null;
          provider_id: string | null;
          finish_reason: string | null;
          usage: Json;
          error: Json | null;
          created_at: string;
        },
        {
          id?: string;
          message_id: string;
          sequence?: number;
          content?: string | null;
          reasoning_summary?: string | null;
          model_id?: string | null;
          provider_id?: string | null;
          finish_reason?: string | null;
          usage?: Json;
          error?: Json | null;
        }
      >;
      attachments: Table<
        {
          id: string;
          owner_id: string;
          storage_provider: string;
          storage_path: string;
          original_filename: string;
          mime_type: string | null;
          size_bytes: number;
          kind: "document" | "spreadsheet" | "presentation" | "image" | "audio" | "video" | "code" | "data" | "other";
          status: "uploading" | "uploaded" | "processing" | "ready" | "failed" | "unsupported" | "rejected";
          processed_content: string | null;
          processing_error: string | null;
          created_at: string;
        },
        {
          id?: string;
          owner_id: string;
          storage_provider?: string;
          storage_path: string;
          original_filename: string;
          mime_type?: string | null;
          size_bytes?: number;
          kind?: "document" | "spreadsheet" | "presentation" | "image" | "audio" | "video" | "code" | "data" | "other";
          status?: "uploading" | "uploaded" | "processing" | "ready" | "failed" | "unsupported" | "rejected";
          processed_content?: string | null;
          processing_error?: string | null;
        }
      >;
      message_attachments: Table<
        { message_id: string; attachment_id: string },
        { message_id: string; attachment_id: string }
      >;
      generated_assets: Table<
        {
          id: string;
          owner_id: string;
          type: "image" | "other";
          storage_provider: string;
          storage_path: string;
          prompt: string | null;
          model_id: string | null;
          conversation_id: string | null;
          message_id: string | null;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          owner_id: string;
          type?: "image" | "other";
          storage_provider?: string;
          storage_path: string;
          prompt?: string | null;
          model_id?: string | null;
          conversation_id?: string | null;
          message_id?: string | null;
          metadata?: Json;
        }
      >;
      plans: Table<
        {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          price_usd: number;
          currency_prices: Json;
          billing_interval: "month" | "year";
          is_active: boolean;
          is_default: boolean;
          sort_order: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        Partial<{
          slug: string;
          name: string;
          description: string | null;
          price_usd: number;
          currency_prices: Json;
          billing_interval: "month" | "year";
          is_active: boolean;
          is_default: boolean;
          sort_order: number;
          metadata: Json;
        }>
      >;
      plan_entitlements: Table<
        { id: string; plan_id: string; feature_key: string; value: Json },
        { id?: string; plan_id: string; feature_key: string; value: Json }
      >;
      user_entitlements: Table<
        {
          id: string;
          user_id: string;
          feature_key: string;
          value: Json;
          reason: string | null;
          granted_by: string | null;
          expires_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          feature_key: string;
          value: Json;
          reason?: string | null;
          granted_by?: string | null;
          expires_at?: string | null;
        }
      >;
      usage_events: Table<
        {
          id: string;
          user_id: string;
          category: string;
          quantity: number;
          metadata: Json;
          created_at: string;
        },
        { id?: string; user_id: string; category: string; quantity?: number; metadata?: Json }
      >;
      usage_counters: Table<
        {
          id: string;
          user_id: string;
          category: string;
          period: "day" | "month";
          period_key: string;
          count: number;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          category: string;
          period: "day" | "month";
          period_key: string;
          count?: number;
          updated_at?: string;
        }
      >;
      subscriptions: Table<
        {
          id: string;
          user_id: string;
          plan_id: string;
          status: "active" | "past_due" | "canceled" | "expired" | "trialing";
          billing_provider: string;
          provider_customer_id: string | null;
          provider_subscription_code: string | null;
          provider_subscription_token: string | null;
          provider_reference: string | null;
          currency: string;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          canceled_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          plan_id: string;
          status?: "active" | "past_due" | "canceled" | "expired" | "trialing";
          billing_provider?: string;
          provider_customer_id?: string | null;
          provider_subscription_code?: string | null;
          provider_subscription_token?: string | null;
          provider_reference?: string | null;
          currency?: string;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
        }
      >;
      payment_records: Table<
        {
          id: string;
          user_id: string | null;
          subscription_id: string | null;
          provider: string;
          provider_reference: string;
          amount: number | null;
          currency: string | null;
          status: "pending" | "success" | "failed" | "refunded";
          raw_event: Json | null;
          created_at: string;
        },
        {
          id?: string;
          user_id?: string | null;
          subscription_id?: string | null;
          provider?: string;
          provider_reference: string;
          amount?: number | null;
          currency?: string | null;
          status: "pending" | "success" | "failed" | "refunded";
          raw_event?: Json | null;
        }
      >;
      // Added in 0023_session_locations.sql. Written only by the sign-in
      // path with the service role; readable by the owner and by staff.
      session_locations: Table<
        {
          session_id: string;
          user_id: string;
          country: string | null;
          region: string | null;
          city: string | null;
          created_at: string;
        },
        {
          session_id: string;
          user_id: string;
          country?: string | null;
          region?: string | null;
          city?: string | null;
        }
      >;
      system_settings: Table<
        {
          id: string;
          key: string;
          value: Json;
          description: string | null;
          updated_by: string | null;
          updated_at: string;
        },
        { id?: string; key: string; value: Json; description?: string | null; updated_by?: string | null; updated_at?: string }
      >;
      system_prompt_versions: Table<
        {
          id: string;
          version: number;
          content: string;
          status: "draft" | "active" | "archived";
          created_by: string | null;
          created_at: string;
          published_at: string | null;
        },
        {
          id?: string;
          version: number;
          content: string;
          status?: "draft" | "active" | "archived";
          created_by?: string | null;
          published_at?: string | null;
        }
      >;
      feature_flags: Table<
        {
          id: string;
          key: string;
          enabled: boolean;
          description: string | null;
          updated_by: string | null;
          updated_at: string;
        },
        { id?: string; key: string; enabled?: boolean; description?: string | null; updated_by?: string | null; updated_at?: string }
      >;
      admin_roles: Table<
        {
          id: string;
          user_id: string;
          role: "moderator" | "super_admin";
          granted_by: string | null;
          granted_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
        },
        {
          id?: string;
          user_id: string;
          role: "moderator" | "super_admin";
          granted_by?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
        }
      >;
      admin_audit_logs: Table<
        {
          id: string;
          actor_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          result: "success" | "failure";
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          actor_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          result?: "success" | "failure";
          metadata?: Json;
        }
      >;
      email_templates: Table<
        {
          id: string;
          kind: string;
          locale: string;
          subject: string;
          preview: string;
          heading: string;
          body: string;
          action_label: string;
          footnote: string;
          version: number;
          updated_by: string | null;
          updated_at: string;
          created_at: string;
        },
        {
          id?: string;
          kind: string;
          locale: string;
          subject: string;
          preview?: string;
          heading: string;
          body: string;
          action_label?: string;
          footnote?: string;
          version?: number;
          updated_by?: string | null;
          updated_at?: string;
          created_at?: string;
        }
      >;
      email_template_versions: Table<
        {
          id: string;
          template_id: string;
          kind: string;
          locale: string;
          version: number;
          subject: string;
          preview: string;
          heading: string;
          body: string;
          action_label: string;
          footnote: string;
          change_note: string | null;
          restored_from: number | null;
          created_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          template_id: string;
          kind: string;
          locale: string;
          version: number;
          subject: string;
          preview?: string;
          heading: string;
          body: string;
          action_label?: string;
          footnote?: string;
          change_note?: string | null;
          restored_from?: number | null;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      moderation_records: Table<
        {
          id: string;
          user_id: string;
          action: "warned" | "suspended" | "restored" | "disabled" | "deleted" | "note";
          reason: string | null;
          performed_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          action: "warned" | "suspended" | "restored" | "disabled" | "deleted" | "note";
          reason?: string | null;
          performed_by?: string | null;
        }
      >;
      notifications: Table<
        {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          read_at: string | null;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          metadata?: Json;
        }
      >;
      user_memories: Table<
        {
          id: string;
          user_id: string;
          category: "preference" | "bio" | "project" | "constraint" | "general";
          content: string;
          source_conversation_id: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          category?: "preference" | "bio" | "project" | "constraint" | "general";
          content: string;
          source_conversation_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      // Added in 0014_admin_dashboard_snapshot.sql. Collapses the eight
      // requests the admin dashboard used to make into one; SECURITY
      // DEFINER, and it authorizes the caller itself before reading.
      // Added in 0022_user_device_sessions.sql. Service-role only; both
      // filter on the user id they are given.
      list_user_sessions: {
        Args: { p_user_id: string };
        Returns: Array<{
          id: string;
          created_at: string;
          refreshed_at: string | null;
          user_agent: string | null;
          ip: string | null;
          aal: string | null;
        }>;
      };
      revoke_user_session: {
        Args: { p_user_id: string; p_session_id: string };
        Returns: boolean;
      };
      admin_dashboard_snapshot: {
        Args: Record<string, never>;
        Returns: Json;
      };
      increment_usage_counter: {
        Args: {
          p_user_id: string;
          p_category: string;
          p_period: "day" | "month";
          p_period_key: string;
          p_quantity: number;
        };
        Returns: number;
      };
      // Added in 0006_security_hardening.sql — see that migration for why
      // this replaced a check-then-increment_usage_counter call pattern
      // that had a real race condition.
      try_consume_usage: {
        Args: {
          p_user_id: string;
          p_category: string;
          p_period: "day" | "month";
          p_period_key: string;
          p_quantity: number;
          p_limit: number;
        };
        Returns: { allowed: boolean; new_count: number }[];
      };
    };
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type InsertOf<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type UpdateOf<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
