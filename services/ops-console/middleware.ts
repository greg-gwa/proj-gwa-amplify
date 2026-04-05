import { NextRequest, NextResponse } from 'next/server'

const AUTH_COOKIE = 'amplify-auth'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'callmeAL'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page, login API, health check, and static assets
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/health' ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Check auth cookie
  const authCookie = request.cookies.get(AUTH_COOKIE)
  if (authCookie?.value === AUTH_PASSWORD) {
    return NextResponse.next()
  }

  // Redirect to login
  const loginUrl = new URL('/login', request.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
