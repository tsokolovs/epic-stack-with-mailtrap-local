import { faker } from '@faker-js/faker'
import { sendEmail } from '#app/utils/email.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const API = 'http://127.0.0.1:3550/api/v1'

async function catcherIsRunning() {
	try {
		const response = await fetch(`${API}/version`, {
			signal: AbortSignal.timeout(1000),
		})
		return response.ok
	} catch {
		return false
	}
}

async function findMessage(recipient: string) {
	// the SMTP hand-off resolves before the message is queryable, so poll for it
	for (let attempt = 0; attempt < 20; attempt++) {
		const response = await fetch(
			`${API}/search?query=${encodeURIComponent(recipient)}`,
		)
		const { messages } = (await response.json()) as {
			messages: Array<{ id: string }>
		}
		if (messages[0]) return messages[0]
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	return null
}

test.beforeAll(async () => {
	// skip rather than fail when the catcher isn't up, so `npm run validate` still
	// passes for someone who hasn't run `docker compose up`
	test.skip(
		!(await catcherIsRunning()),
		'No SMTP catcher on 127.0.0.1:3550 — run `docker compose up -d`',
	)
})

// covers the SMTP branch of sendEmail. The other e2e tests exercise the Resend
// branch through the MSW mock, so this is the piece that would otherwise have no
// coverage at all.
test('sendEmail delivers to the SMTP catcher', async () => {
	// playwright.config.ts blanks SMTP_HOST for the app server so the rest of the
	// suite keeps reading the mock's fixtures — this test runs sendEmail in its
	// own process, so setting it here only affects this test
	process.env.SMTP_HOST = '127.0.0.1'
	process.env.SMTP_PORT = '3535'

	const recipient = faker.internet
		.email({ provider: 'example.com' })
		.toLowerCase()
	const otp = 'ABC123'

	const result = await sendEmail({
		to: recipient,
		subject: 'Welcome to Epic Notes!',
		html: `<h1>Welcome to Epic Notes!</h1><p>Here's your verification code: <strong>${otp}</strong></p>`,
		text: `Welcome to Epic Notes!\n\nHere's your verification code: ${otp}`,
	})
	expect(result.status).toBe('success')

	const found = await findMessage(recipient)
	expect(found, `no message for ${recipient}`).not.toBeNull()

	const message = (await fetch(`${API}/message/${found!.id}`).then((response) =>
		response.json(),
	)) as {
		subject: string
		from: { address: string }
		to: Array<{ address: string }>
		html: string
		text: string
	}

	expect(message.subject).toBe('Welcome to Epic Notes!')
	expect(message.from.address).toBe('hello@epicstack.dev')
	expect(message.to[0]?.address).toBe(recipient)
	expect(message.html).toContain(otp)
	expect(message.text).toContain(otp)
})
