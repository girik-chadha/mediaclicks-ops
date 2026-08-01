import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { CLIENT_REGION, PREFERRED_CHANNEL } from './enums'
import { oneOf } from './_sql'
import { organisations } from './org'

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    companyName: text('company_name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),

    /** Shown as plain text on WhatsApp-type meetings — no deep link, no join
     *  button. The absence should read as intentional (brief §5). */
    phoneE164: text('phone_e164'),

    /** Added beyond spec §2: §4.2 requires it to preselect Meet vs Zoom. */
    region: text('region', { enum: CLIENT_REGION }).notNull().default('domestic'),

    preferredChannel: text('preferred_channel', { enum: PREFERRED_CHANNEL })
      .notNull()
      .default('email'),

    notes: text('notes'),
  },
  (t) => [
    index('clients_org_idx').on(t.orgId),
    check('clients_region_valid', oneOf(t.region, CLIENT_REGION)),
    check(
      'clients_preferred_channel_valid',
      oneOf(t.preferredChannel, PREFERRED_CHANNEL),
    ),
  ],
)
