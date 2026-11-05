# Login email templates

Paste each file into Supabase: **Authentication → Emails → Templates**, then the matching tab. Set the subject too.

| Supabase tab | File | Subject |
|---|---|---|
| Confirm sign up | confirm-signup.html | Confirm your email for Taskify |
| Invite user | invite-user.html | You're invited to Taskify |
| Magic link | magic-link.html | Your Taskify sign-in link |
| Change email address | change-email.html | Confirm your new Taskify email |
| Reset password | reset-password.html | Reset your Taskify password |
| Reauthentication | reauthentication.html | Your Taskify verification code |

The `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .SiteURL }}` parts are filled in by Supabase; leave them as they are.
