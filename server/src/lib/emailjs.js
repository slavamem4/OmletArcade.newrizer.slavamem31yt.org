// EmailJS transport.
//
// The private key is an account credential, so the call is made from here and
// never from the phone: the app asks this service to send a code, it does not
// talk to EmailJS itself.

import { config } from '../config.js';
import { HttpError } from './http.js';

const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

/**
 * @param {{to: string, code: string, minutes: number}} message
 */
export const sendVerificationCode = async ({ to, code, minutes }) => {
  if (!config.email.enabled) {
    throw new HttpError(503, 'email_disabled', 'Email delivery is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        service_id: config.email.serviceId,
        template_id: config.email.templateId,
        user_id: config.email.publicKey,
        accessToken: config.email.privateKey,
        template_params: {
          // The template addresses the recipient by the part before the "@";
          // no profile data is sent to the mail service.
          to_name: to.split('@')[0].slice(0, 24),
          to_email: to,
          email: to,
          code,
          passcode: code,
          app_name: 'Arcade',
          expires: String(minutes),
          time: `${minutes} мин`,
        },
      }),
    });
  } catch {
    throw new HttpError(502, 'email_unavailable', 'Mail service is not reachable');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // EmailJS answers in plain text. The body is logged, never echoed, but the
    // status is: without it a misconfigured account looks like a generic 502.
    const detail = await response.text().catch(() => '');
    const hint =
      response.status === 403
        ? 'EmailJS refused a non-browser call: enable "Allow EmailJS API for ' +
          'non-browser applications" and "Use Private Key" in Account -> Security'
        : `EmailJS answered ${response.status}`;
    const error = new HttpError(502, 'email_failed', hint);
    error.upstream = `${response.status} ${detail.slice(0, 200)}`;
    throw error;
  }
};
