import { render } from '@react-email/components'
import nodemailer from 'nodemailer'
import { type ReactElement } from 'react'
import { z } from 'zod'

const resendErrorSchema = z.union([
	z.object({
		name: z.string(),
		message: z.string(),
		statusCode: z.number(),
	}),
	z.object({
		name: z.literal('UnknownError'),
		message: z.literal('Unknown Error'),
		statusCode: z.literal(500),
		cause: z.any(),
	}),
])
type ResendError = z.infer<typeof resendErrorSchema>

const resendSuccessSchema = z.object({
	id: z.string(),
})

export async function sendEmail({
	react,
	...options
}: {
	to: string
	subject: string
} & (
	| { html: string; text: string; react?: never }
	| { react: ReactElement; html?: never; text?: never }
)) {
	const from = 'hello@epicstack.dev'

	const email = {
		from,
		...options,
		...(react ? await renderReactEmail(react) : null),
	}

	// when SMTP_HOST is set, send through a local SMTP server instead of Resend
	// so the message can be opened in a browser during development
	if (process.env.SMTP_HOST) {
		return sendEmailViaSmtp(email)
	}

	// feel free to remove this condition once you've set up resend
	if (!process.env.RESEND_API_KEY && !process.env.MOCKS) {
		console.error(`RESEND_API_KEY not set and we're not in mocks mode.`)
		console.error(
			`To send emails, set the RESEND_API_KEY environment variable.`,
		)
		console.error(`Would have sent the following email:`, JSON.stringify(email))
		return {
			status: 'success',
			data: { id: 'mocked' },
		} as const
	}

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		body: JSON.stringify(email),
		headers: {
			Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()
	const parsedData = resendSuccessSchema.safeParse(data)

	if (response.ok && parsedData.success) {
		return {
			status: 'success',
			data: parsedData,
		} as const
	} else {
		const parseResult = resendErrorSchema.safeParse(data)
		if (parseResult.success) {
			return {
				status: 'error',
				error: parseResult.data,
			} as const
		} else {
			return {
				status: 'error',
				error: {
					name: 'UnknownError',
					message: 'Unknown Error',
					statusCode: 500,
					cause: data,
				} satisfies ResendError,
			} as const
		}
	}
}

async function sendEmailViaSmtp(email: {
	from: string
	to: string
	subject: string
	html?: string
	text?: string
}) {
	const transport = nodemailer.createTransport({
		host: process.env.SMTP_HOST,
		port: Number(process.env.SMTP_PORT ?? 3535),
		// a local catcher has no TLS and no credentials
		secure: false,
		tls: { rejectUnauthorized: false },
	})

	try {
		const info = await transport.sendMail(email)
		return {
			status: 'success',
			data: { id: info.messageId },
		} as const
	} catch (error) {
		console.error(`Could not send email to ${process.env.SMTP_HOST}:`, error)
		return {
			status: 'error',
			error: {
				name: 'SmtpError',
				message: error instanceof Error ? error.message : 'Unknown Error',
				statusCode: 500,
			} satisfies ResendError,
		} as const
	}
}

async function renderReactEmail(react: ReactElement) {
	const [html, text] = await Promise.all([
		render(react),
		render(react, { plainText: true }),
	])
	return { html, text }
}
