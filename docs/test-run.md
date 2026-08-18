# Test run before handover

Do this against **development**, not production. Roughly 30 minutes.

Anything that fails: the terminal running `npm run dev` now names the cause
for every unexpected error. Copy that block, not the browser message.

---

## 0. Fresh start

```powershell
npm run db:generate     # picks up the password_reset_tokens table
npm run db:migrate
npm run db:demo -- clear
npm run db:demo -- with-logins
npm run dev
```

`db:generate` is required once — the reset table is new and its migration
has to be created on your machine (the generator will not run on mine).

---

## 1. The two bugs that were broken longest

These have never been confirmed working against a real database. Everything
else is secondary to them.

- [ ] Open a meeting → **Edit** → change the **title** → Save → hard-refresh
      (Ctrl+Shift+R) → the new title is still there
- [ ] Edit a meeting → change the **time** → Save → refresh → it moved
- [ ] Edit a meeting → **add and remove an attendee** → Save → refresh → the
      list is what you left it as
- [ ] Open a meeting → **Yes, cancel it** → it shows as cancelled, struck
      through, and stays that way after a refresh

## 2. Timezone

- [ ] Profile → change timezone to `Asia/Kolkata` → Save → the **sidebar
      clock and its label change**, and the calendar's times all shift
- [ ] Change it back to `Asia/Dubai`
- [ ] Book a meeting for a specific time → it appears at that time on the
      calendar, on Today, and on Home

## 3. The assistant

- [ ] `What's on this week?` → lists meetings
- [ ] `Schedule a call with <a teammate> tomorrow 6pm to 7pm` → answer any
      questions → the card says **18:00–19:00**, not 18:00–18:30
- [ ] `book 90 minutes with <teammate> friday at 3pm` → 90 minutes
- [ ] Something deliberately odd — `clear my afternoon` — the Groq fallback
      either handles it or says plainly that it cannot
- [ ] Confirm a staged action → it actually happens

## 4. Clients

- [ ] Clients → select one → **Edit** → change the name → Save → the list
      updates, and so does the client's name on the calendar
- [ ] Edit → clear the phone number entirely → Save → it is empty, not the
      old value
- [ ] Edit → enter `notanemail` → Save → refused, with the reason **at the
      top of the form in red**
- [ ] Add a new client → it appears in the New Meeting client dropdown

## 5. Roles

- [ ] Team → Roles → **+ New role** → name it `GFX`, tick a few → Create
- [ ] It appears in the **role dropdown** next to each person
- [ ] Assign someone to GFX → sign in as them → they can only do what GFX
      allows
- [ ] Try to delete GFX while someone holds it → refused, and says how many
- [ ] Move them off GFX → delete it → gone
- [ ] Try to rename **Member** → refused, it is built in
- [ ] Edit Manager's permissions → save → still works

## 6. Chat, from two accounts

Use a normal window and a private window so two sessions coexist.

- [ ] Window A: sign in as the owner. Window B: as a teammate
      (`npm run db:demo -- with-logins` printed the passwords)
- [ ] B: Chat → join a public channel
- [ ] A: send a message in it → **B sees it after a refresh**
- [ ] B: reply → A sees it
- [ ] A: open a direct message to B → send → B sees it in their list
- [ ] B: the unread count in the sidebar goes up, and clears when they read

Chat does not live-update; it refreshes on navigation. Refreshing to see a
new message is current behaviour, not a bug.

## 7. Password reset — the handover path

Needs `RESEND_API_KEY` and `MAIL_FROM` set. See the note in
`runbook-go-live.md` about domain verification before this works for
addresses that are not your own.

- [ ] Sign out → **Forgot password** → enter your own address → "if that
      address belongs to an account here, a link is on its way"
- [ ] Enter an address that does not exist → **exactly the same message**
      (it must not reveal who has an account)
- [ ] Open the emailed link → set a password of 12+ characters → sign in
- [ ] Open the **same link again** → "already been used"
- [ ] Request a link, then request another, then open the **first** → it has
      been superseded and is refused
- [ ] Ask for six links in an hour → the sixth is silently ignored (still
      says "on its way")

## 8. Permissions, from a Member account

- [ ] Sign in as a Member → **Team** is not in the sidebar
- [ ] Navigate to `/team` by typing the URL → the "for owners and managers"
      page, not the matrix
- [ ] As a Member, try to move a meeting somebody else owns → it becomes a
      **request in that person's chat** with Approve and Deny, not a refusal
- [ ] Approve it as the owner → the change happens

## 9. The shape of the thing

- [ ] Home, Today, Calendar, Clients, Chat, Team, Profile all render
- [ ] No red error overlay anywhere
- [ ] The terminal shows no `unexpected failure:` lines from normal use
- [ ] Narrow the browser to phone width → the rail goes horizontal and the
      mobile nav appears

## 10. Production speed

```powershell
npm run build
npm start
```

- [ ] It builds with no errors
- [ ] Pages feel immediate, not the 4 seconds dev mode showed

A clean `npm run build` is also the last check that nothing is broken in a
way only production catches — dev is more forgiving about several things.

---

## Then

```powershell
npm run lint
npm run typecheck
npm test
```

All three clean, plus the boxes above ticked, and it is ready to hand over.
