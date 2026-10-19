// Contract: a Next build with a root middleware succeeds. Next compiles the
// server, then the edge compiler that bundles this file, then the client,
// one after another; each joins the build its predecessor may have left.
import { NextResponse } from 'next/server';

export function middleware() {
  return NextResponse.next();
}
