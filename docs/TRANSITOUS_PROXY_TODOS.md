# Transitous Proxy To-Dos

## DNS + SSL
- Create a DNS A/AAAA record for transitous-proxy.vizsim.de pointing to your server.
- Provision TLS (Certbot or existing ACME flow).
- Ensure the certificate covers transitous-proxy.vizsim.de.

## Nginx proxy config
- Add a new server block for transitous-proxy.vizsim.de (port 443).
- Add a /transitous/ location that proxies to https://api.transitous.org/.
- Enable CORS for https://vizsim.github.io only.
- Add OPTIONS preflight handling (return 204).
- Add rate limiting (recommended) and reasonable timeouts.
- Reload Nginx and verify no config errors.

## App config (repo)
- Set TRANSIT_PROFILE_AUTO_DISABLE_ON_GITHUB_PAGES to false.
- Keep TRANSIT_PROFILE_ENABLED as true.
- Set TRANSITOUS_ONE_TO_ALL_URL to https://transitous-proxy.vizsim.de/transitous/api/v1/one-to-all.
- Deploy the updated site to GitHub Pages.

## Verification
- Open https://vizsim.github.io/miso/ and confirm the Transit profile button is visible.
- Trigger a transit isochrone and confirm it hits the proxy without CORS errors.
- Check Nginx access logs for /transitous/ requests.

## Optional hardening
- Restrict CORS strictly to https://vizsim.github.io.
- Add IP allowlist if only you should use the proxy.
- Add caching for identical transit requests (if desired).
