import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/context/ConfigContext'

function PolicyShell({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
      {updated && <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>}
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </div>
  )
}

export function PrivacyPage() {
  const { config } = useConfig()
  const organizer = config?.site?.organizer_name?.trim() || 'the championship organiser'
  const email = config?.site?.support_email?.trim()
  const phone = config?.site?.support_phone?.trim()

  return (
    <PolicyShell title="Privacy policy">
      <p>
        This portal is operated by {organizer} to accept athlete registrations for athletics championships and to
        process the associated registration fees. This policy explains what we collect, why, and how long we keep it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Athlete details you provide: full name, date of birth, gender, mobile number, and optionally email, address, district, representing body and emergency contact.</li>
        <li>Optional photographs or supporting documents you upload, stored privately.</li>
        <li>Registration records (championship, category, events, fees) and payment status.</li>
        <li>Limited technical data such as the request IP address, used for fraud prevention and rate limiting.</li>
      </ul>

      <h2>What we never store</h2>
      <ul>
        <li>We never store one-time passwords or passwords in plain text — only salted hashes.</li>
        <li>We never store your card or bank details. Card data is handled entirely by Razorpay; we only receive a payment reference and status.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To register and place you in the correct age category and events.</li>
        <li>To verify your identity when you retrieve your details or retry a payment.</li>
        <li>To collect the registration fee and issue a receipt.</li>
        <li>To comply with legal, accounting and anti-fraud obligations.</li>
      </ul>

      <h2>Payment processing</h2>
      <p>
        Payments are processed by Razorpay. We share only the amount and a reference with Razorpay; we receive back a
        payment reference, status and method. Razorpay's own privacy policy governs their processing.
      </p>

      <h2>Who can see your data</h2>
      <p>
        Only authorised championship administrators can view athlete and payment records, over a secured, role-based
        dashboard. Your data is never sold. Access to the underlying database is denied to public clients by design.
      </p>

      <h2>Retention</h2>
      <p>
        Registration and payment records are retained as long as needed for the championship, for any dispute window,
        and to meet accounting and legal requirements {organizer} is subject to. Where records are no longer required,
        they are deleted or anonymised.
      </p>

      <h2>Your choices</h2>
      <p>
        You may ask to access, correct or delete your personal data, subject to legal and accounting retention
        requirements. To make a request, contact {organizer}
        {email ? ` at ${email}` : ''}
        {phone ? ` or ${phone}` : ''}.
      </p>
    </PolicyShell>
  )
}

export function TermsPage() {
  const { config } = useConfig()
  const organizer = config?.site?.organizer_name?.trim() || 'the championship organiser'

  return (
    <PolicyShell title="Terms and conditions">
      <p>
        By submitting a registration through this portal you agree to these terms with {organizer}. A championship may
        additionally publish its own terms and conditions, which are shown during registration and also apply.
      </p>

      <h2>Registration and eligibility</h2>
      <ul>
        <li>You confirm that the details you provide are accurate and that the athlete is eligible for the selected category and events.</li>
        <li>Age and category eligibility are checked against the championship's configured rules and cutoff date; the organiser's decision is final.</li>
        <li>Registrations are only confirmed once the applicable fee is paid and verified, unless the organiser states otherwise.</li>
      </ul>

      <h2>Fees and payment</h2>
      <ul>
        <li>The fee shown is calculated by our server from the championship's current configuration and is the amount payable.</li>
        <li>Payments are collected through Razorpay. A registration is not confirmed until the payment is verified by our server.</li>
        <li>Refunds, if any, are at the organiser's discretion and follow the championship's stated policy.</li>
      </ul>

      <h2>Conduct</h2>
      <p>
        You agree not to misuse the portal, including attempting to access other athletes' data, submitting false
        information, or interfering with the service. Accounts or registrations created fraudulently may be cancelled.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        The organiser is not liable for indirect losses arising from use of this portal. Nothing in these terms limits
        liability that cannot be limited by law.
      </p>
    </PolicyShell>
  )
}

export function ContactPage() {
  const { config } = useConfig()
  const site = config?.site ?? {}

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Contact the organiser</h1>
      <p className="mt-2 text-sm text-slate-600">
        For anything to do with your registration, payment or eligibility, please reach out to the organising team.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{site.organizer_name?.trim() || 'Championship organiser'}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="text-slate-800">
                {site.support_email?.trim() ? (
                  <a className="text-orange-700 underline" href={`mailto:${site.support_email}`}>
                    {site.support_email}
                  </a>
                ) : (
                  'Not provided yet'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Phone</dt>
              <dd className="text-slate-800">{site.support_phone?.trim() || 'Not provided yet'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Address</dt>
              <dd className="whitespace-pre-line text-slate-800">{site.address?.trim() || 'Not provided yet'}</dd>
            </div>
          </dl>
          {!site.support_email?.trim() && !site.support_phone?.trim() && (
            <p className="mt-4 text-xs text-slate-500">
              The organiser has not published contact details yet. An administrator can add them under Admin →
              Settings.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/status">
          <Button variant="outline">Check registration status</Button>
        </Link>
        <Link to="/returning">
          <Button variant="outline">Retrieve my details</Button>
        </Link>
      </div>
    </div>
  )
}
