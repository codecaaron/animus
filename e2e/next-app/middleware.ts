// Contract: a Next build with a root middleware succeeds. Next compiles the
// server, then the edge compiler that bundles this file, then the client,
// one after another; every compiler joined the build when Next created its
// config, so the edge compiler takes the server's analysis.
import { NextResponse } from 'next/server';

export function middleware() {
  return NextResponse.next();
}
