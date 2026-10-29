// Swaps server/src/lib/prisma.js for the in-memory stub, and pins the clock.
//
//   HARNESS_NOW=<iso> node --import tsx --import ./ios/Tools/harness/register.mjs ios/Tools/golden.mts <export>
//
// The server compiles to CommonJS under tsx, so the swap hooks require()
// resolution. HARNESS_NOW fixes `new Date()` / `Date.now()` so routes that read
// the clock give the same answer every run.
import Module from 'node:module'
import { fileURLToPath } from 'node:url'

const stub = fileURLToPath(new URL('./prismaStub.cts', import.meta.url))
const original = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (/(^\.\/|\/lib\/)prisma(\.js|\.ts)?$/.test(request) && parent?.filename?.includes('/server/src/')) return stub
  return original.call(this, request, parent, ...rest)
}

// globalThis.setHarnessNow(iso) moves the clock mid-run, so one process can
// replay a scenario across several days.
let fixed = process.env.HARNESS_NOW ? Date.parse(process.env.HARNESS_NOW) : null
globalThis.setHarnessNow = (iso) => { fixed = Date.parse(iso) }
{
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0 && fixed !== null) super(fixed)
      else super(...args)
    }
    static now() { return fixed ?? RealDate.now() }
  }
  globalThis.Date = FixedDate
}
