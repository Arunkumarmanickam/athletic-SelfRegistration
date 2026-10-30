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
  return (
    <PolicyShell title="Privacy Policy" updated="29 October 2026">
      <h2>1. Introduction</h2>
      <p>
        This website is operated by Kishore Kumar S to facilitate online athlete registrations for athletics championships
        and to process the associated registration fees.
      </p>
      <p>
        This Privacy Policy explains what personal information we collect, how we use and protect it, and how long we
        retain it. By using this website, you acknowledge that your information will be handled as described in this
        policy.
      </p>

      <h2>2. Information We Collect</h2>
      <p>We may collect the following information when you register through our website:</p>
      <ul>
        <li>
          <strong>Athlete Information:</strong> Full name, date of birth, gender, mobile number, and, where provided,
          email address, residential address, district, representing body, and emergency contact details.
        </li>
        <li>
          <strong>Supporting Documents:</strong> Photographs and supporting documents uploaded by athletes, where required
          for registration.
        </li>
        <li>
          <strong>Registration Information:</strong> Championship details, age category, selected events, registration
          fees, and registration status.
        </li>
        <li>
          <strong>Payment Information:</strong> Payment reference, transaction status, payment method, and other limited
          transaction details required to confirm registration.
        </li>
        <li>
          <strong>Technical Information:</strong> Limited technical information, such as IP address and request data,
          where necessary for security, fraud prevention, and rate limiting.
        </li>
      </ul>

      <h2>3. How We Use Your Information</h2>
      <p>We use the information collected for the following purposes:</p>
      <ul>
        <li>To process and manage athlete registrations.</li>
        <li>To determine the appropriate age category and registered events based on the information provided.</li>
        <li>To verify registration details when athletes retrieve their saved information or retry a payment.</li>
        <li>To process registration fee payments and confirm successful transactions.</li>
        <li>To generate registration confirmations and receipts, where applicable.</li>
        <li>To communicate with athletes about their registrations when necessary.</li>
        <li>To prevent fraudulent transactions and unauthorised access.</li>
        <li>To comply with applicable legal, accounting, and regulatory requirements.</li>
      </ul>

      <h2>4. Payment Processing</h2>
      <p>Your payment will be processed through a third-party payment gateway.</p>
      <p>
        Payment information is handled by the payment gateway in accordance with its applicable security practices and
        privacy policy. We receive transaction-related information, such as the payment reference, status, and payment
        method, to verify payments and manage registrations.
      </p>
      <p>We do not store complete card details or banking credentials on our website.</p>
      <p>
        The payment gateway may independently collect and process information as described in its own privacy policy.
      </p>

      <h2>5. Data Protection and Access</h2>
      <p>
        We take reasonable measures to protect the personal information collected through this website against
        unauthorised access, disclosure, alteration, or loss.
      </p>
      <p>
        Access to athlete registration and payment records is restricted to authorised championship administrators
        through an access-controlled administrative dashboard.
      </p>
      <p>We do not sell athletes' personal information to third parties.</p>
      <p>
        Information may be shared with service providers, including our payment gateway, when necessary to operate the
        registration service, process payments, maintain security, or meet legal obligations.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain personal information for as long as reasonably necessary to administer the championship, maintain
        registration records, resolve payment disputes, and meet applicable legal and accounting requirements.
      </p>
      <p>
        When information is no longer required for these purposes, we will take appropriate steps to delete or anonymise
        it, subject to applicable legal obligations.
      </p>

      <h2>7. Your Privacy Rights</h2>
      <p>Subject to applicable law, you may request to:</p>
      <ul>
        <li>Access the personal information associated with your registration.</li>
        <li>Correct inaccurate or incomplete information.</li>
        <li>Request deletion of personal information that is no longer required to be retained.</li>
        <li>Obtain information about how your personal information is used.</li>
      </ul>
      <p>
        Requests may be subject to identity verification and applicable legal or record-retention requirements.
      </p>
      <p>To submit a privacy-related request, please contact us using the details provided below.</p>

      <h2>8. Cookies and Technical Data</h2>
      <p>
        Our website may use essential technical storage or similar technologies required for website functionality,
        security, session management, and fraud prevention.
      </p>
      <p>
        Any additional cookies or tracking technologies, if used, will be handled in accordance with applicable
        requirements.
      </p>

      <h2>9. Third-Party Services</h2>
      <p>
        Our website uses third-party services where necessary to provide registration and payment functionality. These
        services may process information in accordance with their own privacy policies and terms.
      </p>
      <p>We are not responsible for the independent privacy practices of third-party service providers.</p>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time to reflect changes in our registration process, website
        functionality, or applicable legal requirements.
      </p>
      <p>The updated policy will be published on this page with a revised date.</p>

      <h2>11. Contact Information</h2>
      <p>For questions, requests, or concerns regarding this Privacy Policy or the handling of your personal information, please contact:</p>
      <p>
        Operator: Kishore Kumar S
        <br />
        Email: <a className="text-orange-700 underline" href="mailto:kijomech@gmail.com">kijomech@gmail.com</a>
        <br />
        Phone: <a className="text-orange-700 underline" href="tel:+919600663369">9600663369</a>
      </p>
      <p>
        Please include sufficient information to help us identify your registration when submitting a
        registration-related request. Avoid sending unnecessary sensitive personal information by email.
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
        <li>Your payment will be processed through a third-party payment gateway. A registration is not confirmed until the payment is verified by our server.</li>
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
