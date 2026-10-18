// Outbound notifications (SMS for OTP, email for confirmations).
// Everything here degrades gracefully: when a provider is not configured the
// caller learns about it and the UI never pretends a message was delivered.

export interface SmsResult {
  sent: boolean
  reason?: 'not_configured' | 'unknown_provider' | 'provider_error'
}

export function smsProvider(): string {
  return (Deno.env.get('SMS_PROVIDER') ?? 'none').trim().toLowerCase()
}

export async function sendSms(phoneE164: string, message: string): Promise<SmsResult> {
  const provider = smsProvider()
  if (provider === 'none' || provider === '') return { sent: false, reason: 'not_configured' }

  try {
    if (provider === 'twilio') {
      const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
      const token = Deno.env.get('TWILIO_AUTH_TOKEN')
      const from = Deno.env.get('TWILIO_FROM_NUMBER')
      if (!sid || !token || !from) return { sent: false, reason: 'not_configured' }

      const body = new URLSearchParams({ To: phoneE164, From: from, Body: message })
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      if (!response.ok) {
        console.error('twilio send failed', response.status, await response.text())
        return { sent: false, reason: 'provider_error' }
      }
      return { sent: true }
    }

    if (provider === 'msg91') {
      const authKey = Deno.env.get('MSG91_AUTH_KEY')
      const senderId = Deno.env.get('MSG91_SENDER_ID') ?? ''
      const templateId = Deno.env.get('MSG91_DLT_TEMPLATE_ID')
      if (!authKey) return { sent: false, reason: 'not_configured' }

      // MSG91 Flow API (DLT compliant) when a template id is configured.
      if (templateId) {
        const response = await fetch('https://api.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: { authkey: authKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            sender: senderId,
            short_url: '0',
            recipients: [{ mobiles: phoneE164.replace('+', ''), MESSAGE: message }],
          }),
        })
        if (!response.ok) {
          console.error('msg91 send failed', response.status, await response.text())
          return { sent: false, reason: 'provider_error' }
        }
        return { sent: true }
      }

      // Fallback: simple HTTP API (requires an approved DLT template on the account).
      const url = new URL('https://api.msg91.com/api/sendhttp.php')
      url.searchParams.set('authkey', authKey)
      url.searchParams.set('mobiles', phoneE164.replace('+', ''))
      url.searchParams.set('message', message)
      url.searchParams.set('sender', senderId)
      url.searchParams.set('route', '4')
      url.searchParams.set('country', '91')
      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error('msg91 send failed', response.status, await response.text())
        return { sent: false, reason: 'provider_error' }
      }
      return { sent: true }
    }

    return { sent: false, reason: 'unknown_provider' }
  } catch (error) {
    console.error('sms send threw', error)
    return { sent: false, reason: 'provider_error' }
  }
}

export interface EmailResult {
  sent: boolean
  reason?: 'not_configured' | 'provider_error'
}

/** Sends the registration confirmation email through Resend when configured. */
export async function sendConfirmationEmail(input: {
  to: string | null
  athleteName: string
  athleteId: string
  championshipName: string
  registrationCode: string
  events: string[]
  amountPaise: number
  currency: string
  paymentId: string | null
}): Promise<EmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('NOTIFICATION_FROM_EMAIL')
  if (!apiKey || !from || !input.to) return { sent: false, reason: 'not_configured' }

  const amount = `${input.currency} ${(input.amountPaise / 100).toFixed(2)}`
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#0f172a">Registration confirmed</h2>
      <p>Hello ${escapeHtml(input.athleteName)},</p>
      <p>Your registration for <strong>${escapeHtml(input.championshipName)}</strong> is confirmed and payment has been verified.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px 0;color:#475569">Athlete ID</td><td style="padding:6px 0"><strong>${escapeHtml(input.athleteId)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#475569">Bib number / Registration ID</td><td style="padding:6px 0"><strong>${escapeHtml(input.registrationCode)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#475569">Events</td><td style="padding:6px 0">${escapeHtml(input.events.join(', '))}</td></tr>
        <tr><td style="padding:6px 0;color:#475569">Amount paid</td><td style="padding:6px 0">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:6px 0;color:#475569">Payment reference</td><td style="padding:6px 0">${escapeHtml(input.paymentId ?? '—')}</td></tr>
      </table>
      <p style="color:#64748b;font-size:13px">Please keep this email for your records. You can retrieve your registration at any time using your Athlete ID.</p>
    </div>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: `Registration confirmed — ${input.championshipName} (${input.registrationCode})`,
        html,
      }),
    })
    if (!response.ok) {
      console.error('resend send failed', response.status, await response.text())
      return { sent: false, reason: 'provider_error' }
    }
    return { sent: true }
  } catch (error) {
    console.error('resend send threw', error)
    return { sent: false, reason: 'provider_error' }
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
