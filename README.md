# plausible-cf-worker

Cloudflare Worker that proxies [Plausible Analytics](https://plausible.io) as a first-party connection, preventing adblocker interference. Supports multiple domains from a single worker.

Based on [Plausible's Cloudflare proxy guide](https://plausible.io/docs/proxy/guides/cloudflare).

## How it works

The worker intercepts two paths on your domain:

| Path | Action |
|------|--------|
| `/zk/js/script.js` | Serves the Plausible JS (cached at the edge) |
| `/zk/api/event` | Forwards analytics events to `plausible.io/api/event` |

The per-site Plausible script URL is resolved from the `PLAUSIBLE` variable in `wrangler.toml` using the request's `Host` header.

## Setup

### 1. Deploy the worker

```bash
npm install
npx wrangler deploy
```

### 2. Add a site

In `wrangler.toml`:

1. Add the hostname and Plausible script URL (from Site Installation settings in Plausible) under `[vars.PLAUSIBLE]`:

    ```toml
    [vars.PLAUSIBLE]
    "example.com" = "https://plausible.io/js/pa-XXXXX.js"
    ```

2. Add a `[[routes]]` entry:

    ```toml
    [[routes]]
    pattern = "*example.com/zk/*"
    zone_name = "example.com"
    ```

3. Redeploy with `npx wrangler deploy`.

### 3. Update your site's script tag

```html
<script defer src="/zk/js/script.js"></script>
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init({ endpoint: "/zk/api/event" })
</script>
```

## Required secrets

| Secret | Where | Description |
|--------|-------|-------------|
| `CLOUDFLARE_API_TOKEN` | GitHub repo secret | API token with Workers deploy permission (for CI) |

## License

```
Copyright 2026 Martin Simon

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

```

## Buy me a coffee?

If you feel like buying me a coffee (or a beer?), donations are welcome:

```
BTC : bc1qq04jnuqqavpccfptmddqjkg7cuspy3new4sxq9
DOGE: DRBkryyau5CMxpBzVmrBAjK6dVdMZSBsuS
ETH : 0x2238A11856428b72E80D70Be8666729497059d95
LTC : MQwXsBrArLRHQzwQZAjJPNrxGS1uNDDKX6
```
