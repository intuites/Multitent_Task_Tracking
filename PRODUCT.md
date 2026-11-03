# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: Vite + React + TypeScript frontend; Vercel-style serverless handlers in `api/`; Supabase (Postgres, Auth, Storage). Local development only for now; Vercel deployment deferred by the owner.

## Users

- **Organization staff** (admins and employees) at firms that run their work in this app. They use it all day on desktop laptops to manage tasks across departments, triage escalations and report on delivery.
- **Platform admin** (Intuites), outside every organization: onboards organizations and watches system health.

## Product Purpose

Taskify is a multi-tenant CRM and task-tracking system, operated by Intuites. Intuites is also the first tenant; other firms sign up as separate organizations. It joins departments, tasks with strict status history, escalations and notifications in one place, so a firm can see what is owed and what is at risk. Success: staff clear their work without hunting for context, and admins see risk early.

## Positioning

Tasks and escalations share one auditable record. An escalation keeps its own history and returns a task to an explicit status. Tenant isolation is enforced in the database, not only the UI.

## Operating Context

Heavy daily desktop use by staff. Mobile is secondary. Work is driven by statuses (Not Yet Started, In Progress, In Review, Blocked, Escalation, Completed, Cancelled), due dates, assignees and approvals. Email and in-app notifications carry reminders. No subscription or billing features.

## Capabilities and Constraints

- Roles: inside an organization, admin and employee; outside every organization, platform admin.
- New tasks always start as Not Yet Started; status changes only through validated workflows with history.
- An existing Candidate Dashboard exists outside this repository; its integration is undecided (see `docs/implementation-audit.md`).
- Facts still open: logo upload and branding, project timeline view, week/day calendar.

## Brand Commitments

Product name "Taskify" (renamed from "Intuites" on 2026-10-28). Intuites is the operating company and first tenant. No logo, colors, typography or voice are binding yet.

## Evidence on Hand

No customer testimonials, case studies, logos or metrics exist in the repository. Do not fabricate any.

## Product Principles

1. Operational clarity over decoration: staff scan dense lists all day, so status, priority and due dates must read at a glance.
2. History is never lost: transitions, escalations and edits stay visible.
3. Explicit over automatic: a human chooses the next status after an escalation.
4. Tenant boundaries are product features and must be legible in the UI.
5. Desktop-first density, with usable layouts on small screens.

## Accessibility & Inclusion

Target WCAG 2.1 AA: keyboard navigation for all workflows, visible focus, sufficient contrast, labelled controls. Status must not rely on color alone.
