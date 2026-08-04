CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"requested_by_name" text NOT NULL,
	"approver_user_id" uuid,
	"meeting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_kind_valid" CHECK ("approval_requests"."kind" IN ('reschedule', 'cancel', 'reassign')),
	CONSTRAINT "approvals_status_valid" CHECK ("approval_requests"."status" IN ('pending', 'approved', 'denied', 'withdrawn')),
	CONSTRAINT "approvals_decided_consistent" CHECK (("approval_requests"."status" = 'pending' AND "approval_requests"."decided_at" IS NULL)
       OR ("approval_requests"."status" <> 'pending' AND "approval_requests"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_approver_idx" ON "approval_requests" USING btree ("approver_user_id","status");--> statement-breakpoint
CREATE INDEX "approvals_requester_idx" ON "approval_requests" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX "approvals_meeting_idx" ON "approval_requests" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;