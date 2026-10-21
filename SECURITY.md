# Security policy

Security fixes target the current `main` branch. There is no fixed support period for older pre-1.0 revisions.

## Report a vulnerability

Do not publish exploit details or secrets in an issue. Use [GitHub private vulnerability reporting](https://github.com/0then0/CineClue/security/advisories/new) when available. Otherwise contact the repository owner privately through a contact method on their [GitHub profile](https://github.com/0then0).

Include the affected revision, reproduction steps, expected and actual behavior, and impact. Redact API tokens, visitor cookies and private database contents. Test with disposable local data; do not probe third-party or production systems without permission.

## Hosting securely

Use HTTPS, a private `DAILY_SECRET` and deployment-specific database credentials. The default Compose setup binds to localhost and uses development settings. Visitor cookies grant access to anonymous games and must be treated as credentials. Database backups can contain those credentials.

See [deployment](docs/DEPLOYMENT.md) for proxy identity, request limits and backups. Factual catalog corrections belong in ordinary issues unless they expose private information.
