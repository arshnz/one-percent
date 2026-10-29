// Call an Express router's handler directly — no HTTP, no auth middleware —
// and capture what it would have sent.

export async function callRoute(
  router: any,
  method: 'get' | 'post' | 'delete',
  path: string,
  req: { params?: Record<string, string>; body?: any; query?: any; userId: string; userTimezone: string }
): Promise<{ status: number; body: any }> {
  // A CommonJS module imported from ESM arrives as { default: router }.
  if (!router.stack && router.default) router = router.default
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method])
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`)
  const handler = layer.route.stack[layer.route.stack.length - 1].handle
  return new Promise((resolve, reject) => {
    let status = 200
    const res = {
      status(s: number) { status = s; return res },
      json(body: any) { resolve({ status, body: JSON.parse(JSON.stringify(body)) }) },
    }
    handler({ params: {}, query: {}, body: {}, ...req }, res, (err: any) => (err ? reject(err) : resolve({ status, body: null })))
  })
}
