// An in-memory stand-in for the Prisma client, just wide enough for the route
// handlers the golden tests drive. Loaded in place of server/src/lib/prisma.js
// by ./register.mjs (require hook), so the routes run unmodified against an export's rows.
//
// Supports the query shapes those routes actually use — equality, null,
// { in }, { gte, lte, lt, gt }, { not }, one level of relation filter, include,
// orderBy, take, groupBy-by-one-field, and the compound unique keys. Anything
// else throws, so a route that grows a new query shape fails loudly here
// rather than silently returning the wrong rows.

type Row = Record<string, any>

const db: Record<string, Row[]> = {
  user: [], workstation: [], habit: [], phase: [], habitLog: [], automaticityCheck: [],
  goal: [], checkIn: [], compassSnapshot: [], coachConversation: [], coachMessage: [],
  habitMetricLink: [], wearableDay: [], wearableActivity: [], canvasNode: [], bookChunk: [],
}

// relation name on model → [target model, local key, foreign key, kind]
const relations: Record<string, Record<string, [string, string, string, 'one' | 'many']>> = {
  habit: {
    phases: ['phase', 'id', 'habitId', 'many'],
    logs: ['habitLog', 'id', 'habitId', 'many'],
    checks: ['automaticityCheck', 'id', 'habitId', 'many'],
    metricLinks: ['habitMetricLink', 'id', 'habitId', 'many'],
    goal: ['goal', 'goalId', 'id', 'one'],
    workstation: ['workstation', 'workstationId', 'id', 'one'],
  },
  habitLog: { habit: ['habit', 'habitId', 'id', 'one'], phase: ['phase', 'phaseId', 'id', 'one'] },
  phase: { habit: ['habit', 'habitId', 'id', 'one'] },
  goal: { habits: ['habit', 'id', 'goalId', 'many'] },
  workstation: {
    user: ['user', 'userId', 'id', 'one'],
    habits: ['habit', 'id', 'workstationId', 'many'],
    checkIns: ['checkIn', 'id', 'workstationId', 'many'],
    goals: ['goal', 'id', 'workstationId', 'many'],
  },
  coachConversation: { messages: ['coachMessage', 'id', 'conversationId', 'many'] },
  habitMetricLink: { habit: ['habit', 'habitId', 'id', 'one'] },
  automaticityCheck: { habit: ['habit', 'habitId', 'id', 'one'], phase: ['phase', 'phaseId', 'id', 'one'] },
}

const compound: Record<string, string[]> = {
  habitId_date: ['habitId', 'date'],
  workstationId_weekOf: ['workstationId', 'weekOf'],
  habitId_phaseNumber: ['habitId', 'phaseNumber'],
  habitId_metric: ['habitId', 'metric'],
}

const cmp = (a: any, b: any) => {
  const x = a instanceof Date ? a.getTime() : a
  const y = b instanceof Date ? b.getTime() : b
  return x < y ? -1 : x > y ? 1 : 0
}

function matchField(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined
  if (cond instanceof Date || typeof cond !== 'object') return cmp(v, cond) === 0
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case 'in': if (!(arg as any[]).some((a) => cmp(v, a) === 0)) return false; break
      case 'notIn': if ((arg as any[]).some((a) => cmp(v, a) === 0)) return false; break
      case 'gte': if (v == null || cmp(v, arg) < 0) return false; break
      case 'gt': if (v == null || cmp(v, arg) <= 0) return false; break
      case 'lte': if (v == null || cmp(v, arg) > 0) return false; break
      case 'lt': if (v == null || cmp(v, arg) >= 0) return false; break
      case 'not': if (matchField(v, arg)) return false; break
      default: throw new Error(`prismaStub: unsupported operator ${op}`)
    }
  }
  return true
}

function matches(model: string, row: Row, where: Row | undefined): boolean {
  if (!where) return true
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (k === 'AND') { if (!(cond as Row[]).every((w) => matches(model, row, w))) return false; continue }
    if (k === 'OR') { if (!(cond as Row[]).some((w) => matches(model, row, w))) return false; continue }
    if (compound[k]) {
      if (!compound[k].every((f) => cmp(row[f], cond[f]) === 0)) return false
      continue
    }
    const rel = relations[model]?.[k]
    if (rel) {
      const [target, local, foreign] = rel
      const linked = db[target].filter((r) => cmp(r[foreign], row[local]) === 0)
      if (!linked.some((r) => matches(target, r, cond))) return false
      continue
    }
    if (!matchField(row[k], cond)) return false
  }
  return true
}

function shape(model: string, row: Row, args: Row): Row {
  const out: Row = { ...row }
  const include = args.include ?? {}
  for (const [k, sub] of Object.entries(include)) {
    if (!sub) continue
    const rel = relations[model]?.[k]
    if (!rel) throw new Error(`prismaStub: unknown relation ${model}.${k}`)
    const [target, local, foreign, kind] = rel
    const subArgs = sub === true ? {} : (sub as Row)
    if (kind === 'many') {
      out[k] = query(target, { ...subArgs, where: { ...(subArgs.where ?? {}), [foreign]: row[local] } })
    } else {
      const hit = row[local] == null ? null : db[target].find((r) => cmp(r[foreign], row[local]) === 0)
      out[k] = hit ? shape(target, hit, subArgs) : null
    }
  }
  if (args.select) {
    const picked: Row = {}
    for (const [k, v] of Object.entries(args.select)) {
      if (!v) continue
      picked[k] = relations[model]?.[k] ? shape(model, row, { include: { [k]: v } })[k] : out[k]
    }
    return picked
  }
  return out
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o))
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = cmp(a[k], b[k])
      if (c) return dir === 'desc' ? -c : c
    }
    return 0
  })
}

function query(model: string, args: Row = {}): Row[] {
  let rows = sortRows(db[model].filter((r) => matches(model, r, args.where)), args.orderBy)
  if (args.skip) rows = rows.slice(args.skip)
  if (args.take !== undefined) rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)
  return rows.map((r) => shape(model, r, args))
}

// Column defaults the routes rely on when they create rows.
const defaults: Record<string, () => Row> = {
  habitLog: () => ({ phaseId: null, quantity: null, goldilocks: null, missReasons: '[]', missNote: null }),
  checkIn: () => ({
    rating: null, tinyVictory: null, workingWell: null, notWorking: null, obstacles: '[]',
    freeform: null, aiSummary: null, status: 'completed', updatedAt: new Date(),
  }),
  phase: () => ({ definitionOfDone: null, dailyLimit: null, targetCount: 30, status: 'active', graduatedAt: null, updatedAt: new Date() }),
  goal: () => ({ domain: 'health', whyText: null, timeframe: null, sourceNote: null, sourceId: null, status: 'active' }),
  habit: () => ({ goalId: null, pausedAt: null, archivedAt: null, lastRemindedOn: null }),
  compassSnapshot: () => ({ label: null }),
}

let nextId = 0
function insert(model: string, data: Row): Row {
  // Nested writes — `phases: { create: [...] }` — become child rows.
  const nested: [string, Row[]][] = []
  const own: Row = {}
  for (const [k, v] of Object.entries(data)) {
    if (relations[model]?.[k] && v && typeof v === 'object' && 'create' in v) {
      nested.push([k, Array.isArray(v.create) ? v.create : [v.create]])
    } else {
      own[k] = v
    }
  }
  const row = { ...(defaults[model]?.() ?? {}), id: `stub${++nextId}`, createdAt: new Date(), updatedAt: new Date(), ...own }
  db[model].push(row)
  for (const [k, children] of nested) {
    const [target, local, foreign, kind] = relations[model][k]
    if (kind !== 'many') throw new Error(`prismaStub: nested create on ${model}.${k} unsupported`)
    for (const c of children) insert(target, { ...c, [foreign]: row[local] })
  }
  return row
}

function updateRows(model: string, where: Row, data: Row): Row[] {
  const rows = db[model].filter((r) => matches(model, r, where))
  for (const r of rows) Object.assign(r, data)
  return rows
}

function delegate(model: string) {
  return {
    create: async (args: Row) => shape(model, insert(model, args.data), args),
    update: async (args: Row) => {
      const [row] = updateRows(model, args.where, args.data)
      if (!row) throw new Error(`prismaStub: update found no ${model}`)
      return shape(model, row, args)
    },
    updateMany: async (args: Row) => ({ count: updateRows(model, args.where, args.data).length }),
    upsert: async (args: Row) => {
      const [row] = updateRows(model, args.where, args.update)
      if (row) return shape(model, row, args)
      // A compound unique key in `where` names columns the new row must carry.
      const keyCols: Row = {}
      for (const [k, v] of Object.entries(args.where)) if (compound[k]) Object.assign(keyCols, v)
      return shape(model, insert(model, { ...keyCols, ...args.create }), args)
    },
    delete: async (args: Row) => {
      const i = db[model].findIndex((r) => matches(model, r, args.where))
      if (i < 0) throw new Error(`prismaStub: delete found no ${model}`)
      return db[model].splice(i, 1)[0]
    },
    deleteMany: async (args: Row = {}) => {
      const keep = db[model].filter((r) => !matches(model, r, args.where))
      const count = db[model].length - keep.length
      db[model] = keep
      return { count }
    },
    findMany: async (args: Row = {}) => query(model, args),
    findFirst: async (args: Row = {}) => query(model, { ...args, take: 1 })[0] ?? null,
    findUnique: async (args: Row = {}) => query(model, { ...args, take: 1 })[0] ?? null,
    findUniqueOrThrow: async (args: Row = {}) => {
      const r = query(model, { ...args, take: 1 })[0]
      if (!r) throw new Error('not found')
      return r
    },
    count: async (args: Row = {}) => query(model, args).length,
    groupBy: async (args: Row) => {
      if (args.by.length !== 1) throw new Error('prismaStub: groupBy supports one field')
      const field = args.by[0]
      const groups = new Map<any, number>()
      for (const r of query(model, { where: args.where })) groups.set(r[field], (groups.get(r[field]) ?? 0) + 1)
      return [...groups.entries()].map(([k, n]) => ({ [field]: k, _count: { _all: n } }))
    },
  }
}

export const prisma: any = new Proxy({}, {
  get(_t, prop: string) {
    if (prop in db) return delegate(prop)
    if (prop === '$disconnect') return async () => {}
    // Vector search for the coach's book passages: none in the harness.
    if (prop === '$queryRawUnsafe' || prop === '$queryRaw') return async () => []
    // Interactive transactions run against the same tables — the stub has no
    // concurrency, so "all or nothing" is moot here.
    if (prop === '$transaction') return async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))
    throw new Error(`prismaStub: unsupported ${String(prop)}`)
  },
})

const DATE_KEYS = /At$|^startedAt$/

function revive(row: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' && DATE_KEYS.test(k) ? new Date(v) : v
  return out
}

/** Read a table directly — for snapshotting state after a route mutates it. */
export function table(model: string): Row[] {
  return db[model]
}

/** Add a row directly — for synthetic scenarios the export doesn't contain. */
export function seed(model: string, data: Row): Row {
  return insert(model, data)
}

/** Load an ios-export JSON into the in-memory tables. */
export function loadExport(ex: any) {
  for (const k of Object.keys(db)) db[k] = []
  const userId = ex.workstations[0]?.userId ?? 'user'
  db.user.push(revive({ ...ex.user, id: userId, password: '', emailReminders: false, pushReminders: false }))
  for (const ws of ex.workstations) {
    const { goals, checkIns, compassSnapshots, coachChats, habits, ...wsRow } = ws
    db.workstation.push(revive(wsRow))
    for (const g of goals) db.goal.push(revive(g))
    for (const c of checkIns) db.checkIn.push(revive(c))
    for (const s of compassSnapshots) db.compassSnapshot.push(revive(s))
    for (const { messages, ...chat } of coachChats) {
      db.coachConversation.push(revive(chat))
      for (const m of messages) db.coachMessage.push(revive(m))
    }
    // Creation order, as Postgres would hand them back — some analyses are
    // order-sensitive (a permutation test's shuffle depends on input order).
    const ordered = [...habits].sort((a: any, b: any) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    for (const { phases, logs, checks, metricLinks, ...h } of ordered) {
      db.habit.push(revive(h))
      for (const p of phases) db.phase.push(revive(p))
      for (const l of logs) db.habitLog.push(revive(l))
      for (const c of checks) db.automaticityCheck.push(revive(c))
      for (const m of metricLinks) db.habitMetricLink.push(revive(m))
    }
  }
  for (const d of ex.wearableDays) db.wearableDay.push(revive(d))
  for (const a of ex.wearableActivities) db.wearableActivity.push(revive(a))
  return { userId, wsId: ex.workstations[0].id as string }
}
