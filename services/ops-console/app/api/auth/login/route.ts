import { NextRequest, NextResponse } from 'next/server'

const AUTH_COOKIE = 'amplify-auth'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'callmeAL'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { password } = body

  if (password === AUTH_PASSWORD) {
    const response = NextResponse.json({ ok: true })
    response.cookies.set(AUTH_COOKIE, AUTH_PASSWORD, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
    return response
  }

  return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
}
