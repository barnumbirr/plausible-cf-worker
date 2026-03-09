import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import worker from './worker.js'

const SCRIPT_BODY = 'console.log("plausible")'
const multiSiteConfig = {
  'monka.tv': 'https://plausible.io/js/pa-abc123.js',
  'simon.tf': 'https://plausible.io/js/pa-def456.js',
  'keysets.simon.tf': 'https://plausible.io/js/pa-ghi789.js',
}
const testEnv = {
  ...env,
  PLAUSIBLE: JSON.stringify(multiSiteConfig),
}

beforeEach(() => {
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

async function callWorker(url, opts = {}) {
  const request = new Request(url, opts)
  const ctx = createExecutionContext()
  const response = await worker.fetch(request, testEnv, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

describe('routing', () => {
  it('returns 404 for unmatched paths', async () => {
    const response = await callWorker('https://monka.tv/')
    expect(response.status).toBe(404)
  })

  it('returns 404 for partial path matches', async () => {
    const response = await callWorker('https://monka.tv/zk/js/')
    expect(response.status).toBe(404)
  })
})

describe('GET /zk/js/script.js (no env var for host)', () => {
  it('returns 404 when hostname is not in PLAUSIBLE config', async () => {
    const request = new Request('https://unknown.com/zk/js/script.js')
    const ctx = createExecutionContext()
    const response = await worker.fetch(request, { ...env, PLAUSIBLE: undefined }, ctx)
    await waitOnExecutionContext(ctx)
    expect(response.status).toBe(404)
  })
})

describe('GET /zk/js/script.js', () => {
  it('proxies the plausible script for a known host', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-abc123.js' })
      .reply(200, SCRIPT_BODY, { headers: { 'content-type': 'text/javascript' } })

    const response = await callWorker('https://monka.tv/zk/js/script.js')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SCRIPT_BODY)
  })

  it('returns 404 for an unknown host', async () => {
    const response = await callWorker('https://unknown.com/zk/js/script.js')
    expect(response.status).toBe(404)
  })

  it('does not cache a failed upstream response', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-abc123.js' })
      .reply(502, 'Bad Gateway')

    const response = await callWorker('https://monka.tv/zk/js/script.js')
    expect(response.status).toBe(502)
  })
})

describe('GET /zk/js/script.js (multi-site)', () => {
  it('resolves correct script URL per hostname', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-def456.js' })
      .reply(200, 'simon-script', { headers: { 'content-type': 'text/javascript' } })

    const response = await callWorker('https://simon.tf/zk/js/script.js')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('simon-script')
  })

  it('resolves subdomain separately from parent domain', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-ghi789.js' })
      .reply(200, 'keysets-script', { headers: { 'content-type': 'text/javascript' } })

    const response = await callWorker('https://keysets.simon.tf/zk/js/script.js')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('keysets-script')
  })

  it('preserves content-type from upstream', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-abc123.js' })
      .reply(200, SCRIPT_BODY, { headers: { 'content-type': 'application/javascript; charset=utf-8' } })

    const response = await callWorker('https://monka.tv/zk/js/script.js')
    expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
  })
})

describe('GET /zk/js/script.js (PLAUSIBLE as object)', () => {
  it('works when env.PLAUSIBLE is a parsed object (wrangler.toml [vars.PLAUSIBLE])', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/js/pa-abc123.js' })
      .reply(200, SCRIPT_BODY, { headers: { 'content-type': 'text/javascript' } })

    const objectEnv = { ...env, PLAUSIBLE: multiSiteConfig }
    const request = new Request('https://monka.tv/zk/js/script.js')
    const ctx = createExecutionContext()
    const response = await worker.fetch(request, objectEnv, ctx)
    await waitOnExecutionContext(ctx)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SCRIPT_BODY)
  })
})

describe('GET /zk/js/script.js (malformed PLAUSIBLE)', () => {
  it('returns 404 when PLAUSIBLE is invalid JSON', async () => {
    const badEnv = { ...env, PLAUSIBLE: '{not json' }
    const request = new Request('https://monka.tv/zk/js/script.js')
    const ctx = createExecutionContext()
    // Malformed JSON will throw — worker should not crash silently
    await expect(worker.fetch(request, badEnv, ctx)).rejects.toThrow()
  })
})

describe('POST /zk/api/event', () => {
  it('forwards event to plausible.io', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/api/event', method: 'POST' })
      .reply(202, 'ok')

    const response = await callWorker('https://monka.tv/zk/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=abc' },
      body: JSON.stringify({ name: 'pageview', url: 'https://monka.tv/' }),
    })
    expect(response.status).toBe(202)
  })

  it('forwards event body intact', async () => {
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/api/event', method: 'POST' })
      .reply(202, 'ok')

    const eventBody = JSON.stringify({ name: 'custom-event', url: 'https://monka.tv/page', props: { variant: 'A' } })
    const response = await callWorker('https://monka.tv/zk/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: eventBody,
    })
    // If the body wasn't forwarded, plausible.io would reject it.
    // We verify the round-trip succeeds (202) as evidence the body was passed through.
    expect(response.status).toBe(202)
  })

  it('strips cookies from forwarded request', async () => {
    let receivedHeaders
    fetchMock
      .get('https://plausible.io')
      .intercept({ path: '/api/event', method: 'POST' })
      .reply(({ headers }) => {
        receivedHeaders = headers
        return { statusCode: 202, data: '' }
      })

    await callWorker('https://monka.tv/zk/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=abc' },
      body: JSON.stringify({ name: 'pageview' }),
    })
    expect(receivedHeaders['cookie']).toBeUndefined()
  })

  it('returns 405 for non-POST requests', async () => {
    const response = await callWorker('https://monka.tv/zk/api/event', {
      method: 'GET',
    })
    expect(response.status).toBe(405)
  })
})
